# Rate Limit、Capacity 与 Retry

## 先分类，再决定是否重试

Retry 不是错误处理的默认答案。模型请求失败后，先判断错误属于哪一层：

| 类别 | 示例 | 常见动作 |
| --- | --- | --- |
| 请求错误 | Schema、字段、Context 不合法 | 修正请求；原样重试无效 |
| 认证授权 | 401、Token 过期、租户无权限 | 刷新认证或请求用户处理 |
| Rate Limit | RPM、TPM、并发或账户额度耗尽 | 尊重 Retry-After，排队或降载 |
| Capacity | 模型过载、区域无容量 | 退避、换 Tier/区域/模型 |
| Provider 5xx | 临时服务故障 | 有界指数退避 |
| Transport | 连接失败、断流、空闲超时 | 重连或 Transport Fallback |
| Policy | 内容或动作被拒绝 | 改任务边界或终止，不得绕过 |
| Unknown side effect | 托管工具可能已经执行 | 先查询/对账，再决定是否重放 |

只有错误分类与请求幂等边界都允许时，Retry 才安全。

## Rate Limit 不只有每分钟请求数

Provider 可能同时限制：

- Requests per minute/day；
- Input、Output 或总 Tokens per minute；
- 并发请求与并发 Stream；
- 特定模型、工具、组织或项目配额；
- 账户余额、预算或试用额度；
- 长 Context、Priority Tier 或区域容量。

客户端应保留限流维度、当前使用量、重置时间和作用域。把所有 429 都压成一个字符串，会让调度器无法决定等待、排队、缩短上下文还是换 Route。

## Capacity、Quota 与 Rate Limit 的差异

- Rate Limit：某个时间窗口内的速率约束；
- Quota/Budget：累计用量或金额上限；
- Capacity：Provider 此刻能否提供计算资源；
- Concurrency Limit：同时在飞的工作数上限。

它们可能返回相似状态码，但恢复时间和策略不同。预算用尽不应自动重试；短暂容量不足可以退避；并发过高应在本地做背压，而不是让每个 Worker 独立撞 Provider。

## 指数退避、Jitter 与服务器提示

通用退避形态是：

```text
delay = min(cap, base × 2^attempt) + jitter
```

但若 Provider 给出可信的 `Retry-After` 或重置时间，应优先采用并加上本地上限。Jitter 用于避免大量客户端在同一时刻再次请求。

Retry Budget 至少包括：最大尝试次数、最大累计等待、Turn Deadline、Token/费用上限。不同层不能各自无限重试；HTTP Client、Stream Consumer、Agent Loop 和 Job Queue 的预算要能汇总，否则会出现乘法放大。

## 请求重试与 Stream 重连

二者要分别配置：

- Request Retry：请求尚未建立有效响应时，对 Transport 或 5xx 重发；
- Stream Retry：响应已经开始后连接中断，可能需要恢复或整次重新 Sampling；
- Agent Retry：模型完整响应后，因参数、验证或任务结果不合格而发起新一轮决策。

```text
HTTP retry        解决“请求是否送达”
Stream reconnect  解决“响应是否完整到达”
Agent retry       解决“完整决策是否推进任务”
```

三者的计数、事件和错误原因应分开。

## 幂等与副作用边界

纯模型生成通常没有业务副作用，但可能计费、占用配额并触发 Provider 托管工具。客户端 Tool Call 则在模型响应之后执行，Retry 边界更清晰；仍需防止同一 `call_id` 被重复执行。

可采用：

- 请求级 Idempotency Key；
- Tool Call 去重表；
- 对外写操作的业务幂等键；
- 执行后重新读取真实状态；
- “未知是否成功”状态和人工对账路径。

Exactly-once 通常无法由单个客户端保证。更现实的目标是 At-least-once Delivery 加 Idempotent Effect，或明确的 Reconciliation。

## 本地容量控制

不要只依赖 Provider 返回 429。Host 可以提前进行：

- 按 Provider/Model/Tenant 的并发 Semaphore；
- Token Bucket 或 Leaky Bucket；
- 带 Deadline 和优先级的 Queue；
- Admission Control，拒绝不可能按时完成的请求；
- Circuit Breaker，避免持续攻击故障端点；
- Load Shedding，优先保留高价值任务。

长 Stream 会长时间占用并发槽，Tool 等待期间是否释放模型容量要单独设计。多 Agent 系统尤其需要全局预算，不能让每个子 Agent 都认为自己拥有完整配额。

## Codex 源码阅读路线

先打开 `codex-rs/model-provider-info/src/lib.rs`，阅读 Provider 的 `request_max_retries`、`stream_max_retries`、`stream_idle_timeout_ms` 及其有效值方法。再看 `to_api_provider`，注意请求层当前重试哪些 5xx 和 Transport 错误，以及 429 为什么没有在这一层盲目重试。

接着阅读 `codex-rs/codex-client/src/retry.rs`，理解底层 Transport Retry Policy 的输入和上限。然后转到 `codex-rs/core/src/responses_retry.rs` 的 `handle_retryable_response_stream_error`，观察 Stream Retry、退避、用户提示和 WebSocket 到 HTTPS 的降级顺序。

最后打开 `codex-rs/codex-api/src/sse/responses.rs`，看响应 Header 中的 Rate Limit Snapshot 如何变成统一事件；再阅读 `codex-rs/protocol/src/error.rs` 的 `UsageLimitReachedError`、`RetryLimitReachedError` 及错误到公开错误信息的映射。到错误分类完成处停止，不必追进所有前端文案。

## 本篇检查

1. 错误是否先分类再重试？
2. 429 是否保留限流维度、重置时间和作用域？
3. Request、Stream 和 Agent Retry 是否分别计数？
4. 多层 Retry Budget 是否会乘法放大？
5. 是否尊重 Retry-After，并加入 Jitter 和总等待上限？
6. 托管工具或外部写操作状态未知时，是否先对账？
7. 是否有本地并发、队列、熔断和降载机制？

---

[上一篇：Model Routing 与 Fallback](07-model-routing-fallback.md) · [返回学习地图](README.md) · [下一篇：完整案例、设计检查与练习](09-complete-case-and-checklist.md)
