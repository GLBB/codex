# 12 Multi-Agent V2：从一个 Agent Loop 到一组协作 Agent

## 先说结论：Multi-Agent 不是另一种 Agent Loop

学完前面的课程后，你已经可以把单 Agent 简化为：

```text
用户输入
  -> Model
  -> Tool Call
  -> Tool Result
  -> 再次调用 Model
  -> Final Answer
```

Multi-Agent 不需要发明另一套 Loop。它做的是运行多个彼此独立的 Agent Loop，并在它们上面
增加一层控制能力：创建、通信、调度、等待、中断和查看状态。

```text
用户
  ↓
父 Agent Loop
  ├── 子 Agent A Loop
  ├── 子 Agent B Loop
  └── 子 Agent C Loop

控制层：Agent Registry + Mailbox + Scheduler + Status
```

因此可以先记住这个公式：

```text
Multi-Agent
  = 多个单 Agent Loop
  + Agent 身份和父子关系
  + 消息与任务队列
  + 生命周期控制
  + 并发和资源限制
```

本课重点不是“怎样创建多个模型请求”，而是后面四项为什么必不可少。

## 先分清六个容易混在一起的概念

假设父 Agent 创建了一个名为 `review_tests` 的 worker。这个 worker 完成一次检查后，可以
保持空闲，之后再接新任务。要理解这个过程，需要区分 Agent、Thread、Turn 和输入。

| 概念 | 含义 | 类比 |
| --- | --- | --- |
| Agent | 一个可持续存在的工作者身份 | 员工 |
| Thread | 这个 Agent 的对话和工作历史 | 工作档案 |
| Turn | 从收到一项输入到本轮结束的一次工作 | 一次上班处理过程 |
| Message | 补充给 Agent 的信息 | 留言或便签 |
| Task | 明确要求 Agent 开始工作的输入 | 新工单 |
| Mailbox | 尚未交付给 Agent 的消息队列 | 收件箱 |

最容易犯的错误是把“Agent 完成当前 turn”理解成“Agent 已经消失”。实际上，turn 结束后
Agent 身份、thread 和 mailbox 都可以继续存在。下文为了便于理解，会把这种状态称为“空闲”；
Codex 协议中的正式状态名是 `Completed`，并没有单独的 `Idle` 枚举：

```text
Agent: /review_tests
Thread: 仍然保留
Turn 1: 已完成
状态: Completed（可以接收后续任务）
Turn 2: 以后可以由新任务启动
```

这个区别决定了为什么既需要 `send_message`，又需要 `followup_task`。

## 从单 Agent 实现推导 Multi-Agent 要增加什么

单 Agent 往往最初写成一个全局循环：

```text
while 没有 final answer:
    调用 model(context, tools)
    执行 tool call
    把 tool result 加入 context
```

为了同时运行多个 Agent，第一步不是添加 `spawn_agent`，而是把这个循环变成可以实例化、
可以结束、可以取消的运行单元。每个实例要拥有自己的 thread、context、mailbox、状态和当前
turn。工具、工作目录与权限等运行环境则按明确规则传入。

在它上面还要增加四类基础设施：

1. **Registry**：记录所有 live Agent、父子关系和当前状态。
2. **Scheduler**：启动 turn、限制并发、处理完成、失败和取消。
3. **Mailbox**：有序、可追踪地传递 Agent 间消息。
4. **Control tools**：让父 Agent 通过工具调用控制这些基础设施。

于是父 Agent 看到的 Multi-Agent 能力，本质上仍是普通工具：

```text
父 Agent 的模型调用
  -> spawn_agent 工具调用
  -> handler 创建一个新的 Agent Loop
  -> 工具结果返回 child agent id
  -> 父 Agent 继续原来的 Loop
```

## 六个动作分别改变什么

当前 V2 用六个动作表达不同意图：

```text
spawn_agent      创建 Agent，并启动它的第一个 turn
send_message     只投递消息，不保证启动 turn
followup_task    投递新任务，并在目标空闲时启动新 turn
wait_agent       等待 Agent 活动或用户的新输入
interrupt_agent  中断当前 turn，保留 Agent 身份
list_agents      查看 live Agent 树和状态
```

`close_agent`、`resume_agent` 和 `send_input` 是 legacy V1 名称，不要用它们理解 V2 的
生命周期。

