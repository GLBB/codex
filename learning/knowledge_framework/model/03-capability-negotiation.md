# 能力协商：Context、Modality、Tool、Structured Output 与 Streaming

## 能力协商的产物是本轮有效契约

能力协商不是让模型自行声明“我会什么”，也不一定是网络握手。它是 Host 在发起请求前，把任务需求与多方能力约束求交集：

```text
Task Requirements
       ∩
Model Catalog
       ∩
Provider / Transport Capability
       ∩
Client Encoder / Runtime Capability
       ∩
Policy / Auth / Budget
       ↓
Negotiated Turn Contract
```

有效契约至少应固定：模型与版本、输入模态、上下文预算、可见工具、输出格式、是否并行调用、流式 Transport、推理参数和容量等级。固定到 Turn 可以防止请求进行到一半时目录刷新导致语义漂移。

## Context Window：标称上限不等于可用输入预算

Context Window 通常覆盖输入和输出，有些 Provider 还会分别设置最大输出。Agent 不应把整个标称窗口都填满：

```text
Nominal Context Window
  - reserved model output
  - instructions and tool schemas
  - safety / provider overhead
  - uncertainty margin
  = effective input budget
```

还要区分三个阈值：

- `context_window`：模型目录给出的常规窗口；
- `effective input budget`：本轮真正允许装入的输入；
- `auto compact threshold`：触发摘要或压缩的更低阈值。

当输入超限时，选择顺序通常是：删除可再获取的低价值数据、截断单个有界 Tool Output、压缩较老历史、切换大窗口模型，最后才是拒绝请求。任何压缩都必须保留 Tool Call/Output 配对、未完成任务和关键约束。

## Modality：输入编码与模型能力必须同时成立

模态能力不能只写成一个 `multimodal: true`。至少要分别描述：

- 输入：text、image、audio、file 或其他内容类型；
- 输出：text、image、audio 或结构化数据；
- 单项大小、数量、格式和分辨率限制；
- Tool Output 中是否允许再次嵌入该模态；
- 降级策略，例如图像转 OCR 文本是否允许。

如果模型不支持某个输入模态，静默丢弃内容通常比显式失败更危险。转换模态也不是无损行为，应记录来源、转换方式和信息损失。

## Tool Calling：四层兼容性

“支持 Function Calling”仍不足以判断工具可用。每个工具至少经过四层检查：

1. 协议编码：Provider 是否接受这种 Function、Custom、Built-in 或 Tool Search 类型；
2. Schema：JSON Schema 方言、Strict Mode、名称长度和参数大小是否兼容；
3. Runtime：Host 是否有 Handler，认证、Sandbox 和网络是否就绪；
4. Policy：当前用户与任务是否允许模型看到并调用它。

```text
Registered Tools
  → protocol-compatible
  → runtime-ready
  → policy-allowed
  → task-relevant
  → model-visible tools
```

并行工具调用是独立能力。即使模型能一次产生多个 Call，Runtime 仍需判断这些动作是否互斥、是否共享可变状态，以及失败能否独立回写。

## Structured Output：约束结果，不等于验证事实

Structured Output 通过 JSON Schema 等契约限制最终输出形状。它解决“能否稳定解析”，不解决“内容是否真实”或“动作是否完成”。

```text
Schema validation  → 字段、类型、枚举、必填项正确
Semantic validation → 值之间的业务关系正确
Grounding           → 内容有证据支持
Completion          → 任务成功标准已经满足
```

协商时要确认 Provider 是否支持 Schema、Strict Mode 和所用关键字。若不支持，可选择客户端解析加重试、改用受控 Tool Call 返回结构，或明确拒绝需要强 Schema 保证的任务。不要声称“严格结构化”，却只在 Prompt 中要求模型输出 JSON。

还要区分 Tool 的 `output_schema` 与最终响应的 `output_schema`：前者约束某个工具结果，后者约束模型最终回答。二者位于不同责任边界。

## Streaming：能力不只是 `stream: true`

流式协商至少包含：

- Transport：SSE、WebSocket 或其他双向通道；
- 事件类型：文本、Reasoning、Tool Arguments、Item 和响应终态；
- 空闲超时与心跳；
- 断线后的恢复或整次重放语义；
- 取消和背压；
- 客户端是否能容忍未知事件并保持协议同步。

如果客户端只会拼接文本 Delta，就不具备完整的 Agent Streaming 能力，因为 Tool Call 参数和响应终态可能通过不同事件到达。

## 能力未知时的原则

能力目录可能陈旧、缺字段或与实际端点不一致。未知能力不应默认当作支持。可以使用三态模型：

```text
Supported   已由目录、协议版本或探测确认
Unsupported 已明确不支持
Unknown     不发送危险或不可逆依赖字段；必要时探测或失败
```

探测请求也要有成本和限流预算，不能在每个 Turn 前重复执行。运行时若收到明确的“不支持字段”，可以刷新能力缓存并重新协商，但应限制次数，避免永久循环。

## Codex 源码阅读路线

从 `codex-rs/models-manager/src/manager.rs` 的 `ModelsManager` 开始，读 `list_models`、`get_default_model` 和 `get_model_info`。观察远端模型目录、内置目录、缓存与配置覆盖如何共同生成可用模型信息。读到 `construct_model_info_from_candidates` 的调用位置后，先不要进入缓存实现。

接着阅读 `codex-rs/models-manager/src/model_info.rs` 的 `with_config_overrides` 和 `model_info_from_slug`。重点看 Context Window 覆盖如何被最大窗口限制，以及未知 Slug 为什么只能得到保守的 fallback metadata。

然后回到 `codex-rs/protocol/src/openai_models.rs` 的 `ModelInfo`，按字段组阅读：Reasoning、Tool、Context、Modality、Service Tier。把它当作能力快照，而不是业务状态。

最后打开 `codex-rs/core/src/session/turn.rs` 的 `build_prompt`，看 `supports_parallel_tool_calls`、输入模态、模型可见工具和最终输出 Schema 怎样进入 `Prompt`；再跟到 `codex-rs/core/src/client.rs` 的 `build_responses_request`，观察 Responses Lite、Reasoning Summary、Verbosity、Service Tier 和 Structured Output 在编码前怎样被过滤。到请求对象构造完成处停止。

## 本篇检查

1. 每个 Turn 是否保存解析后的能力快照？
2. Context Window 是否预留输出和不确定性空间？
3. 不支持的模态是显式转换、拒绝还是被危险地静默丢弃？
4. Tool 可见性是否同时经过协议、Runtime 和 Policy 过滤？
5. Structured Output 是否还有语义验证和证据验证？
6. 未知能力是否采用保守策略？
7. 目录刷新是否会改变正在执行的 Turn？

---

[上一篇：Provider Wire API 对照](02-provider-wire-api-comparison.md) · [返回学习地图](README.md) · [下一篇：Streaming](04-streaming.md)
