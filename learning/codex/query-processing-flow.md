# Codex Query 处理流程

本文聚焦一条 query 从用户输入到模型响应、工具执行、事件回传、日志落盘的完整路径。这里的 query 指一次用户发给 Codex 的请求；在 app-server 协议里通常对应一个 `turn/start`，在 core 里会变成 `Op::UserInput` 和一个 `RegularTask`。

## 怎么把项目跑起来

仓库根目录的常用命令依赖 `just`。如果本机没有这个命令，先安装：

```bash
cargo install just
```

最小的本地运行入口是 `codex exec`。它会在进程内启动 app-server harness，创建或恢复 thread，然后发送一次 turn。

```bash
cd /home/goulei/code/codex
just exec "解释一下 codex-rs/core/src/session/turn.rs 做什么"
```

如果只想确认 CLI 能构建并启动，不想真的调模型，可以先跑帮助：

```bash
cd /home/goulei/code/codex
just codex --help
just exec --help
```

想观察 app-server 协议层，可以用测试客户端。这个方式适合看 `thread/start`、`turn/start` 和服务端通知。

```bash
cd /home/goulei/code/codex/codex-rs

cargo build -p codex-cli --bin codex

cargo run -p codex-app-server-test-client -- \
  --codex-bin ./target/debug/codex \
  serve --listen ws://127.0.0.1:4222 --kill
```

另开一个终端：

```bash
cd /home/goulei/code/codex/codex-rs
cargo run -p codex-app-server-test-client -- send-message-v2 "解释一下 core 的 turn loop"
```

如果要看原始 inbound JSON-RPC 通知：

```bash
cd /home/goulei/code/codex/codex-rs
cargo run -p codex-app-server-test-client -- watch
```

## 有哪些运行日志

Codex 运行时主要有三类可观察信息。

第一类是 tracing 日志。`RUST_LOG` 控制日志级别，`LOG_FORMAT=json` 可以让 app-server 把 tracing 日志按 JSON lines 输出到 stderr。

```bash
cd /home/goulei/code/codex
RUST_LOG=codex_core=trace,codex_app_server=trace,codex_exec=debug just exec "只回答 OK"
```

app-server JSON 日志示例：

```bash
cd /home/goulei/code/codex/codex-rs
RUST_LOG=codex_app_server=trace,codex_core=trace LOG_FORMAT=json \
  cargo run -p codex-app-server-test-client -- \
  --codex-bin ./target/debug/codex \
  serve --listen ws://127.0.0.1:4222 --kill
```

第二类是 app-server test client 的服务日志。用 `serve` 启动时，日志会写到：

```text
/tmp/codex-app-server-test-client/app-server.log
```

第三类是状态库日志。仓库根目录的 `just log` 会调用 `codex-state` 的 `logs_client` 去 tail SQLite 状态库中的日志：

```bash
cd /home/goulei/code/codex
just log
```

还有一个很重要的运行痕迹是 rollout。app-server 的 `thread/start` / `thread/resume` 响应里会返回 thread 的 `path`；那通常是当前 thread 的 JSONL transcript。`Session::send_event_raw` 会把 `EventMsg` 持久化成 rollout item，然后再发给客户端。

## 总体调用链

一条普通 query 的主链路如下：

```text
用户输入
  -> CLI/TUI/IDE/app-server client
  -> app-server thread/start 或 thread/resume
  -> app-server turn/start
  -> CodexThread::submit(Op::UserInput)
  -> Codex::submit / submit_with_id
  -> session_loop 收到 Submission
  -> Session 创建 TurnContext
  -> Session::spawn_task(RegularTask)
  -> RegularTask::run
  -> run_turn
  -> run_sampling_request
  -> ModelClientSession::stream
  -> ResponseEvent stream
  -> tool call dispatch / item events / token usage
  -> TurnComplete
```

对应源码入口：

