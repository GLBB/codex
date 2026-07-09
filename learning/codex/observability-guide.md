# Codex 可观测性导读

这篇文档帮助你在读 Codex 源码或排查问题时选择合适的观测面。Codex 的可观测性不是一个单独系统，而是一组互补证据：日志解释“代码怎么走”，协议事件解释“用户和客户端看到了什么”，OTEL 指标和 trace 解释“系统整体表现如何”，rollout trace 解释“历史会话如何回放和重建”，analytics 解释“产品行为发生了什么”。

阅读时先记住一个原则：不要只问“有没有日志”。更好的问题是：你想观察的是代码路径、业务事件、性能趋势、分布式链路、用户反馈、历史回放，还是产品行为。

## 总览

| 观测面 | 能看到什么 | 适用场景 | 源码入口 |
| --- | --- | --- | --- |
| tracing 日志 | Rust 模块运行日志、warning/error、span、文件行号 | 本地调试、异常定位、理解分支路径 | `codex-rs/tui/src/lib.rs`、`codex-rs/app-server/src/lib.rs`、`codex-rs/cli/src/exec_server_telemetry.rs` |
| SQLite 日志库 | tracing event 的持久化版本，按 thread/process/time 关联 | 会话问题复盘、反馈后查询、应用内日志检索 | `codex-rs/state/src/log_db.rs`、`codex-rs/state/src/runtime/logs.rs` |
| feedback 日志 | 完整诊断 ring buffer、反馈 tags、auth/request 元数据 | 用户 `/feedback` 上报、维护者远程诊断 | `codex-rs/feedback/src/lib.rs` |
| OTEL logs | 经过过滤的结构化日志和审计事件 | 托管环境集中查询、安全审计 | `codex-rs/otel/src/provider.rs`、`codex-rs/network-proxy/README.md` |
| OTEL traces | app-server 请求、session/turn/tool 相关 span、父子 trace context | 跨组件链路追踪、延迟定位、分布式排障 | `codex-rs/otel/src/trace_context.rs`、`codex-rs/app-server/src/app_server_tracing.rs` |
| OTEL metrics | API/tool/SSE/WebSocket/startup/TTFT 等计数和耗时 | 性能趋势、报警、版本回归分析 | `codex-rs/otel/src/metrics`、`codex-rs/otel/src/events/session_telemetry.rs` |
| 协议事件流 | turn、message、tool、approval、token、warning/error 等业务事件 | UI 渲染、客户端订阅、集成测试、实时观察 | `codex-rs/protocol/src/protocol.rs`、`codex-rs/core/src/session/mod.rs` |
| raw response item | 模型 Responses API 原始输出项 | 调试模型流式响应映射、兼容 raw event consumer | `codex-rs/core/src/stream_events_utils.rs` |
| rollout/thread trace | turn 和工具运行边界的可回放 trace | 历史会话复盘、resume/fork/compact 调试 | `codex-rs/rollout-trace/src/protocol_event.rs` |
| analytics | 产品行为事实，如 skill/plugin/hook/compaction/guardian | 产品分析、功能采用率、行为漏斗 | `codex-rs/analytics/src/client.rs`、`codex-rs/analytics/src/facts.rs` |
| TUI session JSONL | TUI 收到的 AppEvent 和发出的 AppCommand 简化记录 | TUI 状态机和渲染顺序问题 | `codex-rs/tui/src/session_log.rs` |

## tracing 日志

tracing 是最接近传统后端日志的一层。你可以看到模块 target、日志级别、message、span 创建和关闭、warning/error，以及一些通过 `#[tracing::instrument]` 标注的异步函数边界。

TUI 的初始化在 `codex-rs/tui/src/lib.rs`。读这段时关注 `config.log_dir`、`TUI_LOG_FILE_NAME`、`EnvFilter` 和 `tracing_subscriber::registry()` 如何组合。配置了 `log_dir` 后，TUI 会把文件日志写到对应目录，默认关注 `codex_core`、`codex_tui` 和 `codex_rmcp_client`。

app-server 的初始化在 `codex-rs/app-server/src/lib.rs`。它面向服务进程，默认写 stderr，支持普通格式和 JSON 格式。沿着 `LogFormat`、`EnvFilter::from_default_env()` 和 subscriber layer 组合读，就能看到 `RUST_LOG` 和 `LOG_FORMAT=json` 怎么生效。

