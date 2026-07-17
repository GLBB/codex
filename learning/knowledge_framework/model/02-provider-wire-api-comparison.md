# Provider Wire API：Chat Completions、Responses 与 Anthropic Messages

## 为什么需要比较 Wire API

Provider Wire API 不是“把 Prompt 发给模型”的同义词。它规定一次推理在线路上怎样表示：

- 指令、对话历史与多模态内容；
- 模型生成的文本、推理摘要与动作；
- Tool Call 与 Tool Result 的配对；
- 流式增量、完成、拒绝、取消和错误；
- 多轮状态由客户端重放，还是由 Provider 通过 ID 延续。

Chat Completions、Responses 和 Anthropic Messages 通常都使用 HTTPS + JSON，并可通过 SSE 流式返回。HTTPS、SSE 或 WebSocket 属于 Transport；Message、Item、Content Block 和事件类型才属于 Wire API。不要因为它们都能承载聊天文本，就假设它们可以逐字段互换。

## 协议为什么从 Completion 演进而来

早期 Completion API 接受一个字符串 Prompt，再返回续写文本：

```text
prompt string → completion string
```

应用需要自行拼接角色、分隔符、历史和工具约定。这会把语义边界藏进模板：同一段文本究竟是系统指令、用户数据、工具结果还是模型输出，只能靠约定推断。

第一轮演进是结构化对话：

```text
prompt string
    ↓
messages[{ role, content }]
```

Message 解决了角色和多轮历史的结构化问题。但 Agent 的一次决策逐渐不再只是一条 Assistant 文本，它还可能包含推理、多个工具调用、托管工具结果、结构化输出和不同终态。于是又出现两种扩展方向：

```text
OpenAI Responses
Response → typed Items → typed content / events

Anthropic Messages
Message → typed Content Blocks → typed block events
```

OpenAI 将 Responses 定义为 Chat Completions 的演进接口，并推荐新项目使用 Responses；Anthropic 也把旧 Text Completions 标记为 Legacy，后续能力以 Messages 为主。它们共同解决“裸文本续写不能稳定表达对话和动作”的问题，但选择了不同的聚合层次。

官方参考：

