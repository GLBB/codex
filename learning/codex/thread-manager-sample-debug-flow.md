# ThreadManager Sample Debug 源码跟读

本文以 `codex-rs/thread-manager-sample` 作为 debug 入口，跟一条最小的 Codex 执行链路：启动 thread，提交一次用户输入，消费事件流，然后关闭 thread。它适合用来理解 `codex-rs` 的核心执行模型，因为 sample 绕开了 TUI、完整 CLI 和 app-server JSON-RPC，只保留了嵌入式调用方真正要接触的 `ThreadManager` 与 `CodexThread`。

如果你已经读过 `learning/codex/query-processing-flow.md`，可以把本文看成更窄的“源码断点版”：前者从用户 query 的产品入口讲完整链路，本文从 `thread-manager-sample` 的 debug 体验讲 core 内部对象如何协作。

## 先看入口

从 `codex-rs/thread-manager-sample/src/main.rs` 开始。这个文件只有三块需要跟：

第一块是 `main` 和 `run_main`。`main` 只把控制权交给 `arg0_dispatch_or_else(run_main)`；真正的业务在 `run_main`。读 `run_main` 时不要急着跳进每个 helper，先看它的顺序：读 prompt，构造 `Config`，初始化状态库、认证、环境、thread store、用户指令 provider，然后创建 `ThreadManager`。

第二块是 `new_config`。它手工拼出一份一次性、只读、短生命周期的 `Config`。这个 sample 使用 OpenAI 内置 provider，权限是 `AskForApproval::Never` 加 `PermissionProfile::read_only()`，web search 和大部分额外上下文注入都关闭，`experimental_thread_store` 是 local。这个配置画像决定了 debug 时常见现象：如果模型想执行需要审批或写文件的操作，sample 不会弹 UI，而是把对应请求当成失败路径返回。

第三块是 `run_turn`。它把 prompt 包成 `Op::UserInput` 提交给 `CodexThread`，然后循环调用 `next_event`。它只把部分 `EventMsg` 映射成 app-server notification 形状并按 NDJSON 输出；遇到 `TurnComplete` 就成功返回，遇到审批、权限、动态工具或用户追问请求就直接报错。

## 总调用链

把断点放在 `run_main` 里，主链路是：

```text
thread-manager-sample::main
  -> arg0_dispatch_or_else(run_main)
  -> run_main
     -> new_config
     -> init_state_db
     -> AuthManager::shared_from_config
     -> thread_store_from_config
     -> EnvironmentManager::from_codex_home
     -> ThreadManager::new
     -> ThreadManager::start_thread
     -> run_turn
        -> CodexThread::submit(Op::UserInput)
        -> CodexThread::next_event loop
     -> CodexThread::shutdown_and_wait
     -> ThreadManager::remove_thread
```

这条链路里最重要的对象关系是：

```text
ThreadManager
  owns live thread map and shared services
  creates
CodexThread
  thin public handle around
Codex
  owns submission queue, event queue, Session, session loop task
Session
  owns history, active turn, tools, MCP, rollout persistence, mutable runtime state
SessionTask
  owns one active workflow such as RegularTask, CompactTask, ReviewTask
run_turn
  drives the normal model/tool sampling loop for RegularTask
```

## 启动 Thread

从 `ThreadManager::start_thread` 读到 `ThreadManagerState::spawn_thread_with_source`。源码在 `codex-rs/core/src/thread_manager.rs`。

`start_thread` 本身只是便利入口，它调用 `start_thread_with_tools(config, Vec::new())`。`start_thread_with_tools` 会通过 `default_thread_environment_selections` 补齐默认执行环境，然后进入 `start_thread_with_options`。这样设计的好处是：sample 用最小 API，app-server、fork、resume、subagent 则可以走同一套更完整的 options 路径。

真正创建 thread 的地方是 `spawn_thread_with_source`。这里会做几件事：

1. 如果是 resumed thread，先检查同一个 thread 是否已经在内存中运行。
2. 加载本次 spawn 的用户指令。
3. 推导 parent rollout trace、multi-agent version、originator。
4. 调用 `Codex::spawn` 创建底层 session。
5. 调用 `finalize_thread_spawn` 读取第一条事件，要求它必须是 `SessionConfigured`。
6. 把 `Codex` 包成 `CodexThread` 并放进 `ThreadManagerState.threads`。

这里的 `SessionConfigured` 很关键。它是 thread 创建后的第一条事件，告诉调用方 thread id、session id、rollout path、模型、权限等启动结果。`ThreadManager` 会先消费掉这条事件，再把 `session_configured` 放进 `NewThread` 返回给调用方。因此 sample 后面的 `run_turn` 只会读到用户 turn 产生的事件。