exec-server 的初始化在 `codex-rs/cli/src/exec_server_telemetry.rs`。这层默认日志更保守，因为一次性命令或远程执行场景不能让日志污染用户期望的命令输出。读 `DEFAULT_LOG_FILTER` 可以理解为什么它默认只保留 error 和少量必要信息。

适合用 tracing 的问题包括：某个配置为什么没生效、MCP 连接为什么失败、工具 handler 是否进入了预期分支、异步任务是否被取消、某个 warning 是从哪里来的。

## SQLite 日志库

SQLite 日志库把 tracing event 写入本地 state DB。它不是另一套日志 API，而是一个 `tracing_subscriber::Layer`。读 `codex-rs/state/src/log_db.rs` 时，可以从文件顶部注释开始，然后看 `LogDbLayer::start`、`Layer::on_new_span`、`Layer::on_record`、`Layer::on_event`。这条路径展示了 span 字段如何被提取成 thread 上下文，event 如何格式化成 `LogEntry`，再通过有界队列交给后台任务批量写入。

真正的保留策略在 `codex-rs/state/src/runtime/logs.rs`。这里按 thread 和 threadless process 分区裁剪，避免日志无限增长。读 `insert_logs` 和 `prune_logs_after_insert` 可以看到它既保留最近可读日志，又控制每个分区的大小和行数。

适合用 SQLite 日志库的问题包括：某个 thread 附近发生了哪些 warning、一个进程没有关联 thread 时留下了什么日志、反馈后要按时间或会话聚合诊断材料。

## Feedback 诊断日志

feedback 日志面向用户上报问题。`codex-rs/feedback/src/lib.rs` 中的 `CodexFeedback::logger_layer` 会创建一层独立的 tracing layer，把完整日志写入内存 ring buffer。它不跟随用户的 `RUST_LOG`，因为反馈材料需要尽可能完整。

同一个文件里的 `metadata_layer` 负责收集结构化 feedback tags。`emit_feedback_request_tags` 和 `emit_feedback_request_tags_with_auth_env` 会把 endpoint、auth mode、request id、Cloudflare ray、auth 错误等字段写入特殊 target，随后在上传反馈时作为结构化元数据附带。

适合用 feedback 的问题包括：用户只给了一个失败截图、需要知道认证请求是否带 header、某次请求是否出现 401 后重试、反馈附件里是否包含 Windows sandbox log 或 doctor report。

## OpenTelemetry

OTEL 是 Codex 面向集中式观测平台的出口。配置类型在 `codex-rs/config/src/types.rs` 的 `OtelConfigToml` 和 `OtelConfig`。先看这些字段：`exporter`、`trace_exporter`、`metrics_exporter`、`environment`、`span_attributes`、`tracestate`、`log_user_prompt`。它们描述了日志、trace、metrics 分别是否导出，以及导出时带哪些环境和 span 属性。

`codex-rs/core/src/otel_init.rs` 把应用配置转换成 `codex_otel::OtelSettings`。读 `build_provider` 时注意两个细节：一是 analytics 关闭时 metrics exporter 会被关掉；二是 service name 默认来自 originator，也可以由调用方覆盖，例如 exec-server 用 `codex-exec-server`。

真正安装 provider 的逻辑在 `codex-rs/otel/src/provider.rs`。`OtelProvider::from` 会分别构造 logger provider、tracer provider 和 metrics client，再通过 `logger_layer`、`tracing_layer` 暴露给各入口安装到 subscriber。这里还有两个重要过滤器：logs 只导出允许的 target，traces 只导出 span 或 trace-safe target。

适合用 OTEL 的问题包括：生产环境请求耗时在哪个阶段变长、app-server 请求和 core turn 如何关联、某个版本的 TTFT 是否回归、网络策略拦截量是否异常。

## SessionTelemetry 和 metrics

`codex-rs/otel/src/events/session_telemetry.rs` 是 core 层最常见的 telemetry 门面。`SessionTelemetryMetadata` 保存 conversation id、auth mode、account、originator、session source、model、service tier、terminal type、app version 等上下文。`SessionTelemetry` 再提供 `counter`、`histogram`、`record_duration` 这些基础方法，以及更具体的业务记录方法。

这层能看到的内容不是单条日志，而是可聚合的指标和结构化事件。典型指标包括 API call count/duration、SSE event count/duration、WebSocket request/event count/duration、tool call count/duration、turn TTFT、startup phase duration、Responses API timing breakdown、plugin install suggestion 和 elicitation。