### `spawn_agent`：创建工作者并派第一份任务

```text
不存在
  -> spawn_agent("检查测试覆盖")
  -> 创建 /review_tests
  -> 启动 Turn 1
  -> Running
```

它同时完成两件事：创建长期身份，以及启动第一次工作。

### `send_message`：补充信息

假设 `review_tests` 正在分析，父 Agent 发现还需要考虑 Windows：

```text
send_message("也检查 Windows 下的行为")
```

消息先进入 mailbox，再在安全边界交付。安全边界可能是模型生成过程允许接收消息的位置，
也可能是当前工具调用完成之后。系统不能在任意时刻改写一个正在执行的模型请求或工具调用。

如果目标 Agent 已经空闲，`send_message` 仍然只会排队：

```text
Completed + send_message -> mailbox 中多一条消息 -> 仍然 Completed
```

留言不应该自动消耗一次新的模型调用。

### `followup_task`：明确要求开始新工作

如果 `review_tests` 已经完成第一次检查，父 Agent 又要求它检查 Bazel：

```text
followup_task("继续检查这些测试在 Bazel 下能否运行")
```

当目标空闲时，这会启动一个新 turn：

```text
Completed + followup_task -> Turn 2 -> Running
```

当目标正在运行时，新任务会在模型消息边界或当前工具调用完成后交付。可以用一句话记住二者
的边界：

```text
send_message  = 我补充一点信息
followup_task = 我要求你开始一轮新工作
```

如果二者共用一个 API，系统就无法判断空闲 Agent 是否应该开始消耗模型预算，也很难追踪
是谁触发了新 turn。

### `wait_agent`：等待活动，而不是死等一个 Future

父 Agent 创建 worker 后，不必马上等待。它可以同时阅读总体 diff，直到自己的下一步确实
依赖 worker 结论，再调用 `wait_agent`。

`wait_agent` 等待的是当前 session 输入队列里的活动。以下情况都可能让它返回：

- 子 Agent 发来消息；
- 子 Agent 完成或状态变化；
- 用户发送了新的 steer 指令。

例如父 Agent 正在等测试结论，用户突然说“停止调查，先修编译错误”，等待必须立即结束，
让父 Agent 重新处理用户意图。它不能像普通 `join(child)` 一样一直阻塞到 child 完成。

`wait_agent` 返回的是“发生了什么活动”的摘要，不是自动把 child 的完整对话塞进父 context。
父 Agent 随后读取有界结果或查看状态，可以避免子 Agent 的大量历史污染父 context。

不要反复进行很短的轮询。如果父 Agent 还有不重叠的工作，应先继续；只有关键路径被结果
阻塞时才等待。

### `interrupt_agent`：停止当前 turn，不删除 Agent

如果 worker 启动了一个不再需要的长测试，可以中断它：

```text
Agent 身份     保留
Thread 历史    保留
Mailbox        保留
当前 Turn      中断
```

之后仍可以发送消息，或用 `followup_task` 启动新的 turn。这比删除并重建 Agent 更容易审计，
也保留了它已经得到的上下文。

中断不等于所有副作用瞬间消失。如果 worker 正在调用外部工具，runtime 可能需要等待安全收尾；
已经完成的文件写入或网络请求也不会自动撤销。

### `list_agents`：查看身份树和状态

Agent 身份形成一棵任务树。父 Agent 创建 `review_tests`，它又创建 `inspect_fixture`，同时
父 Agent 还创建了 `review_protocol`：

```text
/root
  /review_tests
    /inspect_fixture
  /review_protocol
```

同一分支内可以使用相对名称。跨 sibling branch 通信时应使用 canonical path，避免不同
分支中出现同名 Agent 后发生歧义。

`list_agents` 用来确认这些 Agent 是否仍然存在、正在运行还是已经空闲。它不是等待完成的
替代品。

## 用一次 PR 审查串起完整过程

现在看一个完整场景。用户要求审查大型 PR，重点检查业务逻辑、测试覆盖和协议兼容性。
三项工作能够独立产生结论，父 Agent 可以这样编排：

```text
1. spawn_agent(review_logic, "只读检查业务逻辑")
2. spawn_agent(review_tests, "只读检查测试覆盖")
3. spawn_agent(review_protocol, "只读检查协议兼容性")
4. 父 Agent 自己阅读总体 diff
```