## Codex::spawn 做什么

继续跳到 `codex-rs/core/src/session/mod.rs` 的 `Codex::spawn` 和 `spawn_internal`。

`Codex::spawn` 是 tracing 包装层，`spawn_internal` 才是真正初始化。读这段时可以按“通道、配置、Session、loop”四步理解。

第一步是建立两个 async channel：

```text
tx_sub / rx_sub       调用方向 core 提交 Op
tx_event / rx_event   core 向调用方发送 Event
```

第二步是把配置解析成运行时可用的 `SessionConfiguration`。这里会选择默认模型，解析 model info，确定 base instructions、collaboration mode、service tier、权限 profile、环境选择、dynamic tools、history mode、thread source 和 originator。

第三步是创建 `Session::new`。`Session` 是 core 的重心，它持有 history、rollout writer、MCP runtime、plugins、skills、tools、environment manager、active turn、extension data、telemetry 等。`ThreadManager` 更像“thread 生命周期管理器”，`Session` 才是“一个 thread 内部如何跑”的拥有者。

第四步是启动后台 `submission_loop`：

```text
tokio::spawn(submission_loop(session_for_loop, config, rx_sub))
```

返回的 `Codex` 里保存 `tx_sub`、`rx_event`、`session` 和 `session_loop_termination`。这解释了 `CodexThread` 为什么很薄：它只是把 public API 委托给 `Codex`。

## 提交一次用户 Turn

回到 sample 的 `run_turn`。`CodexThread::submit` 会进入：

```text
CodexThread::submit
  -> Codex::submit
  -> Codex::submit_with_trace
  -> Codex::submit_with_id
  -> tx_sub.send(Submission)
```

`Submission` 包含一个 submission id、`Op`、可选 trace 和可选 client user message id。sample 发的是 `Op::UserInput`，内容是一个 `UserInput::Text`。

然后后台 `submission_loop` 在 `codex-rs/core/src/session/handlers.rs` 收到它。`submission_loop` 是 `Op` 分派表：`Interrupt` 走中断，`Compact` 走 compact task，`Review` 走 review，审批回复回填 pending waiter；普通用户输入走 `user_input_or_turn`。

`user_input_or_turn_inner` 是从 `Op::UserInput` 到普通任务的关键桥：

1. 应用 turn 级 `thread_settings`，如果本次请求带了模型、权限、环境等覆盖。
2. 调用 `new_turn_with_sub_id` 创建本轮 `TurnContext`。
3. 尝试 `steer_input`。如果当前已有可 steering 的 active turn，就把输入追加给当前 turn。
4. sample 的首轮没有 active turn，于是 `SteerInputError::NoActiveTurn` 分支把输入包装成 `TurnInput::UserInput`。
5. 调用 `sess.spawn_task(..., RegularTask::new())`。

这里要区分三个名字：`Submission` 是进入 session loop 的操作 envelope；`Op::UserInput` 是协议层的用户输入操作；`TurnInput` 是 task/run_turn 内部要记录进 history 或参与采样的输入项。

## SessionTask 与 active_turn

`codex-rs/core/src/tasks/mod.rs` 定义了 `SessionTask`。这是一个小 trait，用来把不同工作流统一成“一个 session 里正在跑的 task”。普通聊天是 `RegularTask`，压缩是 `CompactTask`，review 是 `ReviewTask`。

`Session::spawn_task` 会先 `abort_all_tasks(TurnAbortReason::Replaced)`，再 `start_task`。这表达了一个重要设计：同一个 `Session` 同一时间最多有一个 running task。新 task 会替换旧 task；运行中的追加输入、审批回复、动态工具回复等则进入 active turn 的 pending maps 或 input queue。

`start_task` 会创建 cancellation token，初始化或复用 `ActiveTurn`，触发 turn start lifecycle，然后 `tokio::spawn` 执行 task。task 结束后统一回到 `Session::on_task_finished`，由它发 `TurnComplete` 或 `TurnAborted`，记录 token/turn metrics，清理 active turn，并 flush rollout。

`codex-rs/core/src/state/turn.rs` 里的 `ActiveTurn` 和 `TurnState` 值得停一下。`ActiveTurn` 保存当前 running task；`TurnState` 保存这个 turn 里的 pending approvals、pending request user input、pending dynamic tools、pending input、tool call 计数和 token 起点。审批回复能回到正在等待的工具调用，就是靠这些 pending maps 串起来的。

## RegularTask 到 run_turn

sample 的普通输入会进入 `codex-rs/core/src/tasks/regular.rs`。

`RegularTask::run` 先发 `EventMsg::TurnStarted`。这也是 sample 的 `run_turn` 外层事件循环为什么先记录 `current_turn_id`：后续映射成 app-server notification 需要 thread id 和 turn id。

