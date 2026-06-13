# codex-app-server 架构与处理逻辑

本文面向想读懂 `codex-rs/app-server` 代码的人。它不是 API 协议手册；协议细节见 `README.md`。这里关注代码如何组织、请求如何流转、thread/turn 如何接入 `codex-core`，以及事件如何回到 VS Code 等富客户端。

## 一句话定位

`codex app-server` 是 Codex 的富客户端后端。VS Code 插件、其他 IDE 客户端或测试客户端通过 JSON-RPC 连接它；它负责把客户端请求转换成 `codex-core` 的 thread/turn/tool 操作，再把 core 事件转换成 app-server protocol notifications。

```text
VS Code / IDE / test client
  |
  | JSON-RPC over stdio / websocket / unix socket
  v
codex-app-server
  |
  +--> codex-core ThreadManager / CodexThread
  +--> command/process/fs/MCP/plugin/config/auth processors
  |
  v
model, shell, filesystem, MCP, plugins, rollout/state DB
```

## 目录地图

核心入口：

- `src/main.rs`：CLI 参数解析，默认 `--session-source vscode`，然后调用 `run_main_with_transport_options`。
- `src/lib.rs`：app-server runtime 组装和主事件循环。负责配置加载、transport 启动、processor/outbound tasks、shutdown。
- `src/message_processor.rs`：JSON-RPC 请求入口、初始化门禁、experimental API gate、请求分发。
- `src/request_processors.rs`：request processors 的聚合模块和共享 helper。
- `src/request_processors/*_processor.rs`：每类 API 的实际处理逻辑。
- `src/thread_state.rs`：app-server 对每个 thread 的本地状态、订阅关系、listener command channel。
- `src/request_processors/thread_lifecycle.rs`：thread listener 的启动、事件循环、无订阅卸载。
- `src/bespoke_event_handling.rs`：把 `codex-core` 的 `EventMsg` 翻译成 app-server notifications/requests。
- `src/outgoing_message.rs`：发送 response/notification/request，跟踪 server-initiated request callback。
- `src/transport.rs`：对 `codex-app-server-transport` 的薄封装，处理连接状态和出站过滤。

辅助模块：

- `config_manager.rs` / `config_manager_service.rs`：配置加载、写入和热更新服务。
- `command_exec.rs`：`command/exec` 的进程管理。
- `fs_watch.rs`：`fs/watch` 相关状态。
- `skills_watcher.rs`：skills 文件变化监听和通知。
- `extensions.rs`：app-server 启动 `codex-core` thread extensions 时注入的依赖。
- `in_process.rs`：给本进程内嵌入方使用的 app-server runtime/client。

## 启动流程

入口在 `src/main.rs`：

```text
main
  -> parse AppServerArgs
  -> resolve LoaderOverrides / auth / runtime_options
  -> run_main_with_transport_options(...)
```

`AppServerArgs` 的关键参数：

- `--listen`：`stdio://`、`unix://`、`ws://IP:PORT`、`off`。
- `--session-source`：默认 `vscode`，用于产品限制和 metadata。
- websocket auth 参数。
- `--strict-config`。
- hidden/debug 参数，例如 remote control 和测试开关。

真正启动在 `src/lib.rs::run_main_with_transport_options`，大致做这些事：

1. 创建三条 channel：
   - `transport_event_tx/rx`：transport 产生的连接与入站消息事件。
   - `outgoing_tx/rx`：业务层要发给客户端的出站消息。
   - `outbound_control_tx/rx`：连接打开/关闭等出站路由控制事件。
2. 解析 CLI config overrides，找到 `CODEX_HOME`。
3. 初始化 `EnvironmentManager`、`ConfigManager`，预加载 config。
4. 初始化 auth manager、cloud config loader、state DB、log DB、OTel/tracing。
5. 根据 `--listen` 启动 stdio/unix socket/websocket transport acceptor。
6. 可选启动 remote control。
7. 启动两个主 task：
   - outbound router task：把 `OutgoingEnvelope` 路由到对应连接 writer。
   - processor task：消费 `TransportEvent`，调用 `MessageProcessor` 处理请求。

