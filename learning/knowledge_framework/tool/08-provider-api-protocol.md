# Model Provider API 与 Tool 协议

## 本文为什么以 Responses API 为主

本文讲的是 Codex 当前主要使用的 **Responses API 协议形态**，不是以 `messages` 为中心的 Chat Completions API。两者都能完成文本生成和 Function Calling，但核心抽象不同：

```text
Chat Completions: messages -> assistant message
Responses API:    input items -> output items
```

Chat Completions 把一次模型交互组织成消息列表，典型请求和读取方式是：

```json
{
  "model": "<model>",
  "messages": [
    {"role": "system", "content": "You are a helpful assistant."},
    {"role": "user", "content": "读取 Cargo.toml"}
  ]
}
```

客户端主要读取 `choices[0].message`。这种结构适合普通聊天，但 Agent 的一次输出不一定只是一条 Assistant Message，还可能包含 Reasoning、Tool Call、Tool Output 或 Provider 侧工具状态。

Responses API 因此改用更一般的 Item 模型：

```json
{
  "model": "<model>",
  "instructions": "You are a coding agent.",
  "input": [
    {"role": "user", "content": "读取 Cargo.toml"}
  ],
  "tools": ["<tool declarations>"]
}
```

返回值的 `output` 是一组带类型的 Item。Message 只是其中一种，`reasoning`、`function_call`、`function_call_output`、`web_search_call` 等也可以作为独立 Item 出现在模型上下文或输出中。

| 关注点 | Chat Completions API | Responses API |
| --- | --- | --- |
| 主要端点 | `/v1/chat/completions` | `/v1/responses` |
| 核心输入 | `messages` | `instructions` + `input` Items |
| 核心输出 | `choices[].message` | `output[]` typed Items |
| 工具调用 | Assistant Message 内的 `tool_calls` | 独立的 `function_call` 等 Output Item |
| 工具结果 | `role: tool` Message | 以 `call_id` 配对的 `function_call_output` 等 Input Item |
| 多轮状态 | 通常由客户端重发累计的 `messages` | 可重放 Items，也可使用 `previous_response_id` 或 Conversation |
| 流式协议 | 以 `delta` chunk 为主 | 按事件 `type` 区分文本、参数、Item 和响应生命周期 |
| Provider 托管工具 | 不是核心抽象 | 原生支持 Web Search、File Search、Computer Use、Code Interpreter、Remote MCP 等 |

新增 Responses API 的原因不是仅仅换一套字段，而是原有 Message 抽象越来越难清晰表示 Agent 行为。新的协议主要解决四个问题：

1. **行为类型扩展**：把自然语言消息、Reasoning、Tool Call 和 Tool Output 拆成可以独立演进的 Item；
2. **工具执行整合**：同时表达客户端执行的 Function Tool 和 Provider 侧执行的 Built-in Tool；
3. **推理与状态延续**：保留工具链和 Reasoning Item，并支持通过响应 ID 或 Conversation 关联多轮状态；
4. **统一多模态与流式事件**：输入、输出和增量事件都能用明确的类型扩展，而不必继续把不同语义塞进 Message 或通用 Delta。