随后它处理 session startup prewarm。如果预热可用，就把预热好的 `ModelClientSession` 交给 `run_turn`；不可用则创建普通 model client session；如果 cancellation 发生，就直接返回。

然后进入一个外层 loop：

```text
run_turn(...)
if no pending input:
  return
else:
  next_input = Vec::new()
  continue
```

这个 loop 解决的是“模型运行期间又来了输入”的问题。第一次 `run_turn` 使用提交时的 `TurnInput`；如果运行过程中 input queue 里还有 pending input，下一次调用 `run_turn` 会让它们从 queue 进入历史和下一次采样。

## run_turn 内部循环

`codex-rs/core/src/session/turn.rs` 的 `run_turn` 是普通 agent loop 的核心。读它时建议分成三层。

第一层是模型请求前准备：

1. `run_pre_sampling_compact` 检查是否需要先压缩上下文。
2. `capture_step_context` 固化本次采样所需的 MCP、tools、环境、配置快照。
3. `record_context_updates_and_set_reference_context_item` 把本轮上下文变化记录进 history。
4. `build_skills_and_plugins` 根据用户输入里显式提到的 skill、plugin、app 注入相关指导。
5. `run_pending_session_start_hooks` 与 `run_hooks_and_record_inputs` 运行 lifecycle/input hooks，并把输入记录进 conversation history。
6. 更新 connector selection、previous turn settings、analytics。

第二层是采样循环。每次循环会拿 pending input，必要时记录 time reminder 或 world state，然后从 history 生成模型输入：

```text
sess.clone_history().await.for_prompt(...)
```

接着调用 `run_sampling_request`。那里会构建本轮可见工具，创建 `ToolCallRuntime`，发起模型 stream，并把 stream 事件转换成 Codex 的 `EventMsg` 与 history item。

第三层是 follow-up 判断。一次模型 stream 结束后，`run_turn` 会判断：

- 模型是否请求了工具，工具结果是否需要再发回模型。
- 运行期间是否有 pending input。
- token 是否触达 auto-compact 阈值。
- stop hooks 是否要求继续或停止。

只要还需要 follow-up，就继续下一次采样。直到模型给出最终 assistant message，且没有工具 follow-up、没有 pending input、没有 hook continuation，`run_turn` 才返回最后一条 agent message。

## 事件如何回到 sample

core 内部发送事件主要通过 `Session::send_event` 或 `send_event_raw`。事件会进入 `tx_event`，sample 的 `CodexThread::next_event` 从 `rx_event` 取出。

sample 对事件做两件事。

第一件事是把部分 item/tool/agent 事件映射成 app-server notification：

```text
EventMsg
  -> item_event_to_server_notification
  -> serde_json line on stdout
```

这就是为什么 sample 输出看起来像 app-server：它复用了 app-server protocol 的通知模型，但没有跑 app-server JSON-RPC server。

第二件事是处理终止条件。`TurnComplete` 表示本次 turn 成功；`Error`、`TurnAborted`、审批请求、权限请求、用户追问请求、动态工具请求都让 sample 失败返回。完整 TUI/app-server 会把这些请求展示给用户并把回复作为新的 `Op` 提交回去；sample 为了保持一次性最小示例，没有实现这些交互。

## 清理路径

sample 的清理顺序是刻意写成：

```text
let turn_output = run_turn(...).await;
let shutdown_result = thread.shutdown_and_wait().await;
let _ = thread_manager.remove_thread(&thread_id).await;

turn_output?;
shutdown_result?;
```

也就是说，即使 turn 中途因为审批或错误失败，它也会先尝试 shutdown。

`CodexThread::shutdown_and_wait` 会委托到 `Codex::shutdown_and_wait`：提交 `Op::Shutdown`，然后等待 `submission_loop` 结束。`submission_loop` 的 shutdown 分支会停止预热、取消 tasks、关闭 realtime、终止 unified exec 进程、关闭 code mode、MCP、guardian review session，触发 thread stop lifecycle，flush thread persistence，最后发 `ShutdownComplete`。

`ThreadManager::remove_thread` 只从 manager 的 live thread map 移除这个 `thread_id`。它不替代 session shutdown，所以 sample 两步都做。

## 概念速记

`ThreadManager`：进程内 thread 管理器。它持有共享服务和 live thread map，负责 start、resume、fork、remove、shutdown many threads。

`Thread`：产品语义上的一条对话/任务线。它有 `ThreadId`、history、rollout、metadata，可以被恢复、fork、归档。

`CodexThread`：core 暴露给调用方的 thread handle。它提供 `submit`、`next_event`、`shutdown_and_wait` 等方法，内部委托给 `Codex`。