| 阶段 | 主要文件 | 作用 |
| --- | --- | --- |
| app-server 协议 | `codex-rs/app-server-protocol/src/protocol/v2/thread.rs` | 定义 `thread/start`、`thread/resume` 参数 |
| turn 协议 | `codex-rs/app-server-protocol/src/protocol/v2/turn.rs` | 定义 `turn/start`、`turn/steer`、`turn/interrupt` |
| exec 入口 | `codex-rs/exec/src/lib.rs` | `codex exec` 创建 thread 并发送 `turn/start` |
| core 提交 | `codex-rs/core/src/session/mod.rs` | `Codex::submit` 把 `Op` 放进 submission queue |
| 任务调度 | `codex-rs/core/src/tasks/mod.rs` | 管理 `active_turn`、取消旧任务、启动新任务 |
| 普通任务 | `codex-rs/core/src/tasks/regular.rs` | 发 `TurnStarted`，调用 `run_turn` |
| agent loop | `codex-rs/core/src/session/turn.rs` | 构建上下文、调模型、处理 stream 和工具 |
| 工具路由 | `codex-rs/core/src/tools/router.rs` | 把模型 output item 转成内部 `ToolCall` |
| 工具执行 | `codex-rs/core/src/tools/orchestrator.rs` | 处理审批、沙箱、网络策略、重试 |

## 第 1 步：入口把 query 变成 turn/start

以 `codex exec "..."` 为例，`codex-rs/exec/src/lib.rs` 会先解析 CLI、加载 config、初始化 in-process app-server client。

如果是新会话，它发送：

```text
ClientRequest::ThreadStart
```

如果指定 resume，它发送：

```text
ClientRequest::ThreadResume
```

拿到 thread id 后，exec 再发送：

```text
ClientRequest::TurnStart {
    params: TurnStartParams {
        thread_id,
        input,
        cwd,
        approval_policy,
        effort,
        output_schema,
        ...
    }
}
```

这一步的重点是：用户输入还没有直接进入模型。它先被包装成 app-server 协议对象，绑定 thread、cwd、权限、模型参数和可选输出 schema。

## 第 2 步：turn/start 进入 core submission queue

app-server 找到目标 `CodexThread` 后，会调用 thread handle 的提交入口。`CodexThread` 本身很薄，核心是把 `Op` 交给底层 `Codex`：

```text
CodexThread::submit
  -> Codex::submit
  -> Codex::submit_with_trace
  -> Codex::submit_with_id
  -> tx_sub.send(Submission)
```

`Submission` 包含：

- 一个唯一 submission id
- `Op::UserInput`
- 可选 trace context
- 可选 client user message id

`Op::UserInput` 里保存用户输入 items、turn 级环境、输出 schema、Responses API metadata、additional context，以及可能需要先应用的 thread settings overrides。

这一步的重点是：Codex 使用队列串行化用户操作。`turn/start`、thread settings 更新、审批回复、interrupt 等都进入同一类提交通道，这样可以保证顺序。

## 第 3 步：session_loop 分派 Op

`Session` 初始化时会启动 `submission_loop`。这个 loop 从 `rx_sub` 接收 `Submission`，再按 `Op` 类型分派。

普通 query 会走 `Op::UserInput`。在这里会做几件事：

1. 应用 `thread_settings`，比如模型、cwd、权限或 collaboration mode。
2. 创建本轮的 `TurnContext`。
3. 把用户输入包装成 `TurnInput::UserInput`。
4. 启动一个 `RegularTask`。

`TurnContext` 是单回合快照。它把本轮运行所需的模型、权限、cwd、sandbox、MCP、skills、dynamic tools、feature flags、extension data、token 统计和 trace 信息固化下来。这样后续模型和工具执行都用同一份回合配置。

## 第 4 步：Session 调度 active_turn

`Session::spawn_task` 会先中断已有任务：

```text
spawn_task
  -> abort_all_tasks(TurnAbortReason::Replaced)
  -> clear_connector_selection
  -> start_task
```

`start_task` 会：

1. 记录 turn start 时间。
2. 创建 cancellation token。
3. 从 `InputQueue` 取出已经 pending 的输入。
4. 初始化或复用 `active_turn`。
5. 触发 turn start lifecycle。
6. 创建 `RunningTask`。
7. `tokio::spawn` 真正执行 `RegularTask::run`。

这里有一个重要设计：同一个 `Session` 同一时间最多一个 running task。新 query 会替换旧 task，`turn/steer` 和 mailbox 则可以把输入塞进当前 active turn 的 pending queue。

## 第 5 步：RegularTask 发 TurnStarted 并进入 run_turn