因此可以把两者的定位简化为：**Chat Completions 面向“根据消息生成下一条消息”，Responses API 面向“根据上下文和能力产生一组结构化模型行为”**。Chat Completions 仍受支持，但 OpenAI 推荐新项目使用 Responses API；官方迁移说明见 [Migrate to the Responses API](https://developers.openai.com/api/docs/guides/migrate-to-responses)。

理解这一差异后，再阅读本文后面的 `ResponseItem`、`call_id`、Provider 侧工具和流式事件会更自然：这些设计不是 Codex 私有的聊天封装，而是 Responses API 的 Agent 协议基础。

## 术语约定：Built-in Tool 与 Hosted Tool

OpenAI 当前主工具指南主要使用 **Built-in Tool**，指 Responses API 原生提供或原生连接的能力，例如 Web Search、File Search、Image Generation、Computer Use 和 Code Interpreter。OpenAI 的 Cookbook 和部分 SDK 文档也使用 **Hosted Tool**，强调工具不是由客户端的 Function Handler 手动执行，而是由 Provider 托管、编排或连接；官方示例见 [Using tools](https://developers.openai.com/api/docs/guides/tools) 和 [Hosted Tools](https://developers.openai.com/cookbook/examples/responses_api/responses_example#hosted-tools)。

本文保留 `Hosted Tool` 作为一个**执行边界分类**：泛指不由 Codex 本地 Function Handler 完成调用闭环的工具。它不是跨 Provider 的统一标准术语，也不是 Responses API 中名为 `hosted_tool` 的 Wire Type。在线路协议中，工具仍使用具体类型：

```json
{"type": "web_search"}
{"type": "file_search", "vector_store_ids": ["<id>"]}
{"type": "image_generation"}
```

响应也使用具体 Item，例如 `web_search_call`、`image_generation_call`，不存在一个可以替代它们的通用 `hosted_tool_call`。因此阅读本文时应区分：

| 分类 | 谁完成执行闭环 | 典型线路形态 |
| --- | --- | --- |
| Function / Custom Tool | Codex 或其他客户端 Runtime | Provider 返回 Call，客户端执行后回传配对的 Output |
| Built-in / Hosted Tool | Provider 的服务端或托管 Runtime | Provider 执行并返回 `web_search_call` 等具体 Call Item 或结果 |
| Remote MCP | Provider 负责连接和编排，实际能力由远程 MCP Server 提供 | 使用具体 MCP 配置和 Call / Approval 事件 |

这个分类不能只靠工具名称机械判断。例如 Shell 既可能运行在 Hosted Container，也可能接入本地 Runtime；Remote MCP 也不是 Provider 自己实现业务能力。接入新 Provider 时，应以实际执行方、结果回传责任和该 Provider 的具体协议为准。

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
| `include` | 请求参数中的响应投影选项：指定 Provider 应在随后生成的响应中额外展开哪些数据，例如 Tool sources、results 或 outputs | Codex 当前主要要求响应附带 `reasoning.encrypted_content`，没有统一展开所有 Built-in / Hosted Tool 明细 |
| `max_tool_calls` | 限制一次响应中 Built-in Tool 的总调用数 | OpenAI API 支持；当前 Codex `ResponsesApiRequest` 未暴露此字段 |
| `previous_response_id` / `conversation` | 让服务端关联既有响应或会话，其中可能包含工具调用链 | Codex WebSocket 请求类型支持 `previous_response_id`，普通构造路径主要发送本地维护的 `input` |
| `stream` | 选择 SSE / WebSocket 流，决定工具调用参数如何增量到达 | Codex 开启流式响应并解析 Tool Call Input Delta 与完成事件 |

`include` 出现在请求体中，但控制的是响应表示。它不负责启用工具，也不等于要求模型调用工具；`tools` 决定本轮有哪些能力可用，`include` 决定 Provider 返回响应时是否附带某些通常不展开的辅助字段。例如：

```json
{
  "tools": [{"type": "web_search"}],
  "include": ["web_search_call.action.sources"]
}
```

这里 `tools` 允许模型使用 Web Search，`include` 则要求响应中的 Web Search Call 附带来源明细。类似选项还有 `file_search_call.results`、`code_interpreter_call.outputs` 和 `reasoning.encrypted_content`。因此把 `include` 列在“请求侧”，是按字段出现的位置分类，不是说请求对象自己产生返回值。官方完整取值和语义见 [Create a model response](https://developers.openai.com/api/reference/resources/responses/methods/create)。

`model` 也会间接决定工具能力：Provider / Model Capability 会影响 Namespace、Tool Search、并行调用、Responses Lite 等协议特性是否可用。`store`、`prompt_cache_key`、`reasoning`、`text` 和 `service_tier` 不是工具专用字段，但会影响状态保存、缓存、推理或输出控制。

## `tools` 字段内部仍是一组子协议

不同 Tool 类型不会共享完全相同的配置：

- Function Tool：`name`、`description`、`parameters`、`strict`；
- Custom / Freeform Tool：自由文本输入格式及语法定义；
- Namespace / Tool Search：Namespace、嵌套工具、`defer_loading` 和动态加载入口；
- Built-in / Hosted Tool：除 `type` 外还可能有搜索过滤、位置、索引或容器配置；
- Remote MCP：Server 地址或标识、认证和 Approval 策略。

所以“本地定义 Hosted Tool”不是在本地实现 Hosted Runtime，而是在构造 Provider API 所需的声明和配置。真正执行发生在模型服务端、Provider 托管 Runtime 或其连接的远程服务，具体边界取决于工具类型。

## 响应侧：Tool Call 是结构化 Output Item

Provider 不应只返回一段“请调用某工具”的文本。标准工具闭环依赖结构化响应项：

```text
request.tools
    ↓
response: function_call / custom_tool_call / web_search_call / image_generation_call / ...
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

Built-in / Hosted Tool 的执行链不同：Provider 可直接执行 Web Search、Image Generation 等能力，并返回 `web_search_call`、`image_generation_call` 等具体 Output Item；客户端主要消费状态和结果，不一定需要本地 Handler，也不一定要回传一个本地 Tool Output。

## 端到端协议示例

下面用一个简化的本地 Function Tool 串起完整闭环。第一轮请求把自然语言输入和 Tool Contract 分开编码：

```json
{
  "model": "<model>",
  "instructions": "Use project tools when needed.",
  "input": [
    {
      "role": "user",
      "content": [{"type": "input_text", "text": "读取 Cargo.toml 的 package 名称"}]
    }
  ],
  "tools": [
    {
      "type": "function",
      "name": "read_project_file",
      "description": "Read a UTF-8 file under the project root.",
      "strict": true,
      "parameters": {
        "type": "object",
        "properties": {"path": {"type": "string"}},
        "required": ["path"],
        "additionalProperties": false
      }
    }
  ],
  "tool_choice": "auto",
  "parallel_tool_calls": false,
  "stream": true
}
```

Provider 返回结构化调用，而不是让客户端从普通文本中猜测动作：

```json
{
  "type": "function_call",
  "id": "fc_123",
  "call_id": "call_123",
  "name": "read_project_file",
  "arguments": "{\"path\":\"Cargo.toml\"}",
  "status": "completed"
}
```

Host 随后完成协议解析、语义验证、Policy 和 Runtime：

```text
parse arguments
→ verify Cargo.toml is under the readable project root
→ resolve approval and sandbox policy
→ execute handler
→ truncate and structure output
```

如果 Host 在本地维护完整历史，下一轮请求会保留调用项并追加同一 `call_id` 的输出。下面省略了与示例无关的请求字段：

```json
{
  "model": "<model>",
  "input": [
    {
      "role": "user",
      "content": [{"type": "input_text", "text": "读取 Cargo.toml 的 package 名称"}]
    },
    {
      "type": "function_call",
      "id": "fc_123",
      "call_id": "call_123",
      "name": "read_project_file",
      "arguments": "{\"path\":\"Cargo.toml\"}"
    },
    {
      "type": "function_call_output",
      "call_id": "call_123",
      "output": "[package]\nname = \"codex-example\""
    }
  ],
  "tools": ["<same tool declarations required by this request mode>"],
  "tool_choice": "auto"
}
```

模型读取 Observation 后可以生成最终消息，也可以继续发出下一次 Tool Call。系统必须用调用次数、时间和成本预算限制这个循环，详见 [Agent Tool Loop、可靠性与评估](09-agent-loop-reliability-and-evaluation.md)。

如果工具被拒绝、超时或取消，也应返回匹配 `call_id` 的失败 Output，让模型知道“动作未完成或可能部分完成”。只有 Provider 传输损坏、Registry 内部不变量破坏等 Fatal Error 才应直接中断整个 Turn。

## 流式协议与错误边界

开启流式传输后，Codex 同时处理三类信息：

1. `response.output_item.added`：知道一个调用项已经开始；
2. Tool Call Input Delta：增量接收 Function arguments 或 Custom input；
3. `response.output_item.done` / `response.completed`：取得完整调用或响应终态。

参数执行必须等到完整边界并通过解析与验证，不能把尚未完成的 delta 直接交给 Runtime。Provider 传输错误、Tool Call 参数错误、本地执行错误和 Built-in / Hosted Tool 错误也属于不同错误域：只有可恢复的工具错误适合编码成 Tool Output 交还模型继续决策。

## Codex 源码映射

按下面顺序阅读，可以把内部对象与线路协议对上：

1. `codex-rs/core/src/client_common.rs`：`Prompt` 聚合 input、tools、并发开关和基础指令；
2. `codex-rs/tools/src/tool_spec.rs`：`ToolSpec` 定义 Responses API 的工具类型；
3. `codex-rs/tools/src/responses_api.rs`：Function、Namespace、Freeform 的具体 Wire Shape；
4. `codex-rs/core/src/client.rs`：`build_responses_request` 把内部 Prompt 映射为标准或 Lite 请求；
5. `codex-rs/codex-api/src/common.rs`：`ResponsesApiRequest`、WebSocket Request 与 `ResponseEvent`；
6. `codex-rs/codex-api/src/sse/responses.rs`：SSE 事件如何映射为统一事件；
7. `codex-rs/protocol/src/models.rs`：Function Call、Output、Web Search Call、Image Generation Call 等 `ResponseItem` 的 Wire Model；
8. `codex-rs/core/src/tools/context.rs`：本地执行结果如何变成下一轮 Input Item。

在第 4 步读到 `build_responses_request` 返回即可暂停，不必立即跟进认证、HTTP Transport 和 Telemetry；那些属于 Provider Transport，而不是 Tool Protocol 核心。

## 设计检查清单

接入一个新 Provider 或新 Tool 类型时，应逐项确认：

1. Tool Spec 能否无损映射到 Provider 的 `tools` 或等价字段？
2. `tool_choice`、并发、Deferred Loading 和 Built-in / Hosted 配置是否受支持？
3. 流式参数 delta 在哪里聚合，完整调用的边界是什么？
4. Provider 返回的 Call 类型能否映射到统一 `ResponseItem`？
5. 本地结果用什么 Output Item 回传，是否保持同一 `call_id`？
6. Provider 侧执行的工具是否错误地注册了本地 Handler，或本地 Tool 是否缺少 Executor？
7. 历史重放、压缩和恢复是否保留 Call / Output 配对？
8. 不支持的 API 字段是显式降级、转换，还是被静默丢弃？
9. 失败、拒绝、超时和取消是否仍生成配对的 Tool Output？
10. Agent Loop 是否具有调用次数、总 Deadline 和成本上限？
