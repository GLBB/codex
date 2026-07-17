# Streaming：从增量事件恢复完整决策

## Stream 是事件日志，不是逐字打印

Agent 的流式响应可能交错出现文本、Reasoning Summary、Tool Call 参数、Usage、Rate Limit 和终态事件。正确的客户端应把 Stream 看作有类型的有限事件序列：

```text
Created
  → ItemAdded
  → zero or more Delta
  → ItemDone
  → ... more items ...
  → Completed | Failed | Cancelled | TransportLost
```

用户看到的逐字输出只是这条事件流的一个投影。UI 可以边到边展示，但 Agent Runtime 只能在相应 Item 完整、参数可解析且响应状态允许时执行动作。

## 三层状态机

一个稳健的消费者通常维护三层状态：

1. Transport 状态：连接、空闲超时、断开、重连、取消；
2. Response 状态：created、in progress、completed、failed；
3. Item 状态：added、delta accumulation、done、validated。

```text
Transport connected
    └── Response in_progress
            ├── message item: text deltas → done
            ├── reasoning item: summary deltas → done
            └── function call: argument deltas → done → validate
```

不要用“连接自然结束”代替 `response.completed`。连接关闭可能意味着成功结束，也可能意味着代理截断、空闲超时或网络故障。

## Tool Arguments 必须等到完整后解析

Function Call 的 JSON 参数可能被拆成任意边界：

```text
delta 1: {"pa
delta 2: th":"Cargo
delta 3: .toml"}
```

单个 Delta 不是合法 JSON 很正常。客户端应按 Item 或 Call 身份累计原始片段，在 done 事件后解析，再执行 Schema、语义、权限和 Policy 校验。边接收边执行会产生半参数动作和不可恢复副作用。

## 顺序、重复与未知事件

协议实现应明确：

- 同一 Item 内 Delta 是否严格有序；
- 多个 Item 是否允许交错；
- 重连后 Provider 是否重发已见事件；
- 是否有稳定 Response ID、Item ID 或序列号用于去重；
- 未知事件应忽略、记录还是中止。

前向兼容通常要求记录并跳过不影响状态机的未知事件，但未知终态或未知动作类型不能盲目忽略。系统必须保证“没有确认终态时，不把响应宣布为成功”。

## 背压与有界内存

Stream 并不天然节省内存。如果 Producer 远快于 Consumer，或客户端无限累计 Reasoning、文本和 Tool Arguments，仍会耗尽资源。需要：

- 有界 Channel；
- 单 Item 与整次响应的大小上限；
- 慢消费者策略；
- Tool Output 和日志的独立截断；
- Consumer Drop 时取消上游映射任务。

显示层可以丢弃部分非关键增量，协议层不能丢失完成 Tool Call 所需的参数和终态。

## 取消与断线

取消至少要传播到三个位置：上游 Provider 请求、事件映射任务和下游 Tool Runtime。取消后的最终状态应区分：

- 模型尚未产生完整动作；
- 动作已完整产生但尚未执行；
- Tool 已开始，副作用状态未知；
- Tool 已完成但 Observation 尚未回传。

断线重试同样不能只看“是否收到过文本”。关键问题是请求是否可能已在 Provider 执行、是否已经产生可观察 Item，以及重发是否会重复计费或改变决策。对于纯推理请求，整次重放通常不会直接重复外部副作用；但如果 Provider 托管工具已经执行，风险边界会改变。

## Streaming 与用户体验

Streaming 能降低首 Token 延迟，却不一定降低总延迟。合理的 UI 投影包括：

- 文本和允许公开的 Reasoning Summary 增量展示；
- Tool Call 在参数完整后展示“准备执行”；
- 重连时展示有界重试进度；
- 明确区分“模型生成结束”和“Agent 任务完成”。

不要把原始隐藏推理内容当作必须向用户展示或持久化的审计记录。审计应记录可解释的决策、动作、结果和证据。

## Codex 源码阅读路线

先打开 `codex-rs/codex-api/src/sse/responses.rs`，从 `spawn_response_stream` 和 `ResponsesStreamEvent` 开始。观察 Header 中的 Rate Limit、Model、ETag 怎样被转换为统一事件，再看 SSE 事件怎样携带 `item_id`、`call_id`、`delta` 和响应终态。读到事件分派的主 `match` 后停止，不必先追每个测试分支。

接着阅读 `codex-rs/core/src/client_common.rs` 的 `ResponseStream`。注意有界 Receiver 和 `Drop` 中的取消信号：消费者停止轮询也是生命周期事件。

然后进入 `codex-rs/core/src/client.rs` 的 `map_response_stream` 调用点以及 `stream_responses_api`、`stream_responses_websocket`。比较两种 Transport 如何被映射为同一种 Core Stream。

最后打开 `codex-rs/core/src/session/turn.rs`，从 `run_sampling_request` 跟到消费 `ResponseEvent` 的函数。观察完整 Item 如何进入历史、Tool Call 如何触发 Runtime，以及 `Completed`、错误和 follow-up 怎样影响下一轮。到“是否需要 follow-up”的判断后停止，避免过早钻入具体 Tool Handler。

## 本篇检查

1. 是否分别维护 Transport、Response 和 Item 状态？
2. Tool Arguments 是否只在 Item 完整后解析执行？
3. 是否把明确终态与连接关闭区分开？
4. Channel、Item 和整次响应是否都有硬上限？
5. Consumer Drop 和用户取消是否能传播到上游？
6. 重连后如何处理重复事件和未知执行状态？
7. UI 是否区分模型完成与 Agent 完成？

---

[上一篇：能力协商](03-capability-negotiation.md) · [返回学习地图](README.md) · [下一篇：Reasoning Effort 与 Sampling](05-reasoning-effort-and-sampling.md)