启动后有两个循环相互配合：

```text
transport acceptor
  -> TransportEvent::ConnectionOpened / IncomingMessage / ConnectionClosed
  -> processor loop
  -> MessageProcessor
  -> OutgoingMessageSender
  -> outgoing_rx
  -> outbound router
  -> per-connection writer
```

## 连接与初始化

每个连接都有一个 `ConnectionState`，里面包含：

- `ConnectionSessionState`：连接级 session 状态。
- `outbound_initialized`：该连接是否可以接收 broadcast notifications。
- `outbound_experimental_api_enabled`：该连接是否 opt in experimental API。
- `outbound_opted_out_notification_methods`：该连接选择关闭的 notifications。

连接必须先发 `initialize`。处理入口：

```text
MessageProcessor::process_request
  -> deserialize JSONRPCRequest into ClientRequest
  -> handle_client_request
  -> if ClientRequest::Initialize:
       InitializeRequestProcessor::initialize
       session.initialize(...)
```

初始化完成后，`lib.rs` 的 processor loop 会做额外 bookkeeping：

- 发送初始化相关 notifications 到该连接。
- 发送当前 remote-control 状态。
- 调用 `connection_initialized`，让 thread processor 可以 replay/attach 必要状态。
- 将 `outbound_initialized` 置为 true，使该连接开始接收 broadcast。

非 `initialize` 请求都会经过：

```text
dispatch_initialized_client_request
  -> check session.initialized()
  -> check experimental_reason() vs experimental_api_enabled()
  -> maybe enqueue by serialization_scope()
  -> handle_initialized_client_request
```

这意味着 app-server 的请求处理有两个重要门禁：

- 未初始化连接直接返回 `Not initialized`。
- experimental method/field 在未 opt in 时返回 `... requires experimentalApi capability`。

## 请求分发

`MessageProcessor` 持有一组 request processor：

```text
AccountRequestProcessor
AppsRequestProcessor
CatalogRequestProcessor
CommandExecRequestProcessor
ConfigRequestProcessor
EnvironmentRequestProcessor
ExternalAgentConfigRequestProcessor
FeedbackRequestProcessor
FsRequestProcessor
GitRequestProcessor
InitializeRequestProcessor
MarketplaceRequestProcessor
McpRequestProcessor
PluginRequestProcessor
ProcessExecRequestProcessor
RemoteControlRequestProcessor
SearchRequestProcessor
ThreadGoalRequestProcessor
ThreadRequestProcessor
TurnRequestProcessor
WindowsSandboxRequestProcessor
```

这些 processor 在 `MessageProcessor::new` 中统一构造。这里也是 app-server 和 core/runtime 依赖汇合的地方：

- 创建 `ThreadStateManager`。
- 根据 config 创建 process-scoped `thread_store`。
- 创建 `ThreadManager`。
- 给 `ThreadManager` 注入 app-server extensions、event sink、auth manager、state DB、analytics、goal service、skill provider 等。
- 构造所有 request processors，并把共享依赖传进去。

请求分发主体是 `handle_initialized_client_request` 中的大 `match ClientRequest`。例如：

```text
ClientRequest::ThreadStart
  -> ThreadRequestProcessor::thread_start

ClientRequest::TurnStart
  -> TurnRequestProcessor::turn_start

ClientRequest::McpServerToolCall
  -> McpRequestProcessor::mcp_server_tool_call

ClientRequest::CommandExec
  -> CommandExecRequestProcessor::command_exec
```

返回值是 `Option<ClientResponsePayload>`：

- `Some(payload)`：通用路径会发送 JSON-RPC response。
- `None`：processor 已经自己发送 response，或该请求只通过后续 notifications 完成。

## Thread 处理逻辑

Thread 相关逻辑主要在：

- `request_processors/thread_processor.rs`
- `request_processors/thread_lifecycle.rs`
- `thread_state.rs`

`thread/start` 的高层流程：

```text
ThreadRequestProcessor::thread_start
  -> resolve params/config/cwd/permissions
  -> ThreadManager::start_thread(...)
  -> persist/update thread metadata
  -> send ThreadStartResponse
  -> emit thread/started
  -> ensure_conversation_listener(...)
```