读源码时可以从 `record_startup_phase`、`record_turn_ttft`、`record_plugin_install_suggestion` 这类方法入手。它们展示了一个模式：同一件事通常会同时记录 metrics，并发出 log/trace-safe 的结构化事件。

适合用 metrics 的问题包括：不是某一次请求为什么失败，而是一类请求最近是否变慢；不是某个 tool 调了什么参数，而是 tool 调用数量和耗时是否异常。

## 协议事件流

协议事件流是 Codex 最原生的业务观测面。`codex-rs/protocol/src/protocol.rs` 里的 `EventMsg` 定义了客户端和 UI 能看到的事件：session configured、turn started、turn complete、turn aborted、agent message、reasoning、exec begin/end、apply patch begin/end、MCP tool call begin/end、approval request、token count、raw response item、warning 和 error。

发送入口在 `codex-rs/core/src/session/mod.rs` 的 `Session::send_event`。读这个方法时，不要只看 channel send；也要看它如何把事件写入 rollout/thread trace，如何处理 terminal turn，如何镜像部分文本到 realtime conversation，以及 channel 关闭时如何记录 debug 日志。

工具事件的封装在 `codex-rs/core/src/tools/events.rs`。沿着 `ToolEmitter`、`emit_exec_command_begin` 和 `emit_turn_item_started` 看，可以理解为什么 shell、apply_patch、unified_exec 既要生成用户可见事件，也要生成可持久化的 `TurnItem`。

适合用协议事件流的问题包括：UI 为什么显示了某个状态、app-server 客户端实际收到了哪些 notification、一个 approval 请求是否被发出、token count 是否在 turn 末尾更新、集成测试应该等待哪个事件。

## Raw Response Item

raw response item 更靠近模型 Responses API 的输出。`codex-rs/core/src/stream_events_utils.rs` 负责把模型流事件转换成 Codex 内部 item、legacy event 和 turn item。读这里时关注 response output item 是如何被 finalized，再交给 `emit_turn_item_started` 和 `emit_turn_item_completed`。

raw response item 适合调试模型流到协议事件之间的映射。例如模型确实返回了一个 output item，但 UI 没显示预期消息，就应该检查它在 stream mapping 中是否被转换、过滤或延迟完成。

这层也要注意边界：raw item 可能包含较大或较敏感的模型内容，所以任何新增注入或导出都要考虑大小上限和隐私。

## Rollout 和 thread trace

rollout/thread trace 是历史复盘和回放的证据链。`codex-rs/rollout-trace/src/protocol_event.rs` 把协议事件映射到更小的 trace vocabulary。文件顶部注释已经说明设计意图：session 层已经有协议事件，rollout trace 复用这些观察，而不是在 core 里再增加一套 hook。

读这个文件时先看 `codex_turn_trace_event`，它只关心 turn started、turn complete、turn aborted。然后看 `ToolRuntimeTraceEvent` 和 `ToolRuntimePayload`，它们覆盖 exec、patch、MCP、collaboration 和 sub-agent activity 的 begin/end 或 runtime payload。

适合用 rollout trace 的问题包括：某个历史会话里到底执行了哪些工具、resume 后为什么能或不能重建历史、compact 前后 turn 边界如何保留、sub-agent 或 collaboration 工具的运行序列是什么。

## Analytics

analytics 是产品行为事实，不是低层日志，也不是 OTEL metrics 的替代。`codex-rs/analytics/src/client.rs` 中的 `AnalyticsEventsClient` 把 fact 放入有界队列，后台 reducer 聚合后发送到 analytics endpoint。读 `AnalyticsEventsQueue::new`、`try_send` 和各个 `track_*` 方法，可以看到事件如何进入队列。

事实类型在 `codex-rs/analytics/src/facts.rs`。这里能看到产品层关心的行为：app/server invocation、skill invocation、plugin state、hook run、compaction、turn profile、token usage、guardian review、sub-agent thread started。

适合用 analytics 的问题包括：某个插件是否被启用、skill 调用是否被记录、compaction 失败率如何、guardian review 结果分布怎样、app-server 客户端使用了哪些 API。它通常不适合回答“某一行代码为什么报错”，但适合回答“某类行为发生了多少、来自哪里、结果如何”。