`Codex`：一个 session 的双队列外壳。调用方通过 submission queue 放 `Op`，通过 event queue 读 `Event`。

`Session`：一个 thread 的运行时主体。它拥有上下文历史、工具系统、MCP、权限、rollout、active turn、extension lifecycle、telemetry。

`Submission`：进入 session loop 的封包，包含 id、`Op`、trace、client user message id。

`Op`：调用方对 session 发出的操作，比如用户输入、中断、审批回复、compact、shutdown。

`EventMsg`：core 对调用方发出的事件，比如 `TurnStarted`、文本 delta、工具开始/结束、审批请求、错误、`TurnComplete`。

`TurnContext`：单个 turn 的配置快照。模型、权限、环境、工具、MCP、feature flags、trace 和 telemetry 都从这里取，避免 turn 运行中配置漂移。

`SessionTask`：active turn 中实际运行的工作流抽象。普通聊天、compact、review 都实现它。

`RegularTask`：普通用户 turn 的 task，负责发 `TurnStarted`，处理 startup prewarm，然后调用 `run_turn`。

`run_turn`：普通 agent loop。它组上下文、调模型、处理模型 stream、执行工具、把工具结果送回模型，直到 turn 完成。

`rollout`：thread 的持久化事件/历史记录。resume、fork、debug trace 都依赖它。

## 建议断点顺序

第一次 debug 不要全程 step into，否则会被配置、telemetry 和 extension 细节淹没。建议先按这个顺序停：

1. `thread-manager-sample/src/main.rs` 的 `run_main`：确认 sample 装配了哪些服务。
2. `core/src/thread_manager.rs` 的 `spawn_thread_with_source`：观察 thread spawn 参数如何汇总。
3. `core/src/session/mod.rs` 的 `Codex::spawn_internal`：看 channel、`SessionConfiguration`、`Session::new`、`submission_loop` 如何建立。
4. `core/src/session/handlers.rs` 的 `submission_loop`：看 `Op::UserInput` 如何分派。
5. `core/src/session/handlers.rs` 的 `user_input_or_turn_inner`：看输入如何变成 `RegularTask`。
6. `core/src/tasks/mod.rs` 的 `Session::start_task`：看 active turn 和 background task 如何创建。
7. `core/src/tasks/regular.rs` 的 `RegularTask::run`：看 `TurnStarted` 和 startup prewarm。
8. `core/src/session/turn.rs` 的 `run_turn`：看上下文注入、采样循环、follow-up 判断。
9. `core/src/tasks/mod.rs` 的 `Session::on_task_finished`：看 `TurnComplete`、metrics、active turn 清理。
10. 回到 sample 的 `run_turn`：看 `next_event` 如何把 core 事件映射并输出。

第二遍再选择性跳进工具系统，例如 `run_sampling_request`、`ToolCallRuntime`、`ToolRouter` 和 `ToolOrchestrator`。如果当前 prompt 只是让模型回答文本，工具分支可能不会触发；想观察工具路径，可以让 prompt 明确要求读取当前目录或运行一个只读命令，但 sample 的只读权限和无审批策略会影响可执行范围。

## 和完整 Codex 入口的区别

`thread-manager-sample` 展示的是 core 嵌入方式，不是完整产品入口。

完整 CLI/TUI/app-server 还会多出几层：

- CLI/TUI 解析用户交互、渲染状态、处理审批和追问。
- app-server 把 JSON-RPC `thread/start`、`turn/start` 映射成 `ThreadManager` 与 `CodexThread` 调用。
- TUI/app-server 会处理 `ExecApprovalRequest`、`ApplyPatchApprovalRequest`、`RequestUserInput`、`RequestPermissions`，再把用户决策提交回 `Op`。
- 多 thread UI 会保留多个 live `CodexThread`，而 sample 一次只启动一个，执行完就移除。

所以 sample 最适合回答“Codex core 怎么被调用、一个 turn 怎么进入 session loop、普通 agent loop 怎么启动”。要理解用户界面、协议兼容和多会话管理，再接着读 app-server 和 TUI。

## 一句话总结

`thread-manager-sample` 把 Codex core 的执行流程压缩成一个可 debug 的最小闭环：

```text
Config 和运行时服务
  -> ThreadManager 创建 CodexThread
  -> Codex 双队列连接调用方和 Session
  -> submission_loop 把 Op::UserInput 分派成 RegularTask
  -> RegularTask 调 run_turn
  -> run_turn 反复采样模型和执行工具
  -> EventMsg 通过 event queue 回到 sample
  -> sample 输出 notification 并清理 thread
```

读懂这条链路，再看 TUI、app-server、MCP、skills、multi-agent 时，就能把它们放回同一个骨架里，而不是一团异步函数乱飞。