`thread/resume` 的高层流程分两类：

```text
如果 thread 已在内存中运行:
  -> ensure listener task running
  -> 通过 ThreadListenerCommand::SendThreadResumeResponse
     在 listener 顺序里发送 resume response 并订阅后续事件

如果 thread 未加载:
  -> 从 thread_store/rollout 读取历史
  -> ThreadManager resume
  -> build Thread summary / turns / initialTurnsPage
  -> send response
  -> ensure_conversation_listener(...)
```

`thread/fork` 类似 resume，但会复制历史并产生新的 thread id。若源 thread 正在运行，会按“先中断当前 turn”的语义做 fork snapshot。

Thread 订阅关系由 `ThreadStateManager` 维护。每个 thread 有一个 `ThreadEntry`：

- `ThreadState`：当前 turn summary、listener、pending interrupts、pending rollbacks 等。
- `connection_ids`：订阅该 thread 的连接。
- `has_connections_watcher`：用于无订阅延迟卸载。

## Thread listener

Thread listener 是 app-server 的核心机制。它把 `codex-core` 的 thread event stream 变成客户端 notifications。

启动入口：

```text
ensure_conversation_listener
  -> ThreadManager::get_thread(thread_id)
  -> ThreadStateManager::try_ensure_connection_subscribed(...)
  -> ensure_listener_task_running(...)
```

listener task 的主循环在 `thread_lifecycle.rs`：

```text
loop:
  select:
    cancel_rx
      -> listener 被替换或 thread teardown，退出

    listener_command_rx
      -> 处理 resume response、goal update、serverRequest/resolved 等有序命令

    conversation.next_event()
      -> 更新 ThreadState.current_turn_history
      -> 找到订阅该 thread 的 connection ids
      -> 构造 ThreadScopedOutgoingMessageSender
      -> apply_bespoke_event_handling(...)

    unloading_state.wait_for_unloading_trigger()
      -> 无订阅且 idle 超过 30 分钟后 shutdown/unload thread
```

为什么 listener command 存在：有些操作必须和 core events 保持同一顺序。例如正在运行的 thread 被 resume 时，resume response 需要包含当前 active turn snapshot，并且订阅必须和后续 live events 原子排序。于是这类操作通过 `ThreadListenerCommand` 进入 listener loop。

## Turn 处理逻辑

Turn 相关逻辑主要在 `request_processors/turn_processor.rs`。

`turn/start` 高层流程：

```text
TurnRequestProcessor::turn_start
  -> 校验 thread 是否存在/可用
  -> 解析 input、cwd、model、permissions、environments 等覆盖项
  -> 确保 thread listener 已 attach
  -> 向 CodexThread submit Op::UserTurn / equivalent op
  -> 返回 TurnStartResponse
  -> 后续进展由 listener 通过 turn/* 和 item/* notifications 流式发送
```

`turn/steer`：

```text
turn_steer
  -> 要求 expectedTurnId
  -> 检查 active turn 是否可 steer
  -> 向正在运行的 CodexThread 追加输入
  -> 返回 accepted turnId
```

`turn/interrupt`：

```text
turn_interrupt
  -> 记录 pending interrupt response
  -> 向 core 提交 interrupt/cancel
  -> 等 listener 看到 TurnComplete/TurnAborted 后响应
```

`review/start`：

- inline 模式：在原 thread 上启动 review turn。
- detached 模式：fork 新 thread，再在新 thread 上启动 review turn。

Realtime 相关方法也在 `TurnRequestProcessor`，但它们走 thread-scoped realtime API，并通过 `thread/realtime/*` notifications 回传。

## 事件转换

`codex-core` 发出的事件类型是 `codex_protocol::protocol::EventMsg`。app-server 对客户端暴露的是 `codex_app_server_protocol::ServerNotification` 和 `ServerRequest`。

转换入口：

```text
conversation.next_event()
  -> ThreadState::track_current_turn_event(...)
  -> apply_bespoke_event_handling(...)
```

