# Model Provider API 与 Tool 协议

## 先澄清“Prompt 中包含工具合约”

这句话在模型视角上成立，在 API 编码层面不够准确。

- **模型视角**：Instructions、对话输入和 Tool Contract 都是本轮决策的可见上下文。
- **标准 Responses API 视角**：自然语言指令放在 `instructions` / `input`，工具合约放在顶层 `tools`；二者不是同一个字段。
- **Codex 内部视角**：`Prompt` 是一次模型请求的聚合对象，其中同时持有 `input`、`tools`、`parallel_tool_calls` 和 `base_instructions`。这里的 `Prompt` 比“自然语言提示词”含义更宽。

因此，更准确的说法是：**Tool Contract 是 Model Input Contract 的一部分，通常不是 Natural-language Prompt Text 的一部分。**

Codex 还有一条例外路径：启用 Responses Lite 时，`build_responses_request` 会把序列化后的工具列表放进 `input` 的 `AdditionalTools` developer item，并省略顶层 `tools`。这是兼容编码，不应反推所有 Provider 都把 Schema 拼进 Prompt 文本。

## 请求侧：不只有 `tools`

一次带工具的 Responses 请求，可以按职责分为以下字段：

| 字段 | 与工具的关系 | 当前 Codex 用法 |
| --- | --- | --- |
| `tools` | 声明可用工具及其类型、名称、描述、参数 Schema 和工具特有配置 | 标准路径由 `ToolSpec` 序列化；Lite 路径改放 `AdditionalTools` |
| `tool_choice` | 决定禁止、自动、必须或指定某个工具调用 | 当前普通请求固定为 `auto` |
| `parallel_tool_calls` | 是否允许模型在一次响应中产生多个可并行调用 | 由模型能力与 Turn 配置共同决定；Lite 路径关闭 |
| `input` | 携带用户消息、历史调用和上一轮工具输出 | Codex 增量累积 `ResponseItem`；工具输出通过这里回传 |
| `instructions` | 告诉模型何时、为何以及按什么工作流使用工具 | 放行为规则，不替代工具 Schema；Lite 路径编码为 developer message |
| `include` | 请求返回额外结果，例如 Hosted Tool 的 sources、results 或 outputs | Codex 当前主要请求 `reasoning.encrypted_content`，没有统一请求所有 Hosted Tool 明细 |
| `max_tool_calls` | 限制一次响应中 Built-in Tool 的总调用数 | OpenAI API 支持；当前 Codex `ResponsesApiRequest` 未暴露此字段 |
| `previous_response_id` / `conversation` | 让服务端关联既有响应或会话，其中可能包含工具调用链 | Codex WebSocket 请求类型支持 `previous_response_id`，普通构造路径主要发送本地维护的 `input` |
| `stream` | 选择 SSE / WebSocket 流，决定工具调用参数如何增量到达 | Codex 开启流式响应并解析 Tool Call Input Delta 与完成事件 |

`model` 也会间接决定工具能力：Provider / Model Capability 会影响 Namespace、Tool Search、并行调用、Responses Lite 等协议特性是否可用。`store`、`prompt_cache_key`、`reasoning`、`text` 和 `service_tier` 不是工具专用字段，但会影响状态保存、缓存、推理或输出控制。

## `tools` 字段内部仍是一组子协议

不同 Tool 类型不会共享完全相同的配置：

- Function Tool：`name`、`description`、`parameters`、`strict`；
- Custom / Freeform Tool：自由文本输入格式及语法定义；
- Namespace / Tool Search：Namespace、嵌套工具、`defer_loading` 和动态加载入口；
- Hosted Tool：除 `type` 外还可能有搜索过滤、位置、索引、容器或远程 Server 配置；
- Remote MCP：Server 地址或标识、认证和 Approval 策略。

所以“本地定义 Hosted Tool”不是在本地实现 Hosted Runtime，而是在构造 Provider API 所需的声明和配置。真正执行仍可能发生在模型服务端。

## 响应侧：Tool Call 是结构化 Output Item

