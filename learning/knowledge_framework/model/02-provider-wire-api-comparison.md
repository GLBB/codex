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

## 先给结论：Chat Completions 确实能做 Agent

如果需求只是普通聊天：

```text
User Message → Assistant Message
```

或者只有一个由客户端执行的函数：

```text
User Message
  → Assistant Tool Call
  → Client executes
  → Tool Message
  → Assistant Message
```

Chat Completions 已经足够。Responses 和 Anthropic Messages 的价值不是让原本不可能的事情突然变得可能，而是让复杂模型行为成为协议中的一等对象，减少应用自己发明字段、状态机和恢复规则的负担。

需要区分三个问题：

| 问题 | 结论 |
| --- | --- |
| Chat Completions 能不能实现工具 Agent？ | 能 |
| 所有模型行为都适合继续挂在 Message 上吗？ | 规模变大后不自然 |
| 新协议是否提供完全不可模拟的计算能力？ | 通常不是；主要提供更合适的对象模型与 Provider 原生能力 |

因此这里比较的不是“能与不能”，而是：

```text
Chat Completions：用消息协议承载执行过程
Responses：直接把一次响应建模为执行轨迹
Anthropic Messages：把一次消息建模为有序内容块
```

## 从一个简单需求逐步升级

先看最简单的回复：

```text
assistant
└── content: "北京今天晴"
```

加入 Function Calling 后，可以继续扩展 Message：

```text
assistant
├── content: null
└── tool_calls
    └── get_weather("北京")
```

继续加入拒绝、音频、引用、推理和不同工具后，Message 容易逐渐变成一个装有大量可选字段的容器：

```text
assistant
├── content?
├── tool_calls?
├── refusal?
├── audio?
├── annotations?
├── reasoning?
└── future_field?
```

这种结构仍然可以工作，但开始出现几个设计压力：

1. `Message` 不再只表示“说了什么”，还同时表示推理、动作和终态；
2. 多种行为交错时，它们的先后顺序需要额外约定；
3. 流式消费者要从一个不断变化的嵌套对象中推断当前在生成文本、工具参数还是其他内容；
4. 每增加一种模型行为，都要决定增加 Message 字段、增加 Role，还是再设计一种特殊消息；
5. Provider 托管工具、Reasoning Continuation 和对象级状态难以只靠最终 Assistant Message 表达。

这类似把越来越多不同实体塞进一张宽表：能够保存，但大量字段在多数行中为空，而且类型、顺序和生命周期需要由表外逻辑解释。

## 一个能体现差异的复杂 Agent 轨迹

假设一次请求实际经历：

```text
1. 模型进行推理
2. 向用户输出一句进度说明
3. Provider 执行 Web Search
4. 模型并行调用两个客户端工具
5. 客户端分别返回结果
6. 模型延续先前推理
7. 生成带引用的最终回答
```

Chat Completions 可以用多轮 Message 和专用字段模拟：

```text
Assistant Message + tool_calls
Tool Message
Tool Message
Assistant Message
```

应用仍需另外决定：Reasoning 放在哪里、Provider 托管工具怎样表示、中间进度和 Tool Call 谁先谁后、断流时哪个对象已经完成。也就是说，能力可以实现，但一部分执行语义存在于应用自己的约定里。

Responses 直接把它表示成一组有序行为：

```text
Response
├── Reasoning Item
├── Message Item                 "正在查询"
├── WebSearchCall Item
├── FunctionCall Item            call_a
├── FunctionCall Item            call_b
└── Message Item                 最终回答
```

每个 Item 可以拥有自己的 ID、类型、状态和流式生命周期。Message 不再承担“所有模型行为”的职责，只负责表达消息。

Anthropic Messages 仍以对话轮次为中心，但用有序 Content Block 表达一轮内部的组合：

```text
Assistant Message
└── content[]
    ├── Thinking Block
    ├── Text Block               "正在查询"
    ├── Tool Use Block           tool_a
    └── Tool Use Block           tool_b
```

下一条 User Message 可以包含与两个调用 ID 配对的 Tool Result Block。这里的 User 不是说“真人用户执行了工具”，而是表示新的外部内容从对话输入侧返回给模型。

三种协议真正的差异可以压缩为：

```text
Chat Completions
  生成下一条消息，动作附着在消息上

Responses
  生成一段行为轨迹，消息只是其中一种 Item

Anthropic Messages
  生成下一条消息，但消息内部是有序的 typed Block 序列
```

## 新协议的必要性体现在哪里

### 1. Responses：从“说了什么”转向“做了什么”

Responses 的设计中心是一段有类型的模型行为，而不是单一 Assistant Message。它适合表达 Reasoning、多个 Tool Call、Provider 托管工具、对象级 Streaming 和 Response State。

它不是因为 Chat Completions 不能扩展，而是避免继续把每一种新行为都编码成 Message 的附加字段。对于普通文本聊天，这个优势不明显；对于长工具链和 Reasoning Model，Item 的独立身份、顺序和生命周期会直接简化编排、重放和故障恢复。

### 2. Anthropic Messages：保持对话轮次，但让内容可组合

Anthropic 没有把所有行为提升为顶层 Item，而是保留 User/Assistant 交替，通过 Content Block 表达 Text、Thinking、Tool Use、Image 等有序内容。

这种设计不一定比 Chat Completions“能力更强”，但更符合 Claude 的原生上下文和工具闭环，也避免把每种内容都变成新的 Role 或 Message 专用字段。它的价值主要在同一轮消息中保留异构内容的类型与顺序。

### 3. Provider 原生能力不能只看理论可模拟性

应用当然可以在 Chat Completions 之上自行实现状态、工具循环和事件日志，但 Provider 的 Hosted Tool、Reasoning Continuation、加密内容、签名、缓存和流式事件只会通过其原生协议暴露。

因此选协议时要问两层问题：

```text
逻辑层：这个工作流理论上能否用 Chat Message 模拟？
线路层：当前 Provider 是否通过该协议暴露并保证这些语义？
```

前者经常回答“能”，后者决定应用要自己承担多少兼容、状态和恢复成本。

## 什么时候 Chat Completions 就够了

优先继续使用 Chat Completions 的典型情况：

- 已有稳定的 Message Transcript 和大量兼容代码；
- 主要是文本生成或普通对话；
- Tool Calling 由客户端执行，调用链较短；
- 应用愿意自行管理历史、重试和状态；
- 不依赖只在其他原生协议中提供的能力。

更适合 Responses 的情况：

- 使用 OpenAI 的 Reasoning Model 和 Hosted Tool；
- 一次响应可能包含多种 Item；
- 需要对象级流式事件、状态延续或完整轨迹重放；
- 新建 OpenAI Agent 应用，希望减少自定义编排协议。

使用 Claude 时，Anthropic Messages 是其原生模型与工具协议。重点不是把它当成 Responses 的同构版本，而是正确处理 `system`、Content Block、`tool_use`、`tool_result`、`stop_reason` 和 Block Streaming 的语义。

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