`bespoke_event_handling.rs` 处理的典型事件：

- `TurnStarted` -> `turn/started`
- `TurnComplete` -> `turn/completed`
- `Warning` -> `warning`
- `McpStartupUpdate` -> `mcpServer/startupStatus/updated`
- model reroute/verification -> `model/rerouted` / `model/verification`
- token count -> `thread/tokenUsage/updated`
- realtime events -> `thread/realtime/*`
- approval requests -> server-initiated JSON-RPC request
- item events -> `item/started`、`item/completed`、item-specific deltas

部分简单 item events 可以通过 protocol helper 转换；复杂或带 app-server 状态副作用的事件在 `bespoke_event_handling.rs` 中手写处理。

ThreadState 在事件转换前会维护一个 `ThreadHistoryBuilder`：

- 用于生成 active turn snapshot。
- 用于 resume running thread 时把当前 turn 合并进响应。
- turn 终止后 reset。

## 出站消息

出站逻辑由两层组成：

```text
业务层:
  OutgoingMessageSender
    -> send_response
    -> send_server_notification
    -> send_request / send_request_to_connections
    -> cancel_requests_for_thread

路由层:
  OutgoingEnvelope
    -> outbound router task
    -> route_outgoing_envelope
    -> per-connection writer
```

`OutgoingMessageSender` 还负责 server-initiated request callback：

```text
send_request(...)
  -> 分配 server request id
  -> 保存 request_id -> oneshot callback
  -> 发 JSON-RPC request 给客户端

客户端返回 JSON-RPC response/error
  -> MessageProcessor::process_response/process_error
  -> OutgoingMessageSender::notify_client_response/error
  -> 唤醒等待 approval/input/auth refresh 的业务逻辑
```

这就是审批、MCP elicitation、`request_user_input`、attestation、external auth refresh 等机制的基础。

出站路由会按连接过滤：

- 未初始化连接不会收到 broadcast notifications。
- 未 opt in experimental API 的连接不会收到 experimental notifications。
- opt-out notification methods 会被跳过。
- 部分 server requests 会在未启用 experimental API 时剥离 experimental fields。
- 慢 websocket 连接的 outbound queue 满了会被断开，避免拖垮 server。

## 审批与客户端请求

审批不是普通 response，而是 app-server 主动向客户端发 JSON-RPC request。

典型命令审批流程：

```text
core event: command approval needed
  -> apply_bespoke_event_handling
  -> outgoing.send_request_to_connections(...)
  -> client shows UI
  -> client sends JSON-RPC response
  -> OutgoingMessageSender wakes callback
  -> app-server maps decision back to core
  -> listener later emits item/completed
```

这些 request 通常带 `threadId` / `turnId`，并绑定到 thread。turn 结束、interrupt 或 thread unload 时，`cancel_requests_for_thread` 会清理 pending callbacks，并可发送 `serverRequest/resolved`。

## 请求串行化

不是所有 JSON-RPC 请求都直接 `tokio::spawn` 并发跑。`ClientRequest` 可以声明 `serialization_scope()`。

`MessageProcessor::dispatch_initialized_client_request` 会：

```text
if request.serialization_scope().is_some():
  -> RequestSerializationQueues::enqueue(...)
else:
  -> tokio::spawn(request.run())
```

这样可以让某些会互相影响的请求按 scope 串行执行，避免同一连接或同一资源上的竞态。

## 配置与 state

app-server 启动时会加载 base config，但很多请求还会按 cwd/thread 重新解析有效配置。

关键组件：

- `ConfigManager`：集中加载/写入 config，支持 cloud/thread config loader。
- `ThreadConfigLoader`：可为 thread 加载远程配置。
- `StateDbHandle`：sqlite-backed state，用于 thread metadata、goals、memory、logs 等。
- `LocalThreadStore` / `ThreadStore`：thread rollout 的存储抽象。
- `LogDbLayer`：把 tracing/log 写入 DB。

注意一个设计点：`MessageProcessor::new` 中创建的 `thread_store` 是 process-scoped。注释说明 config reload 可以影响每个 thread 的行为，但不能把新 start/resume/fork 的 thread 移到另一个 persistence backend/root。