`RegularTask::run` 是普通 query 的任务实现。它先发：

```text
EventMsg::TurnStarted
```

客户端收到后会知道这个 turn 真正开始跑了。然后它调用：

```text
run_turn(sess, turn_context, turn_extension_data, input, prewarmed_client_session, cancellation_token)
```

`RegularTask` 外面还有一个 loop：如果 `run_turn` 返回时发现 `InputQueue` 里还有 pending input，就继续调用 `run_turn`，但 `next_input` 为空。这样用户在模型运行期间追加的输入可以被同一个 active turn 消化，而不是一定要开新 turn。

## 第 6 步：run_turn 做模型请求前准备

`run_turn` 开头会先处理上下文和注入项：

1. `run_pre_sampling_compact`：如果上下文太大，先自动 compact。
2. `record_context_updates_and_set_reference_context_item`：记录本轮配置变化，让模型知道 cwd、sandbox、model 等上下文变化。
3. `build_skills_and_plugins`：根据用户输入中的显式 skill/plugin/app mention，注入 skill instructions、plugin 能力说明和 extension turn input。
4. `run_pending_session_start_hooks`：执行 session start hook。
5. `run_hooks_and_record_inputs`：运行输入 hook，并把用户输入记录进 conversation history。
6. 更新 connector selection 和 previous turn settings。
7. 记录 analytics，比如本轮模型、权限、图片数量、是否 first turn。

这一步结束后，用户 query 已经成为模型可见历史的一部分；skills、plugins、hooks、additional context 也已经按规则注入。

## 第 7 步：构建 Prompt 和工具清单

进入采样前，`run_turn` 会从 session history 构建模型输入：

```text
sess.clone_history().await.for_prompt(...)
```

随后 `run_sampling_request` 会调用 `built_tools`，构建 `ToolRouter`。这里会收集：

- 内置工具，如 shell、apply_patch、文件相关工具
- MCP tools
- app/connectors tools
- dynamic tools
- extension tools
- deferred/discoverable tools，比如 tool search

最后 `build_prompt` 把这些组成模型请求：

```text
Prompt {
    input,
    tools: router.model_visible_specs(),
    parallel_tool_calls,
    base_instructions,
    personality,
    output_schema,
}
```

这一步的重点是：工具不是硬编码直接塞给模型，而是由 `ToolRouter` 根据本轮 `TurnContext`、MCP 状态、插件配置和 feature flags 动态生成。

## 第 8 步：ModelClientSession 开始 stream

`try_run_sampling_request` 调用：

```text
client_session.stream(prompt, model_info, telemetry, effort, summary, service_tier, ...)
```

返回的是 `ResponseEvent` stream。常见事件包括：

| 事件 | 含义 |
| --- | --- |
| `Created` | 模型 response 已创建 |
| `OutputItemAdded` | 一个模型输出 item 开始出现 |
| `OutputTextDelta` | assistant 文本增量 |
| `ToolCallInputDelta` | 工具调用参数流式增量 |
| `ReasoningSummaryDelta` | reasoning summary 增量 |
| `OutputItemDone` | 一个输出 item 完成 |
| `RateLimits` | 最新 rate limit 信息 |
| `Completed` | 本次模型 response 完成 |

Codex 一边消费 stream，一边把用户可见事件发给客户端。例如 assistant 文本会变成 `AgentMessageContentDelta`，完整 item 会变成 `item/started` 和 `item/completed`。

## 第 9 步：模型要求工具时，转成 ToolCall

当 `ResponseEvent::OutputItemDone(item)` 到达时，`handle_output_item_done` 会判断这个 item 是普通 assistant message、reasoning，还是工具调用。

工具调用会经过：

```text
ToolRouter::build_tool_call(ResponseItem)
```

它支持几类模型输出：

- `ResponseItem::FunctionCall`
- `ResponseItem::CustomToolCall`
- client 执行的 `ResponseItem::ToolSearchCall`

解析成功后得到内部结构：

```text
ToolCall {
    tool_name,
    call_id,
    payload,
}
```

之后 `ToolRouter` 会把调用派发到 `ToolRegistry`，由注册的具体工具 executor 处理。