## 网络代理审计事件

网络代理审计事件在 `codex-rs/network-proxy/README.md` 有专门说明。嵌入 managed runtime 时，策略决策会发出 target 为 `codex_otel.network_proxy` 的结构化事件，事件名是 `codex.network_proxy.policy_decision`。

这些事件能看到 policy scope、decision、source、reason、transport protocol、server address、server port、HTTP method、client address，以及是否由 decider override。它们刻意不记录完整 URL、path 或 query。

适合用网络代理审计的问题包括：某个请求为什么被 deny、allowlist 是否命中、local/private network 保护是否触发、limited mode 为什么拒绝某类方法、审批产生的 network decider 是否覆盖了 baseline block。

## TUI session JSONL

`codex-rs/tui/src/session_log.rs` 是 TUI 层的轻量录制功能。开启后，它会写 session start header，随后记录 TUI 收到的 `AppEvent` 和发出的 `AppCommand`。这不是完整业务日志，而是 UI 状态机的事件顺序记录。

读 `maybe_init` 可以看到 `CODEX_TUI_RECORD_SESSION` 和 `CODEX_TUI_SESSION_LOG_PATH` 如何控制输出位置。读 `log_inbound_app_event` 和 `log_outbound_op` 可以看到它有意只记录简化信息，例如 history cell 行数、file search 结果数量、AppEvent variant。

适合用 TUI session JSONL 的问题包括：core 已经发出事件但 TUI 没渲染、某个 popup 或 file search 状态顺序异常、用户操作触发的 AppCommand 是否按预期发出。

## 选择观测面的方式

如果你正在读一个问题，可以按下面的顺序选择：

| 你想回答的问题 | 优先看 |
| --- | --- |
| 某段 Rust 逻辑为什么走错分支 | tracing 日志 |
| 某个用户会话附近发生了什么 | SQLite 日志库、feedback 日志 |
| 客户端或 UI 收到了什么 | 协议事件流 |
| 模型原始输出如何变成 UI 事件 | raw response item、stream mapping |
| 某次请求跨 app-server/core/tool 卡在哪里 | OTEL traces |
| 一类请求或工具最近是否变慢 | OTEL metrics、SessionTelemetry |
| 历史会话如何回放或恢复 | rollout/thread trace |
| 功能采用率或行为分布如何 | analytics |
| 网络访问为什么被拦或放行 | 网络代理审计事件 |
| TUI 本地状态顺序是否异常 | TUI session JSONL |

## 一条 query 的观测路线

读一条普通 query 时，可以从 `codex-rs/core/src/session/turn.rs` 的 turn 主路径开始，理解模型 stream 如何进入 core。然后到 `codex-rs/core/src/stream_events_utils.rs` 看 response item 如何变成 turn item。接着回到 `codex-rs/core/src/session/mod.rs` 的 `Session::send_event`，观察事件如何发送给客户端、写入 rollout trace、触发 terminal turn 处理。

如果 query 调用了 shell 或 apply_patch，再进入 `codex-rs/core/src/tools/events.rs` 看 begin/end 事件如何创建。若问题出在 UI，继续读 `codex-rs/tui/src/app/thread_events.rs` 和相关 history cell 渲染代码。若问题出在 app-server 客户端，转到 `codex-rs/app-server` 的 outgoing message 和 event mapping。

最后根据问题类型补充观测面：性能问题读 `SessionTelemetry` 和 OTEL metrics；链路问题读 app-server tracing span 和 W3C trace context；历史恢复问题读 rollout trace；产品行为问题读 analytics reducer 和 fact 类型。

## 常见误区

不要把 analytics 当作 debug log。analytics 会归约产品事实，很多排障细节不会在那里。

不要把 OTEL metrics 当作单次会话回放。metrics 适合聚合趋势，协议事件和 rollout trace 才适合还原事件序列。

不要只看 `send_event` 的 channel。Codex 的事件发送同时影响 UI、持久化、rollout trace、terminal turn 通知和一些 realtime 镜像逻辑。

不要把 feedback 日志等同于用户可见日志。feedback layer 会尽量完整捕获诊断材料，只有在反馈流程中才成为附件。

不要在新增观测时随意导出用户 prompt、完整 URL、完整 tool payload 或无界上下文。Codex 现有实现通常会通过 target filter、metadata field、bounded queue、retention cap 或刻意省略敏感字段来控制风险。