## Transport 模式

app-server 支持多种 transport，但进入业务层后都变成统一的 `TransportEvent`：

- `stdio`：默认，适合 VS Code 插件启动子进程后通过 stdin/stdout 通信。
- `unix socket`：本地控制面连接。
- `websocket`：实验性/测试用途更多。
- `remote control`：通过 backend relay 进入的远程控制连接。
- `in_process`：不是 wire transport，而是给同进程 embedder 使用的 typed path。

无论来源如何，最终都是：

```text
TransportEvent::IncomingMessage
  -> JSONRPCMessage::Request/Response/Error/Notification
  -> MessageProcessor
```

## App-server 与 core 的边界

app-server 不直接实现 agent 推理。它依赖 `codex-core`：

- `ThreadManager`：创建、恢复、fork、查找、卸载 threads。
- `CodexThread`：一个正在运行或可运行的 conversation。
- `Op`：提交给 core 的操作，例如用户 turn、interrupt、shell command、review 等。
- `EventMsg`：core 产生的事件流。

app-server 主要做边界适配：

- app-server protocol params -> core config/input/op。
- core EventMsg -> app-server protocol notifications/requests。
- client approval/input response -> core approval/input response。
- thread rollout/history -> app-server `Thread` / `Turn` / `ThreadItem`。

## 扩展系统接入点

`MessageProcessor::new` 创建 `ThreadManager` 时注入 app-server extensions：

```text
thread_extensions(
  guardian_agent_spawner(...),
  ThreadExtensionDependencies {
    event_sink,
    auth_manager,
    state_db,
    analytics_events_client,
    thread_manager,
    goal_service,
    executor_skill_provider,
    thread_store,
  }
)
```

这让 core extension 可以：

- 通过 app-server event sink 发事件。
- 使用 app-server 的 auth/state/analytics。
- spawn guardian/auto-review agent。
- 访问 goal service、executor skills 和 thread store。

插件、skills、apps、MCP 的用户可见 API 大多在各自 request processor 中；真正参与模型上下文或工具调用时，会通过 core managers/extensions 接入。

## 读代码建议

如果你想理解一次普通对话：

1. `main.rs`：看启动参数。
2. `lib.rs::run_main_with_transport_options`：看 runtime 如何组装。
3. `message_processor.rs::process_request`：看 JSON-RPC 如何进入 typed request。
4. `message_processor.rs::handle_initialized_client_request`：看请求如何分发。
5. `request_processors/thread_processor.rs::thread_start`：看 thread 如何创建。
6. `request_processors/turn_processor.rs::turn_start`：看用户输入如何提交。
7. `request_processors/thread_lifecycle.rs::ensure_listener_task_running`：看事件监听循环。
8. `bespoke_event_handling.rs::apply_bespoke_event_handling`：看 core event 如何转成客户端消息。
9. `outgoing_message.rs`：看 response、notification、server request 如何发回客户端。

如果你想新增一个 app-server API：

1. 在 `app-server-protocol` v2 类型里加 request/response/notification。
2. 在 `message_processor.rs::handle_initialized_client_request` 分发新 `ClientRequest`。
3. 优先新增或扩展对应 `request_processors/*_processor.rs`。
4. 如果是 API 行为变化，更新 `app-server/README.md`。
5. 如果改协议 shape，运行 `just write-app-server-schema`。
6. 验证 `just test -p codex-app-server-protocol`，并按影响范围补 app-server integration tests。

## 常见心智模型

把 app-server 想成三个平面：

```text
控制平面
  initialize、config、auth、model/list、skills/list、plugin/list

会话平面
  thread/start、thread/resume、turn/start、turn/steer、turn/interrupt

事件平面
  thread listener、item/*、turn/*、server-initiated approvals
```

控制平面回答“客户端现在能做什么、配置是什么”。会话平面负责“启动或推进一个 Codex 会话”。事件平面负责“把正在发生的事情持续投影给客户端”。

理解这三个平面后，`app-server` 的大部分代码都能归位。