## 第 10 步：ToolOrchestrator 处理审批、沙箱和执行

需要真实执行副作用的工具会经过 `ToolOrchestrator`。它的核心顺序是：

```text
approval
  -> select sandbox
  -> run attempt
  -> network approval handling
  -> retry / escalation when allowed
```

审批阶段会根据 `approval_policy`、文件系统 sandbox、命令风险、Guardian/strict auto review、permission hooks 等决定是否发审批请求。比如 shell 命令可能发：

```text
EventMsg::ExecApprovalRequest
```

patch 可能发：

```text
EventMsg::ApplyPatchApprovalRequest
```

客户端回复审批后，结果再通过 `Op::ExecApproval` 或 `Op::PatchApproval` 回到同一个 `active_turn` 的 pending approval map。

沙箱阶段会选择当前权限下的执行策略，比如 workspace-write、read-only、网络限制、managed network proxy、exec policy 等。如果第一次尝试被 sandbox 拒绝，且策略允许，orchestrator 可以在不重复打扰用户的情况下用升级后的 sandbox 策略重试。

## 第 11 步：工具结果回到模型上下文

工具执行结束后，结果不会只展示给用户；它还会转换成模型可读的 output item，记录进 conversation history。

这就是 agent loop 能继续工作的原因：

```text
模型请求工具
  -> Codex 执行工具
  -> 工具 output 记录进 history
  -> needs_follow_up = true
  -> 下一次 sampling_request
```

如果模型连续请求多个工具，Codex 会继续循环，直到模型返回最终 assistant message，且没有 pending input，也没有 tool follow-up。

## 第 12 步：TurnComplete 和持久化

当 `run_turn` 判断不需要 follow-up 后，会运行 stop hooks 和 legacy after-agent hook，然后返回最后一条 agent message。

`start_task` 里包裹 task 的 spawn 逻辑会调用：

```text
sess.on_task_finished(...)
```

它负责：

1. flush rollout。
2. 记录 turn profile 和 token usage。
3. 发 `EventMsg::TurnComplete`。
4. 清理 guardian circuit breaker。
5. 清掉 `active_turn`。
6. 如果 thread idle，触发 thread idle lifecycle。

`Session::send_event` / `send_event_raw` 会先把事件写入 rollout，再通过 `tx_event` 发给 app-server/CLI/TUI。客户端最终看到的是 app-server 通知：

```text
turn/started
item/started
item/agentMessage/delta
item/completed
turn/completed
```

## 读日志时怎么看

建议按这几个关键词找：

| 关键词 | 说明 |
| --- | --- |
| `thread/start` | 新建 thread |
| `thread/resume` | 恢复已有 thread |
| `turn/start` | 用户 query 进入 turn |
| `session_loop` | core submission loop |
| `turn` | task 级 tracing span |
| `run_turn` | agent loop |
| `stream_request` | 发起模型 stream |
| `handle_responses` | 消费 Responses API stream |
| `OutputItemDone` | 一个模型输出 item 完成 |
| `ExecApprovalRequest` | 命令需要审批 |
| `ApplyPatchApprovalRequest` | patch 需要审批 |
| `TurnComplete` | turn 完成 |

如果是 app-server test client，优先看：

```bash
tail -f /tmp/codex-app-server-test-client/app-server.log
```

如果是 `codex exec`，优先打开 stderr tracing：

```bash
RUST_LOG=codex_exec=debug,codex_core=trace just exec "只回答 OK"
```

如果要看持久化后的事件序列，找到 `thread.path` 对应的 rollout JSONL，按行查看。它能回答两个问题：

1. 哪些事件被持久化了。
2. resume 时会用哪些历史重建上下文。

## 一句话总结

Codex 处理 query 不是“prompt 进模型、文本出来”这么简单，而是：

```text
协议封装 -> 提交队列 -> turn 快照 -> 上下文注入 -> 模型 stream
-> 工具路由 -> 审批/沙箱/执行 -> 工具结果入历史
-> 继续采样 -> 完成事件 -> rollout 持久化 -> 客户端展示
```

这个结构让同一个 agent loop 可以被 CLI、TUI、IDE、desktop、app-server 和自动化任务复用，同时保留生产系统需要的权限控制、可观测性、恢复能力和扩展点。