工作进行中，父 Agent 发现测试还应覆盖 Windows：

```text
5. send_message(review_tests, "也检查 Windows 行为")
```

这只是对当前任务补充范围，因此使用 message。`review_tests` 完成后进入空闲状态，父 Agent
又发现需要一项新的 Bazel 检查：

```text
6. followup_task(review_tests, "检查测试在 Bazel 下能否运行")
```

这是新工作，因此触发新 turn。与此同时，协议 worker 开始运行一个不再需要的长命令：

```text
7. interrupt_agent(review_protocol)
8. list_agents()
```

父 Agent 做完自己的分析后，剩余结论成为关键路径：

```text
9. wait_agent()
10. 收集各 worker 的有界结果
11. 父 Agent 检查证据、diff 和测试，再形成最终结论
```

子 Agent 的“完成”不能代替父 Agent 验证。父 Agent 仍负责最终归因、冲突处理和面向用户的
答案。

## 什么时候值得拆分

多 Agent 的收益必须大于额外模型请求、上下文复制、消息和汇总成本。不要看到多个步骤就
自动创建多个 Agent。

| 问题 | 是 | 否 |
| --- | --- | --- |
| 子任务能独立完成并验收吗？ | 可考虑 spawn | 留在父 Agent |
| 父 Agent 下一步立即依赖结果吗？ | 通常本地完成 | 可后台并行 |
| 子任务需要隔离大量上下文吗？ | worker 有价值 | 单 Agent 更简单 |
| 多个写入范围能明确分开吗？ | 可以并行实现 | 避免并行写 |

“分别检查业务逻辑、测试、协议”适合并行，因为它们各自能提交独立证据。“先修改文件，再
运行该文件的测试”是强依赖链，拆给两个 Agent 只会增加等待和沟通。

## Fork 决定子 Agent 一开始知道什么

创建 worker 时，`fork_turns` 决定复制多少父 thread 历史：

| 选择 | 适用情况 | 代价或风险 |
| --- | --- | --- |
| `all` | 子任务强依赖完整对话 | 成本高，也复制无关信息和既有偏见 |
| 正整数，如 `3` | 只需要最近几轮约束 | 可能遗漏更早的重要要求 |
| `none` | 委派说明能够自包含 | 任务说明必须写完整 |

Fork 是历史复制，不是共享可变对话。子 Agent 有独立的 thread、turn 和 context。工作目录、
permission profile、approval policy、environment、tools 和 developer instructions 则按照
运行时规则继承或重新解析。模型默认继承父级；显式 override 仍要经过能力和配置校验。

不要用 full fork 弥补一句“帮我看看”的含糊委派。一个好的 worker 任务应该明确：

```text
目标：检查本次 PR 的测试覆盖。
范围：只读 core/suite 及本次 diff 涉及的测试。
证据：给出文件和相关类型或函数。
输出：结论、证据位置、未解决项，最多五条。
限制：不要修改文件，不要运行完整工作区测试。
停止条件：覆盖业务变化后立即返回；无法验证时说明缺少什么。
```

这种任务即使使用 `fork_turns: none`，worker 也知道怎样完成和验收。

## 独立 Context 不等于独立工作区

父子 Agent 有独立对话，但通常共享同一个文件系统：

```text
worker A ─┐
          ├── 同一个 src/auth.rs
worker B ─┘
```

如果 A 修改文件，B 同时格式化并修改它，结果会难以合并和归因。两种常见安全模式是：

1. worker 只读分析，父 Agent 统一编辑；
2. 给每个 worker 分配明确且互不重叠的 write set。

更复杂的系统也可以为 worker 创建独立 worktree 或容器，再显式合并 patch。但无论采用哪种
方式，父 Agent 最终都应检查 diff 和测试，不能只相信“worker 已完成”。

## 从单 Agent 项目分三步实现

如果你正在给 `mini-codex-agent` 增加 Multi-Agent，不必一次实现完整 V2。

第一步做同步委派：父 Agent 调用 `delegate(task)`，临时子 Agent 独立运行到完成，结果返回后
父 Agent 才继续。这一步只需要可实例化的 Agent Loop、独立 context 和有界结果，可以验证
“同一套 Loop 能否作为子 Agent 运行”。

