# 02 Thread、Session、Turn 与 Item：给 Agent 一副不会混乱的骨架

## 为什么不能把一切都叫“对话”

用户关闭 IDE 后重新打开，希望继续昨天的任务；运行中的命令却不可能原样存在于新进程。
这说明“用户看见的对话”和“进程中的运行时”不是同一个东西。

生产 Agent 通常拆成四层：

| 概念 | 人类类比 | 生命周期 | 典型内容 |
| --- | --- | --- | --- |
| Thread | 一个连续工作目标的记录 | 可跨进程长期存在 | turns、标题、历史、归档状态 |
| Session | 今天打开的工作台 | 一次运行时装载 | 模型客户端、MCP 连接、服务、配置快照 |
| Turn | 接到一个新要求后的工作回合 | 从输入到完成/中断 | 当前目标、采样循环、取消、权限 |
| Item | 工作记录中的一条事实 | 单个事件或产物 | 用户消息、工具调用、结果、回答 |

最重要的区分是：Thread 是用户产品概念，Session 是进程内执行概念。历史 thread 可以被
读取，但只有 resume 后才重新获得 live session。

## 用“昨天继续修 Bug”走一遍状态变化

昨天用户发送“修复登录失败”，系统创建 Thread T1 和 Turn A。Turn A 读取日志、修改
代码并完成，所有重要 items 被持久化。随后应用退出，Session S1 消失。

今天再次打开：

```text
持久化 Thread T1 仍存在
  -> thread/read：只展示历史，不启动 Agent
  -> thread/resume：创建新的 live Session S2
  -> 用户说“继续跑测试”
  -> 创建 Turn B
  -> 新 items 追加到 T1
```

如果试图把整个 Session 序列化成历史，会遇到无法恢复的连接、进程句柄、后台任务和
锁；如果没有独立的 Thread 持久化表示，进程退出后一切丢失。这就是分层的工程原因。

## Session 实际包含什么

Session 不是“另一份聊天记录”，而是一个 live thread 在当前进程中的运行时容器。当前
Codex 实现中的 `Session` 可以在 `core/src/session/session.rs` 找到。阅读结构体字段时，
可以把内容分成四类：

1. 身份与通信：`thread_id`、事件 channel、Agent 状态 channel。
2. 可跨 turn 的内存状态：`SessionState`、模型可见 history、输入队列和配置快照。
3. 当前活动状态：`active_turn`、取消令牌、后台任务和实时会话管理器。
4. 运行时服务：模型客户端、MCP runtime、命令进程管理器、认证、插件和遥测。

Session 直接包含 `Mutex<SessionState>`、`Semaphore`、`CancellationToken`、
`JoinHandle` 和 `Mutex<Option<ActiveTurn>>` 等进程内对象。连接和进程通常是间接拥有：
`Session.services` 指向 `core/src/state/service.rs` 中的 `SessionServices`，后者持有
`McpRuntime`、`ModelClient` 和 `UnifiedExecProcessManager`。

沿所有权继续向下看，就能找到不能跨进程恢复的具体资源：

```text
ThreadManager
  -> CodexThread
      -> Arc<Session>
          -> SessionServices
              -> McpRuntime
                  -> MCP connection set
              -> UnifiedExecProcessManager
                  -> ProcessStore
                      -> UnifiedExecProcess
                          -> local / exec-server process handle
```

本地 stdio MCP 的实现位于 `rmcp-client/src/local_stdio_transport.rs`，其中直接持有
`Child`、`ChildStdin` 和 `ChildStdout`。统一命令进程的抽象位于
`core/src/unified_exec/process.rs`，其中还包含输出任务 `JoinHandle`、交互锁和进程句柄。
当前 turn 的 `RunningTask` 位于 `core/src/state/turn.rs`，包含取消令牌、通知对象、
oneshot channel 和异步任务 handle。

因此，“Session 包含 socket、进程句柄和锁”表达的是直接或沿所有权链间接包含，并不
意味着 `Session` 上一定存在名为 `socket` 或 `child` 的字段。特别是 HTTP 连接通常封装在
客户端或连接池内，不应把实现细节简化成一个裸 `TcpStream` 字段。

Session 也没有被整体序列化。真正的恢复过程是：

```text
读取持久化 thread rollout
  -> 创建新的 Session
  -> 重建模型可见 history 和配置
  -> 重新建立模型客户端、MCP 和其他服务
  -> 不恢复旧进程、旧连接和旧异步任务
```

