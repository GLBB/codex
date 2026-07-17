# Model Provider 与 API Protocol

## 先分清五个层次

一次“调用模型”通常横跨五个不同对象：

| 层次 | 主要职责 | 典型问题 |
| --- | --- | --- |
| Model | 生成候选决策的具体模型 | 上下文多大、支持什么模态、推理等级有哪些 |
| Provider | 提供认证、目录、配额和推理服务 | Base URL、凭据、区域、租户、限额是什么 |
| API Protocol | 定义请求与响应的线路结构 | input、tools、output item、error 怎样编码 |
| Transport | 搬运协议消息 | HTTPS/SSE、WebSocket、超时、断线怎样处理 |
| Agent Runtime | 构造上下文、执行工具并推进状态 | 是否允许动作、怎样回写 Observation、何时结束 |

同一模型可能由多个 Provider 提供；同一 Provider 可能托管多个模型；同一 API Protocol 也可能通过不同 Transport 传输。把它们合成一个 `call_model()` 黑盒，会让认证错误、能力不兼容、流中断和模型拒绝难以分别处理。

## Provider 配置不是 Model 能力目录

Provider 配置回答“怎样连接服务”，Model 元数据回答“连接后能对某个模型做什么”。两者应分别建模。

一个 Provider 描述通常包含：

- 端点与 Wire API；
- API Key、登录令牌、命令式认证或云厂商签名；
- 固定 Header、环境变量 Header 和 Query 参数；
- 请求重试、流重连、空闲超时和 Transport 能力；
- Provider 级错误到统一错误模型的映射。

一个 Model 描述通常包含：

- 稳定标识、展示信息、可见性和优先级；
- Context Window、输入模态和工具支持；
- Reasoning Effort、Verbosity、Service Tier；
- Structured Output、并行工具调用和流式能力；
- 模型专属 Instructions、压缩策略和兼容性标识。

Provider 支持 WebSocket，不代表其中每个模型都支持任意工具；模型支持图像输入，也不代表当前客户端知道怎样编码图像。有效能力是多个集合的交集：

```text
Effective Capability
  = Provider Capability
  ∩ Model Capability
  ∩ Client Implementation
  ∩ Product Policy
  ∩ Current Auth / Tenant Entitlement
```

## Responses 风格的 Item 协议

面向 Agent 的协议需要表达的不只是 Assistant 文本，还包括 Reasoning、Tool Call、Tool Output 和响应生命周期。Responses 风格协议可抽象为：

```text
Request
  model
  instructions
  input: [typed item]
  tools: [tool contract]
  reasoning / text / service_tier
  stream

Response Stream
  response.created
  output_item.added
  content / arguments delta
  output_item.done
  response.completed | response.failed
```

客户端执行的 Function Tool 形成两次模型请求之间的配对闭环：

```text
response: function_call(call_id, name, arguments)
                    │
                    ▼
          Agent validates and executes
                    │
                    ▼
next input: function_call_output(call_id, output)
```

`call_id` 是协议一致性的主键。缺失、重复或错误配对都可能让模型把一个 Observation 归给另一项动作。

Provider 托管工具的边界不同：Provider 可能自己完成搜索或代码执行，再以具体 Call Item 和结果事件返回。系统仍要区分“模型提出动作”“谁执行动作”“谁负责把结果回到下一步上下文”。

Tool 线路协议的更细说明见 [Model Provider API 与 Tool 协议](../tool/08-provider-api-protocol.md)。本组教程后续关注能力选择和决策系统，不重复展开所有工具类型。

## 请求构造应是显式投影

不要把内部 `TurnContext` 整体序列化给 Provider。更稳健的方式是根据已协商能力构造一个线路请求：

```text
Internal Turn State
    │
    ├── select model-visible history
    ├── select compatible tools
    ├── normalize reasoning controls
    ├── encode output schema if supported
    └── attach transport / telemetry metadata
    ▼
Provider-specific Request DTO
```

这样能避免把内部权限状态、Secret、不可见工具或 Provider 不认识的字段意外发送出去，也便于比较“逻辑请求”和“线路请求”的差异。

## Codex 源码阅读路线

先打开 `codex-rs/model-provider-info/src/lib.rs`，从 `WireApi` 和 `ModelProviderInfo` 开始。观察 Provider 连接信息、认证选择、HTTP Header、请求重试和流超时怎样被集中表示；继续读 `to_api_provider`，看配置如何投影为 API Client 使用的 Provider。

接着打开 `codex-rs/protocol/src/openai_models.rs` 的 `ModelInfo`。此时先不要追每个枚举，重点比较它和 `ModelProviderInfo`：前者描述模型能力，后者描述服务连接。读到 `resolved_context_window` 和 `service_tier_for_request` 后停下，记住能力值在进入请求前还会被解析和过滤。

然后打开 `codex-rs/core/src/client_common.rs` 的 `Prompt`。它是 Codex 内部的一次模型请求聚合对象，包含 `input`、工具、是否允许并行工具调用、基础指令和最终输出 Schema。它不是线路 DTO，也不等于自然语言 Prompt。

最后进入 `codex-rs/core/src/client.rs`，按 `build_responses_request`、`stream_responses_api`、`stream_responses_websocket`、`stream` 的顺序阅读。你会看到内部 `Prompt` 被编码成 Responses 请求，随后由 Transport 发送并映射为统一 `ResponseStream`。读到 `stream` 的 HTTPS/WebSocket 分支后停止；工具执行属于 Agent Loop 与 Tool Runtime，留到相关教程再跟。

## 本篇检查

1. 系统是否分别记录 Provider、Model、Wire API 和 Transport？
2. 认证信息是否停留在连接层，而不是混入模型上下文？
3. 内部 Turn State 是否通过显式投影生成线路请求？
4. Tool Call 与 Tool Output 是否以稳定 ID 配对？
5. Provider 托管工具与客户端执行工具的责任边界是否明确？
6. Provider 特有字段是否被隔离在 Adapter，而不是泄漏到 Agent Loop？

---

[返回学习地图](README.md) · [下一篇：能力协商](02-capability-negotiation.md)
