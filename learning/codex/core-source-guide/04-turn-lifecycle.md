# 4. 单轮请求主链路

本章以 app-server 收到一次普通文本请求为例。主链路按真实执行顺序展开；工具调用是循环中的条件分支，下一章之后再深入安全细节。

## 4.1 路径总览

```text
turn/start
  -> CodexThread::submit(Op::UserInput)
  -> submission_loop
  -> user_input_or_turn
  -> Session::spawn_task<RegularTask>
  -> RegularTask::run
  -> run_turn
       -> capture_step_context
       -> record context/user input
       -> ContextManager::for_prompt
       -> build_prompt
       -> run_sampling_request
       -> try_run_sampling_request
       -> handle_output_item_done
       -> [tool output -> history -> 再采样]
       -> TurnComplete
```

## 4.2 逐步跟读表

| 步骤 | 文件与入口 | 输入 → 输出 | 下一步 | 暂停点 |
| --- | --- | --- | --- | --- |
| 1. 外部请求 | [`turn_start_inner`](../../../codex-rs/app-server/src/request_processors/turn_processor.rs#L474) | JSON-RPC params → core `UserInput` 与 per-turn settings | `CodexThread::submit_user_input_with_client_user_message_id` | 看见 `Op::UserInput` 后停，不读事件映射 |
| 2. 进入 core | [`Submission`](../../../codex-rs/protocol/src/protocol.rs#L174)、[`CodexThread::submit`](../../../codex-rs/core/src/codex_thread.rs#L236) | `Op` + submission id → channel message | `submission_loop` | 不进入其他 `Op` 分支 |
| 3. 分派命令 | [`submission_loop`](../../../codex-rs/core/src/session/handlers.rs#L703) | `Submission` → 对应 handler | `user_input_or_turn` | 只跟 `Op::UserInput` |
| 4. 建立 Turn | [`user_input_or_turn_inner`](../../../codex-rs/core/src/session/handlers.rs#L189) | 用户输入 + settings → `TurnContext`/`TurnInput` | steer 活跃 Turn，或 `spawn_task` | 首读跳过 steer 细节 |
| 5. 启动任务 | [`Session::spawn_task`](../../../codex-rs/core/src/tasks/mod.rs#L276) | `RegularTask` + TurnContext + input | `start_task` 建立 ActiveTurn 并 spawn | 看到取消 token 和 ActiveTurn 即停 |
| 6. 生命周期外壳 | [`RegularTask::run`](../../../codex-rs/core/src/tasks/regular.rs#L38) | Turn 输入 → `TurnStarted` + 主循环结果 | `run_turn` | 跳过 startup prewarm 实现 |
| 7. 准备首 Step | [`run_turn`](../../../codex-rs/core/src/session/turn.rs#L151) | TurnContext + input + Session state → StepContext | 记录上下文和用户输入 | 看完第一次 `capture_step_context` |
| 8. 记录输入 | 同一 `run_turn` | user input、skill/plugin/extension 注入 → History + Rollout | sampling loop | 暂不跟各注入构造器 |
| 9. 取模型历史 | [`ContextManager::for_prompt`](../../../codex-rs/core/src/context_manager/history.rs#L141) | History snapshot + 模型模态 → 规范化 `Vec<ResponseItem>` | `run_sampling_request` | 看完 normalization 不读截断算法 |
| 10. 构造 Prompt | [`build_prompt`](../../../codex-rs/core/src/session/turn.rs#L1289) | history + router specs + base instructions + schema → `Prompt` | `run_sampling_request` | 不进入各 ToolSpec |
| 11. 发起采样 | [`run_sampling_request`](../../../codex-rs/core/src/session/turn.rs#L1317) | Prompt + metadata + ModelClientSession | retry loop | 跟一次成功路径即可 |
| 12. 消费流 | [`try_run_sampling_request`](../../../codex-rs/core/src/session/turn.rs#L2146) | Responses stream → 增量事件、完成 item、token info | `handle_output_item_done` | 先跳过所有 stream event 变体 |
| 13A. 普通输出 | [`handle_output_item_done`](../../../codex-rs/core/src/stream_events_utils.rs#L288) | assistant item → History、Rollout、UI item event | 等待 `Completed` | 看见 record 即停 |
| 13B. 工具输出 | 同一函数 | tool-call item → `ToolCallRuntime` future | drain tool results | 暂不进入 handler |
| 14. 工具回填 | [`drain_in_flight`](../../../codex-rs/core/src/session/turn.rs#L2097) | tool future result → call output `ResponseItem` | record 到 History，再次采样 | 看见 `record_conversation_items` |
| 15. 完成 Turn | `run_turn` 返回，`RegularTask` 收尾 | 最终文本/token/status → `TurnComplete` 等 Event | event channel → `CodexThread` | 到此主链闭环 |

## 4.3 接收输入与创建 TurnContext

app-server 把 v2 输入映射成协议层 `UserInput`，把 model、cwd、approval policy、sandbox policy、effort、output schema 等包装为 turn settings，然后提交 `Op::UserInput`。core 并不依赖 JSON-RPC；它只认识协议 `Op`。

`user_input_or_turn_inner` 先应用 per-turn settings，并用 `new_turn_with_sub_id` 创建 `TurnContext`。若已有 ActiveTurn，输入可能被 steer；没有活跃任务时才构造 `TurnInput` 并启动 `RegularTask`。因此“每次 submit 都新建并发 task”是错误理解。

## 4.4 创建 StepContext

`run_turn` 在真正写入本轮输入前先处理必要的预采样 compaction，并检测用户是否显式需要某些 MCP servers/plugins。随后调用 [`capture_step_context_with_required_mcp_servers`](../../../codex-rs/core/src/session/mod.rs#L3076)：

1. 刷新环境 readiness 和 AGENTS.md；
2. 解析 capability roots；
3. 并行准备 MCP binding 和工具推荐；
4. 调用 [`built_tools`](../../../codex-rs/core/src/session/turn.rs#L1474)；
5. 生成绑定该 router 的 `StepContext`。

输入是 TurnContext 和本次要求的 capability；输出是一次采样的完整运行快照。下一步 `record_step_world_state_if_changed` 保证模型可见 WorldState 与这个 Step 使用同一份状态。

## 4.5 注入上下文并写入用户输入

首轮或上下文基线丢失时，Session 写入完整初始上下文；后续 Turn/Step 只写配置与 WorldState 差量。接着 Turn 选择显式 Skills/Plugins，运行 session-start/user-prompt hooks 和 extension contributors，把形成的 `ResponseItem` 与用户输入一起交给 [`record_conversation_items`](../../../codex-rs/core/src/session/mod.rs#L2994)。

这个函数同时做三件事：追加内存 History、持久化 `RolloutItem::ResponseItem`、向客户端发送 raw response item 事件。它是“模型上下文”和“可恢复记录”保持一致的重要写边界。

## 4.6 构建 Prompt 并采样

进入 `run_turn` 的 sampling loop 后：

1. 合并 Turn 运行期间新到的 pending input；
2. 若状态变化则重新捕获 StepContext；
3. 记录新的 WorldState diff；
4. `clone_history().for_prompt(...)` 得到规范化输入；
5. `build_prompt` 加上本 Step 的 tools、base instructions 和 output schema；
6. `run_sampling_request` 复用一个 `ModelClientSession` 并处理重试；
7. `try_run_sampling_request` 读取流。

这里 `ModelClientSession` 的复用有意保留 turn 范围内的 sticky routing、WebSocket 增量请求等状态；不要把每次重试理解为全新逻辑 Session。

## 4.7 消费流与工具循环

`try_run_sampling_request` 处理增量文本、reasoning、完成 item、token usage、错误和 `Completed`。完成的 response item 会立刻写入 history/rollout，而不是等整个流结束，这样即使随后取消，内存 History 与持久化记录仍保持同步。

`handle_output_item_done` 分两条：

- 普通 assistant/reasoning item：完成 UI item 事件、记录 item，可能更新最后一条 assistant message；
- tool call：先记录模型产生的 call，再用本 Step 的 `ToolRouter` 构造调用，交给 `ToolCallRuntime`。

工具 future 的结果由 `drain_in_flight` 转成 `FunctionCallOutput` 或 `CustomToolCallOutput`，再写回 History。`needs_follow_up = true` 使 `run_turn` 回到 sampling loop，下一次 Prompt 同时包含原 tool call 和对应 output。直到模型不再要求工具、也没有 pending input，Turn 才结束。

## 4.8 Event 如何返回

Session 的 [`send_event_raw`](../../../codex-rs/core/src/session/mod.rs#L2061) 默认先把 `EventMsg` 持久化为 Rollout，再把 `Event` 发送到 event channel。`CodexThread::next_event` 读取该 channel；app-server 再把 core event 映射成 JSON-RPC notification。

因此 UI 事件不是模型流的原样透传。core 会把模型增量、Turn item、工具 begin/end、审批请求、token 信息和生命周期状态统一成协议事件。

## 4.9 本章阅读停点

第一次跟读在 `run_turn` 中走完一次“无工具成功请求”，第二次只跟一个 tool call 到 `drain_in_flight`。不要同时进入 shell、MCP、compaction 和 hook 实现。能回答下面四问即可继续：

1. `TurnContext` 在哪里创建？
2. `StepContext` 为什么可能重建？
3. tool output 在哪里变成下一次模型输入？
4. Event 在送给 UI 前在哪里持久化？