Provider 不应只返回一段“请调用某工具”的文本。标准工具闭环依赖结构化响应项：

```text
request.tools
    ↓
response: function_call / custom_tool_call / hosted_tool_call
    ↓
Codex Runtime 或 Provider Hosted Runtime 执行
    ↓
next request.input: function_call_output / custom_tool_call_output
    ↓
model continues
```

对客户端执行的工具，调用项至少需要：

- 工具身份：`name`，Namespace 模式下还可能有 `namespace`；
- 调用参数：Function 使用 JSON 字符串 `arguments`，Custom Tool 使用自由文本 `input`；
- 配对身份：`call_id`；
- 生命周期信息：Item `id`、`status` 以及流式 added / delta / done 事件。

Codex 解析 `function_call`、`custom_tool_call` 和 `tool_search_call`，在本地完成路由与执行后，把结果编码为同一 `call_id` 的 `function_call_output`、`custom_tool_call_output` 或 `tool_search_output`。`call_id` 不是日志装饰，而是协议完整性的主键。

Hosted Tool 的执行链不同：Provider 可直接执行 Web Search、Image Generation 等能力，并返回 `web_search_call`、`image_generation_call` 等 Output Item；客户端主要消费状态和结果，不一定需要本地 Handler，也不一定要回传一个本地 Tool Output。

## 流式协议与错误边界

开启流式传输后，Codex 同时处理三类信息：

1. `response.output_item.added`：知道一个调用项已经开始；
2. Tool Call Input Delta：增量接收 Function arguments 或 Custom input；
3. `response.output_item.done` / `response.completed`：取得完整调用或响应终态。

参数执行必须等到完整边界并通过解析与验证，不能把尚未完成的 delta 直接交给 Runtime。Provider 传输错误、Tool Call 参数错误、本地执行错误和 Hosted Tool 错误也属于不同错误域：只有可恢复的工具错误适合编码成 Tool Output 交还模型继续决策。

## Codex 源码映射

按下面顺序阅读，可以把内部对象与线路协议对上：

1. `codex-rs/core/src/client_common.rs`：`Prompt` 聚合 input、tools、并发开关和基础指令；
2. `codex-rs/tools/src/tool_spec.rs`：`ToolSpec` 定义 Responses API 的工具类型；
3. `codex-rs/tools/src/responses_api.rs`：Function、Namespace、Freeform 的具体 Wire Shape；
4. `codex-rs/core/src/client.rs`：`build_responses_request` 把内部 Prompt 映射为标准或 Lite 请求；
5. `codex-rs/codex-api/src/common.rs`：`ResponsesApiRequest`、WebSocket Request 与 `ResponseEvent`；
6. `codex-rs/codex-api/src/sse/responses.rs`：SSE 事件如何映射为统一事件；
7. `codex-rs/protocol/src/models.rs`：Call、Output、Hosted Call 等 `ResponseItem` 的 Wire Model；
8. `codex-rs/core/src/tools/context.rs`：本地执行结果如何变成下一轮 Input Item。

在第 4 步读到 `build_responses_request` 返回即可暂停，不必立即跟进认证、HTTP Transport 和 Telemetry；那些属于 Provider Transport，而不是 Tool Protocol 核心。

## 设计检查清单

接入一个新 Provider 或新 Tool 类型时，应逐项确认：

1. Tool Spec 能否无损映射到 Provider 的 `tools` 或等价字段？
2. `tool_choice`、并发、Deferred Loading 和 Hosted 配置是否受支持？
3. 流式参数 delta 在哪里聚合，完整调用的边界是什么？
4. Provider 返回的 Call 类型能否映射到统一 `ResponseItem`？
5. 本地结果用什么 Output Item 回传，是否保持同一 `call_id`？
6. Hosted Tool 是否错误地注册了本地 Handler，或本地 Tool 是否缺少 Executor？
7. 历史重放、压缩和恢复是否保留 Call / Output 配对？
8. 不支持的 API 字段是显式降级、转换，还是被静默丢弃？