- [OpenAI：从 Chat Completions 迁移到 Responses](https://developers.openai.com/api/docs/guides/migrate-to-responses)
- [Anthropic：Messages API](https://platform.claude.com/docs/en/api/messages/create)
- [Anthropic：Legacy Text Completions](https://platform.claude.com/docs/en/api/completions/create)

## 三种协议先看全貌

| 维度 | OpenAI Chat Completions | OpenAI Responses | Anthropic Messages |
| --- | --- | --- | --- |
| 主要端点 | `/v1/chat/completions` | `/v1/responses` | `/v1/messages` |
| 顶层输入 | `messages` | `instructions` + `input` | `system` + `messages` |
| 基本输出单位 | `choice.message` | `output` 中的 typed Item | Assistant Message 中的 typed Content Block |
| 普通文本 | Message Content | Message Item 的 Content | `text` Block |
| 工具调用 | Assistant Message 的 `tool_calls` | `function_call` Item | Assistant Message 的 `tool_use` Block |
| 工具结果 | `role: tool` + `tool_call_id` | `function_call_output` + `call_id` | User Message 的 `tool_result` Block |
| 推理表示 | 能力和形状受模型限制 | 独立 Reasoning Item，可延续或加密 | Thinking Content Block |
| 多轮状态 | 客户端重发历史 | 重发 Items、`previous_response_id` 或 Conversation | 客户端重发历史 |
| 流式主键 | Choice Index | Response、Output Index、Item ID | Message、Block Index |
| 多候选 | 可返回多个 Choices | 一次 Response 产生一条候选轨迹 | 一次请求产生一个 Message |

这个表描述的是协议形状，不代表每个模型都支持表中的所有能力。最终能发送哪些字段，仍由 Provider、Model、Client、Policy 和 Auth 的能力交集决定。

## Chat Completions：以 Message 为中心

Chat Completions 把一次生成建模为“根据消息历史生成下一条 Assistant Message”：

```text
Request
  model
  messages[]
    system / developer / user / assistant / tool
  tools[]
  response_format
  stream

Response
  choices[]
    index
    message
    finish_reason
```

客户端工具闭环通常是：

```text
assistant.tool_calls[{ id, function }]
                │
                ▼
        client validates and executes
                │
                ▼
tool message { tool_call_id, content }
```

Chat Completions 的优势是概念直接、生态成熟，适合已有 Message Transcript 的应用，也能表达函数调用和结构化输出。它的主要限制不是“不能做 Agent”，而是越来越多语义附着在 Message、Choice 和专用字段上：普通文本、工具调用、拒绝、音频和终态不共享一个统一的 typed action 序列。

流式响应同样以 Choice 为中心。客户端累积 `choices[index].delta`，直到收到完成原因。只消费文字 Delta 的实现不能自动正确处理并行工具调用、参数增量或非文本结果。

## Responses：以 typed Item 为中心

Responses 把一次推理建模为一个有 ID、有生命周期、包含多个输出 Item 的 Response：

```text
Request
  model
  instructions
  input: [typed Item]
  tools: [tool contract]
  reasoning / text / service_tier
  previous_response_id
  stream

Response
  id
  output[]
    reasoning
    message
    function_call
    hosted_tool_call
  usage / status / error
```

Message 仍然存在，但只是 Item 的一种。Function Tool 的调用和结果是两个独立 Item：

```text
function_call(call_id, name, arguments)
                │
                ▼
        client validates and executes
                │
                ▼
function_call_output(call_id, output)
```

这样做解决了三个结构问题：

1. 一次响应可以按顺序包含多种模型行为，而不必把它们塞进一条 Message；
2. Reasoning、Tool Call 和 Tool Output 可以作为上下文中的独立对象保留；
3. Streaming 可以报告 Response、Item、Content 和 Arguments 各自的生命周期。

典型流式事件包括：

```text
response.created
response.output_item.added
response.output_text.delta
response.function_call_arguments.delta
response.output_item.done
response.completed | response.failed
```

`previous_response_id` 允许后续请求只提交增量输入，但它不会让历史 Token 免费，也不应成为 Agent 唯一的事实来源。需要跨 Provider、做压缩或进行可重放调试时，Host 仍应维护自己的有界逻辑历史。

官方参考：[OpenAI Function Calling](https://developers.openai.com/api/docs/guides/function-calling)。

## Anthropic Messages：Message 中包含 typed Content Block

Anthropic Messages 保留 User/Assistant 交替的 Message Transcript，但把一条 Message 的内容扩展为 Block 列表：

```text
Request
  model
  system
  messages[]
    role: user | assistant
    content[]
      text / image / document
      tool_use / tool_result
      thinking
  tools[]
  max_tokens
  stream

Response Message
  id
  role: assistant
  content[]
  stop_reason
  usage
```

这里有两个容易迁移错误的边界：

- System Prompt 使用顶层 `system` 字段，不是普通的 `system` Message；
- 客户端工具结果是下一条 User Message 中的 `tool_result` Block，不是独立 `tool` Role。

工具闭环是：

```text
assistant message
  └── tool_use(id, name, input)
                    │
                    ▼
            client executes
                    │
                    ▼
user message
  └── tool_result(tool_use_id, content)
```

客户端工具通常让响应以 `stop_reason: tool_use` 结束；Host 执行工具、追加结果并再次请求。Anthropic 托管的 Server Tool 则可在 Provider 内执行，不能与客户端工具假定相同的副作用和 Retry 边界。

Streaming 以 Message 和 Content Block 两层状态机组织：

```text
message_start
content_block_start
content_block_delta*
content_block_stop
message_delta
message_stop
```

Tool 参数通过 `input_json_delta` 传输部分 JSON。应在 Block 完成后再做最终解析和 Schema 验证；未知事件类型应被安全忽略或保留，而不是让整个消费者崩溃。

官方参考：

- [Anthropic Tool Use](https://platform.claude.com/docs/en/agents-and-tools/tool-use/how-tool-use-works)
- [Anthropic Streaming Messages](https://platform.claude.com/docs/en/build-with-claude/streaming)

## 三种协议不能无损互转

Provider Adapter 可以统一 Agent Runtime 的概念，但不能假装所有线路能力完全相同。

### 指令边界不同

Chat Completions 以角色消息表达指令；Responses 既接受 `instructions`，也接受 Message Item；Anthropic 使用顶层 `system`。Adapter 必须明确哪些指令在每轮重发，哪些已经包含在 Provider 状态中。

### 输出聚合层次不同

Chat Completions 的聚合根是 Choice，Responses 是 Response/Item，Anthropic 是 Message/Content Block。若统一层只保留最终文本，会丢失工具调用、Reasoning、拒绝和终态证据。

### Tool Result 的身份不同

三者分别使用 `tool_call_id`、`call_id` 和 `tool_use_id`。内部模型应使用稳定的 `ModelVisibleCallId` 概念，再由 Adapter 编码，不能用数组位置或工具名配对。

### 状态能力不同

Chat Completions 与 Anthropic Messages 通常由客户端重发 Transcript；Responses 可以引用 `previous_response_id`。从 Responses 切到其他协议时，Provider 私有 Response ID 不可复用，必须从逻辑历史重建请求。

### Hosted Tool 与 Client Tool 不等价

客户端工具的调用和结果之间有清晰的 Host 执行边界；Hosted Tool 可能已经在 Provider 内产生搜索、代码执行或其他副作用。断流后的 Retry 必须知道工具在哪里执行，不能只根据“是否收到最终文本”判断。

## Agent 内部不要直接选择某一家协议作为事实模型

更稳健的边界是：

```text
Goal / State / Policy
        │
        ▼
Logical Turn Contract
  instructions
  model-visible history
  tool contracts
  output contract
        │
        ▼
Capability Negotiation
        │
        ▼
Provider Adapter
  ├── Chat Completions DTO
  ├── Responses DTO
  └── Anthropic Messages DTO
        │
        ▼
Transport + Provider Event Stream
        │
        ▼
Normalized Candidate Decision
  message / reasoning / action / observation / terminal status
```

内部归一化需要遵守几个原则：

1. 保留顺序、角色、Channel、Item/Block 类型和原始 Provider ID；
2. Tool Call 与 Tool Result 用稳定 ID 配对；
3. 记录实际使用的 Provider、Model、Wire API 和 Transport；
4. 未识别或 Provider 私有内容保留有界 Raw Payload 引用；
5. 逻辑历史增量追加，不通过事后重写伪造另一种协议；
6. Adapter 投影可以有损，但必须显式拒绝无法安全表达的能力。

## Codex 源码阅读路线

先打开 `codex-rs/model-provider-info/src/lib.rs`，阅读 `WireApi`。当前实现只有 `Responses` 变体；配置 `wire_api = "chat"` 会返回迁移错误。这说明本篇的三协议比较是通用 Agent 架构知识，不表示当前 Codex 同时实现了三种线路。

接着打开 `codex-rs/core/src/client.rs`，从 `build_responses_request` 读到 `stream`。观察内部 `Prompt` 怎样投影成 Responses Request，以及相同 Wire API 怎样在 Responses WebSocket 与 HTTP Transport 之间切换。到 `WireApi::Responses` 分支结束后停下。

然后进入 `codex-rs/codex-api/src/requests/responses.rs` 和 `codex-rs/codex-api/src/sse/responses.rs`。前者是请求 DTO，后者把 typed SSE Event 映射成统一 `ResponseStream`。这两处是 Wire API 编码和 Transport 消费的边界。

最后阅读 `codex-rs/rollout-trace/src/model/`：

- `mod.rs` 的 `RolloutTrace` 把 Conversation、Inference 和 Runtime 对象分开；
- `conversation.rs` 的 `ConversationItemKind` 保存 Message、Reasoning、Function Call 和 Output 等归一化类别；
- `InferenceCall` 记录实际 `model`、`provider_name`、`response_id`、完整输入/输出 Item ID 和 Raw Payload 引用；当前 Reduced Trace 没有再单列 Wire API 与 Transport，阅读时应把这是 Codex 当前实现边界还是通用设计要求区分开；
- `runtime.rs` 的 `ToolCall` 区分模型可见调用 ID、运行时工具对象和原始执行载荷。

这里的模型是 Responses-shaped trace normalization，不是任意 Provider 的现成 Adapter。继续读 `codex-rs/rollout-trace/src/reducer/conversation/normalize.rs`，看 Responses JSON Item 怎样变成 `ConversationItem`；再读相邻 `conversation.rs` 中的 `previous_response_id` 分支，看 Reducer 如何从前一请求和响应重建完整的模型可见输入快照。读到快照重建完成即可停止，不必追进 Terminal 或多 Agent 运行时。

## 设计检查

1. 系统是否把 Wire API 与 HTTP/SSE/WebSocket Transport 分开？
2. 内部事实模型是否独立于 Chat Message、Responses Item 和 Anthropic Block？
3. Provider Adapter 是否显式处理 System/Developer 指令差异？
4. Tool Call/Result 是否按协议 ID 配对，而不是按顺序或名称猜测？
5. 是否保留 Reasoning、Hosted Tool、拒绝和终态，而不只提取最终文本？
6. `previous_response_id` 丢失或切换 Provider 后，逻辑历史能否重放？
7. 流式消费者是否按协议状态机聚合，并容忍未知事件？
8. 不可表达的能力是明确降级或拒绝，还是被 Adapter 静默丢弃？
9. Raw Payload 是否有大小上限、脱敏策略和稳定引用？
10. Trace 是否能回答一次请求实际用了哪个 Provider、Model、Wire API 和 Transport？

---

[上一篇：Model Provider 与 API Protocol](01-provider-api-protocol.md) · [返回学习地图](README.md) · [下一篇：能力协商](03-capability-negotiation.md)