第二步增加并发 worker：实现 Registry、后台调度以及 `spawn_agent`、`wait_agent` 和
`list_agents`。此时父 Agent 能在 worker 运行期间继续做自己的工作，但 worker 可以在完成后
直接结束，不必支持再次唤醒。

第三步增加长生命周期：实现 mailbox、Running/Completed 等状态、`send_message`、`followup_task`
和 `interrupt_agent`，再补上用户 steer、消息安全交付点以及完整 trace。这时才接近本课描述
的 Multi-Agent V2。

无论做到哪一步，都应设置硬限制：最大 live Agent 数、最大并发 turn 数、最大任务树深度、
消息大小、每个 worker 的时间和 token 预算。否则一个错误规划可能递归创建大量 Agent。

## 动手实验：观察状态，而不只观察答案

建立两个只读 worker：一个分析工具链，一个分析权限链；父 Agent 同时整理 Agent Loop。
实验的目标不是得到三份分析，而是记录每次动作前后的状态。

1. 用不同 task name 创建 worker，分别尝试 `all` 与 `none` fork。
2. worker 运行时发送 message，记录它在什么边界收到消息。
3. worker 空闲后发送 message，确认 mailbox 更新但没有新 turn。
4. 对空闲 worker 发送 follow-up task，确认新 turn 开始。
5. 父 Agent wait 时注入用户 steer，确认 wait 提前结束。
6. 中断一个长任务，再查看 Agent 树，确认身份和 thread 仍存在。
7. 要求 worker 只返回“结论、证据位置、未解决项”，比较父 context 增长。

为每一步保存类似下面的记录：

```text
动作前状态 -> 动作 -> mailbox 变化 -> 是否触发 turn -> 动作后状态
```

如果环境没有 V2 工具，可以用 fake registry、mailbox 和状态机模拟。重点是观察 agent id、
parent id、turn id、message、trigger_turn 和状态变化，而不是一定调用真实模型。

## 常见误区

- `send_message` 会唤醒空闲 Agent。V2 中它只排队。
- Agent 完成一个 turn 后就不存在了。身份和 thread 可以继续保留。
- `wait_agent` 只等 child completion。用户 steer 也能结束等待。
- interrupt 等于删除。它只中断当前 turn。
- full fork 总是最好。无关上下文、成本和偏见也会被复制。
- 独立 Agent 自动拥有独立工作区。它们仍可能竞争同一文件。
- worker 报告完成就可以直接回答用户。父 Agent 仍需验证和汇总。

## 理解之后再对照 Codex 源码

阅读源码时，不要先遍历整个 agent 模块。带着前面实验的状态变化，从“身份如何创建”开始。
打开 `core/src/agent/control.rs` 和 `control/spawn.rs`，观察 spawn 怎样产生 child control；然后
看 `registry.rs` 与 `status.rs`，确认 Agent 身份、父子关系和状态怎样保存。读到能够解释
`list_agents` 的数据来源时先停下来。

接下来进入 `core/src/tools/handlers/multi_agents_v2`，依次看六个 handler 如何把模型工具调用
翻译成控制动作。比较 `message_tool.rs` 中 message 与 follow-up task 的分支，再看上一级
`core/src/tools/handlers/multi_agents_common.rs` 的跨版本共用逻辑。此时只追踪一次调用，不必
展开所有错误类型。

最后打开 `core/src/session/input_queue.rs`。沿着一条 Agent 间消息入队，观察它怎样在安全点
成为 `TurnInput::InterAgentCommunication`。再用 `session/multi_agents.rs` 和
`turn_context.rs` 补全当前 mode、usage hint 与运行时继承。读到能够解释“为什么 message
不会任意改写正在运行的请求”时，这条源码路径就已经完成。

## 本课验收

完成本课后，你应该能够：

1. 从单 Agent Loop 推导出 Registry、Scheduler、Mailbox 和控制工具的必要性。
2. 用 Agent、Thread、Turn、Message 和 Task 解释一个 worker 的生命周期。
3. 准确说明六个 V2 动作，以及三个 legacy V1 名称为什么不用于解释 V2。
4. 根据 worker 状态判断应该使用 message、follow-up task、wait 还是 interrupt。
5. 为一个 worker 选择 fork 范围，并写出自包含、可验收的任务契约。
6. 设计用户 steer、中断和共享工作区冲突的恢复方案。