在源码中，`core/src/thread_manager.rs` 的 thread 创建路径调用 `Session::spawn`，然后把
返回的 `Arc<Session>` 放入 `CodexThread`；`ThreadManagerState` 再以内存 map 保存加载中的
`Arc<CodexThread>`。客户端只能看到 thread 状态、事件和 `sessionId` 等稳定投影，不能读取
这个 Rust `Session` 对象。[官方 App Server 文档](https://developers.openai.com/codex/app-server/)
中的 `thread/read` 不会加载运行时，`thread/resume` 才会重新加载 thread；
`thread/loaded/list` 也只列出当前已加载的 thread id。

## Thread 会无限增长吗

需要把“持久化历史”和“模型当前能看到的上下文”分开讨论。

Thread 的持久化记录可以长期追加 turn 和 item。当前接口没有把一个 thread 的全部历史
塞进无界响应：长历史通过 `thread/turns/list` 和 `thread/items/list` 分页读取。因此，持久化
层面应把 thread 当成可增长的工作日志，而不能假设它永远很小。不过，可增长不等于物理上
无限；它最终仍受磁盘、存储策略和实现性能约束。

模型上下文则一定有硬上限。Codex 会跟踪模型的 context window 和自动压缩阈值，在达到
阈值时执行 compaction。压缩会用更短的替代历史保留后续工作需要的关键状态，resume 时也
从最近的压缩结果和之后新增的记录重建模型上下文。因此：

- thread 中可以继续保留和分页展示较长的工作记录；
- 每次请求实际发给模型的有效历史不会无限增长；
- compaction 保留的是关键状态，而不是保证早期每个细节都逐字可用；
- compaction 是上下文管理，不等于创建了一个新 thread。

这也解释了为什么“没有报 context overflow”不等于“模型永久精确记得所有旧内容”。对于
必须长期精确保留的约束，应把它写进代码、测试、任务说明或其他可重新读取的项目文件，
而不要只依赖很早以前的一轮对话。

## Thread 应该是什么粒度

Thread 的推荐粒度是**一个需要共享目标、约束、代码状态和决策历史的连续工作流**，例如：

- 修复一个 bug；
- 实现一个功能或用户故事；
- 完成一次边界清楚的重构；
- 处理一个 PR，包括实现、测试和 review feedback；
- 排查一次线上事故；
- 围绕一个明确主题持续研究。

它通常比一条用户消息大，又比整个仓库或项目生命周期小：

```text
仓库 / 项目
  ├── Thread：修复登录失败
  │     ├── Turn：复现并定位
  │     ├── Turn：实现修复
  │     └── Turn：测试并处理 review
  ├── Thread：实现支付重试
  └── Thread：调查 CI 变慢
```

以下情况适合继续当前 thread：

- 仍在完成同一个目标；
- 新要求依赖前面的调查、决策、工具结果或代码修改；
- 只是隔天继续、重新打开客户端，或在实现后继续测试和 review；
- 用户说的是“继续”“按刚才的方案修改”之类自然后续。

以下情况通常适合新开 thread：

- 开始处理另一个 issue、PR、功能或无关问题；
- 切换到另一个仓库、worktree，或语义上完全不同的代码分支；
- 原目标已经完成，新要求只是在同一仓库中碰巧发生；
- 需要让多个独立任务并行推进，避免状态和工具输出相互干扰；
- 旧对话积累了大量失效假设、冲突要求或无关探索，需要 clean slate。

一个实用判断是：如果新任务不需要前面大部分对话也能独立描述和完成，就应考虑新开
thread；如果它明显依赖前面形成的工作状态，就继续当前 thread。新 thread 仍需要少量旧
背景时，在第一轮提供简短 handoff，写清目标、当前状态、关键决策、相关文件和未完成事项。

不建议把整个项目的所有工作永久放进同一个 thread。技术上 compaction 可以让长 thread
继续运行，但不同任务的约束会逐渐混杂，早期细节也可能只剩摘要，最终反而不利于定位、
回顾和恢复工作。

## Item 为什么是一等公民

假设 Turn B 包含：用户输入、命令调用、审批拒绝、替代命令、测试输出和最终回答。只
保存“user/assistant 文本”会丢掉 Agent 最重要的行动证据。

Item 化带来四个能力：

1. UI 可以逐条展示进度，而不是等待最终回答。
2. resume 可以重建模型所需历史和用户可见历史。
3. replay/eval 可以断言具体工具和参数。
4. fork 可以选择保留哪些事实，而不是复制一坨不透明字符串。

但不是所有内存状态都应成为 item。连接池、取消 token、handler 对象只属于 Session；
未完成流的临时 buffer 通常只属于当前 Turn。

## Turn 是状态机，不是消息数组

一个简化状态机：

```text
Pending
  -> RunningModel
  -> WaitingTool
  -> RunningModel
  -> Completed

任意活动状态 -> Interrupted / Failed
```

真正实现时，工具可能并行，用户可能 steer 新输入，mailbox 可能带来子 Agent 消息，
因此状态不一定是一条直线。设计时至少保证：同一 active turn 的事件有稳定 turn id；
完成之后不再接受属于该 turn 的新副作用；延迟输入明确进入当前安全点或下一 turn。

## 发给模型的是 Session 还是 History

严格来说，两者都不是。Codex 不会把 `Session` 对象发送给模型，也不是把未经处理的全部
历史原样发送出去。每次模型采样前，Session 会从当前有效 history 生成模型输入，再把它
与指令、工具定义和输出约束组装成一次临时 `Prompt`：

```text
Session（组织运行时）
  -> SessionState.history
      -> clone_history().for_prompt(...)
          -> 规范化后的 Vec<ResponseItem>
              -> build_prompt(...)
                  -> Prompt
                      -> Responses API request
```

`core/src/context_manager/history.rs` 中的 `ContextManager::for_prompt` 是这条链上的关键
边界。它会根据模型输入模态规范化 history，去掉不适合发送的内容，并使用已经截断、回滚
或 compaction 后的有效历史。这里得到的 `Vec<ResponseItem>` 包含当前模型应该看到的用户
消息、Agent 消息、工具调用和工具结果等 items。

`core/src/session/turn.rs` 的 turn 采样循环先调用 `clone_history().for_prompt(...)`，再由
同一文件中的 `build_prompt` 组装请求。`Prompt` 定义在 `core/src/client_common.rs`，主要
包含：

- `input`：从有效 history 得到的模型输入 items；
- `base_instructions`：模型和 Agent 的基础指令；
- `tools`：模型可见的工具名称、说明和参数 schema；
- `parallel_tool_calls`：是否允许并行工具调用；
- `output_schema`：结构化输出约束。

随后 `core/src/client.rs` 的 `build_responses_request` 把 `Prompt` 转成实际 API 请求，加入
模型、reasoning、service tier、文本输出配置和缓存键等字段。可以把关系概括为：

```text
Prompt != Session
Prompt != 原始 History
Prompt = 有效 History + Instructions + Tool schemas + Output constraints
```

Session 中的锁、channel、MCP 连接、子进程、取消令牌、runtime handle 和 Rust 工具
handler 都不会发送给模型。模型只会看到工具的描述和 schema；真正执行工具的是 Session
持有的本地运行时。请求可能携带 `sessionId`、`threadId` 或其他元数据，但标识符也不等于
把 Session 对象发送给模型。

[官方 OpenAI conversation state 文档](https://developers.openai.com/api/docs/guides/conversation-state)
也体现了同一边界：模型请求接收的是输入；多轮状态通过再次提供历史 items、conversation
或 `previous_response_id` 延续，而不是传递应用的内存 Session。

## 临时构建的 Prompt 仍会超限吗

会。“临时”只说明 `Prompt` 是为某次采样即时组装的请求快照，不说明它的大小不受限制。
模型实际接收的 instructions、有效 history、工具 schemas、环境和扩展上下文、当前输入，
以及模型输出所需空间，仍然共同受 context window 约束。Prompt Cache 也不会扩大这个窗口。

Codex 不依赖 `build_prompt` 在最后一刻随意丢消息，而是在采样循环中治理上下文：限制单个
fragment 和工具输出的大小，跟踪 token pressure，并在需要时先执行 pre-sampling 或
mid-turn compaction，再从 replacement history 构建后续 Prompt：

```text
持久化 Thread 可以继续增长
  -> Session 维护当前有效 history
      -> 检查 context window / auto-compact threshold
          -> 必要时 compact 并替换有效 history
              -> build_prompt
                  -> 有界的模型请求
```

因此，`for_prompt` 的“规范化”和 compaction 的“缩短历史”是不同步骤：前者调整 item 形状
和模态兼容性，后者在上下文压力下改变有效历史。极端情况下，如果单个不可裁剪输入已经
超过模型限制，或者压缩请求本身也放不进窗口，调用仍可能失败。

[官方 OpenAI Compaction 文档](https://developers.openai.com/api/docs/guides/compaction)同样要求
送入 compact endpoint 的原始窗口仍须适配模型的 context window。Prompt Cache 与容量治理
的区别在第 4 课展开。

## 客户端协议看到的不是内存对象

App Server v2 用请求和通知把运行时投影给客户端：

```text
thread/start 或 thread/resume
  -> turn/start
  -> turn/started
  -> item/started / item delta / item/completed
  -> turn/completed
```

`turn/start` 返回表示“服务器接受并创建了 turn”，不表示所有工作完成。客户端必须继续
消费通知。`thread/read` 只读存储；`includeTurns` 显式决定是否把 turn 历史带回。长历史
使用 cursor 分页，而不是一个无界 JSON 响应。

这是一条很实用的系统设计原则：协议传稳定、可版本化的快照和事件，不暴露 core 的
Rust 对象、锁或内部指针。

## 执行环境是第五个容易混淆的边界

App Server 可以在 macOS，真正执行命令的 exec-server 可以在 Linux 或 Windows。
Thread/Turn 状态由 Agent 服务管理，但 cwd、shell 和路径必须由目标 environment 解释。

```text
Client
  -> App Server：thread、turn、item、订阅
  -> Core：Agent loop、context、tool orchestration
  -> Environment：文件系统、shell、进程和 sandbox
```

因此 `/Users/me/project` 不能被 App Server 直接拼进 Windows 命令。environment 应报告
自己的 canonical cwd 和 target-native shell。turn 选择 environment 时，省略、空列表
和显式列表也必须有清晰、不同的语义。

## 动手实验：设计一个可恢复状态模型

为 `mini-codex-agent` 定义：

```text
Thread { id, turns, created_at, archived }
Turn { id, status, items, started_at, completed_at }
Item = UserMessage | ToolCall | ToolResult | AgentMessage | Error
Session { loaded_thread_id, model_client, tool_registry, cancellation }
```

完成四个场景：

1. 新建 T1，完成一个包含工具调用的 turn。
2. 删除内存 Session，确认持久化 Thread 仍能 read。
3. resume T1，追加第二个 turn，旧 item id 不变。
4. 在工具运行中 interrupt，记录 turn 状态；新输入不能偷偷追加到已完成 turn。

再模拟远程 environment：让它报告 Windows shell 和 cwd，检查上层没有用本机路径规则
改写它。

## 常见误区

- Thread id 和当前 Session id 永远相同。恢复和 fork 后未必如此。
- 把 running process 存进历史，期待 resume 后继续。应保存可重建事实而非进程句柄。
- `thread/read` 顺便启动模型。读取和执行必须分开。
- `turn/completed` 包含全部 canonical items。客户端应持续消费 item events。
- 分页 cursor 等于数据库 offset。opaque cursor 才允许后端演进。

## 理解之后再对照 Codex

概念对应关系：`core/src/thread_manager.rs` 管理加载、新建与恢复；
`core/src/codex_thread.rs` 是 live thread 门面；`core/src/session/session.rs` 和
`core/src/state/session.rs` 保存运行时；`core/src/session/turn.rs`、
`core/src/state/turn.rs` 与 `core/src/session/input_queue.rs` 管理 turn 和输入。

协议对照位于 `app-server-protocol/src/protocol/v2/thread.rs`、`turn.rs`、`item.rs` 和
`environment.rs`；先在 `app-server/README.zh-CN.md` 看客户端生命周期，再用这些类型
验证字段，不需要从协议文件第一行读到最后一行。

如果要继续理解 Session 为什么能持有跨多个工具调用的命令进程，以及 shutdown/resume
怎样处理它们，接着学习[第 15 课](15-shell-process-lifecycle.md)；本课只建立“活进程不是
持久化 Thread 状态”的所有权边界。

## 本课验收

你应该能解释：

1. Thread 和 Session 为什么必须分开？
2. 哪些状态必须持久化，哪些只能留在内存？
3. `thread/read`、`thread/resume` 和 `turn/start` 的效果有何不同？
4. App Server 与远程 exec-server 分别拥有哪部分真相？
5. Session 直接或间接拥有哪些不能持久化恢复的运行时资源？
6. History 如何经过 `for_prompt` 和 `build_prompt` 变成模型请求？
7. 为什么 Prompt Cache 不能替代 context window 检查和 compaction？
