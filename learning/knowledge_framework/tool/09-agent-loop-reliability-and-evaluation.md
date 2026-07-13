# Agent Tool Loop、可靠性与评估

## 为什么 Runtime 之外还需要 Tool Loop

Runtime 负责正确执行单次调用，Agent Tool Loop 负责把多次模型决策和 Observation 组织成有终点的任务：

```text
Task / Current State
    ↓
Model decides: answer or call tools
    ↓ call
Catalog / Policy / Runtime
    ↓ observation
Update state and budgets
    ↓
Continue / Repair / Ask User / Stop
```

工具系统即使每次调用都正确，也可能因为模型反复搜索、重复写入、错误并行或无法识别完成状态而整体失败。因此要分别评价“单次调用正确性”和“循环策略正确性”。

## Tool Selection 与停止条件

模型决策至少包含：

1. 当前信息是否足够直接回答；
2. 需要哪种能力，候选工具是否可见；
3. 多个调用是否存在数据依赖；
4. 参数能否从当前上下文可靠构造；
5. Observation 是否完成目标、需要修复参数或需要询问用户；
6. 是否已经触及安全、时间、次数、成本或上下文预算。

Provider 的 `tool_choice` 只表达本轮调用约束：

- `none`：本轮禁止工具；
- `auto`：模型可以回答或调用；
- `required`：必须产生某种 Tool Call；
- specific tool：限制为指定工具或能力。

它不能替代 Agent 级停止条件。Host 仍应设置：

- 每个 Response 的最大 Tool Call 数；
- 每个 Turn 的累计调用数；
- Wall-clock Deadline；
- 连续失败或重复调用阈值；
- Token、Output Byte 和外部 API Cost 上限；
- 用户取消和 Policy Reject 后的停止规则。

当模型连续使用相同参数调用同一工具、Observation 没有新增信息或错误类别没有变化时，应识别为 Tool Thrashing。系统可以要求模型重新规划、切换工具、询问用户或终止，而不是继续消耗预算。

## 顺序、并行与 Programmatic Tool Calling

两个调用只有在没有数据依赖且 Runtime 均允许时才能并行：

```text
search_code ─┐
             ├─ independent → may run concurrently
read_config ─┘

create_file → git_add → git_commit
             dependent → must remain ordered
```

要同时通过两层判断：

1. 模型协议是否允许一次产生多个调用；
2. 每个 Executor 及其目标资源是否支持并发。

Programmatic Tool Calling 或 Code Mode 让模型生成一段受控程序来组合多个工具，适合循环、过滤和数据变换。它减少模型与 Provider 的往返，但扩大单次执行面，因此需要：

- 只暴露允许嵌套调用的工具；
- 限制代码运行时间、内存和调用次数；
- 保持每个嵌套调用的 Policy、Telemetry 和 Output Budget；
- 防止程序绕过 Direct-only、Approval 或 Namespace 边界；
- 明确中间 Observation 是进入程序局部状态还是模型全局上下文。

## 参数修复与错误反馈

可恢复错误应提供足够信息让模型改变下一步，但不要泄露内部敏感细节：

| 错误 | 反馈给模型 | 下一步 |
| --- | --- | --- |
| Schema / Parse Error | 哪个字段缺失或类型错误 | 修复参数后重试 |
| Semantic Error | 路径越界、资源不存在、状态不满足 | 改用合法目标或询问用户 |
| Policy Reject | 未执行及拒绝原因类别 | 不得假装成功，可选择安全替代方案 |
| Timeout / Cancel | 是否可能已有部分副作用 | 查询状态、补偿或停止 |
| Rate Limit / Transient Failure | 可重试性和 Retry-After | 在预算内退避重试 |
| Fatal Runtime Error | 有界诊断和 Trace ID | 中止 Turn 并保留审计信息 |

模型可理解不等于把原始堆栈、Token 或服务端响应全部放入上下文。内部诊断与 Model Output 应是不同视图。

## 执行语义与故障恢复

跨进程或外部服务调用不能默认实现 Exactly-once：

- **At-most-once**：不重复执行，但失败时可能没有结果；
- **At-least-once**：保证尝试完成，但可能重复副作用；
- **Effectively-once**：借助幂等键、去重记录和状态核对，让业务效果等价于一次。

最危险的情况是“服务端已经执行，客户端在收到响应前断开”。此时不能仅因没有 Tool Output 就重新执行写操作。恢复策略应按顺序检查：

1. 调用是否有稳定 `call_id`、Invocation ID 或幂等键；
2. 是否能查询外部操作状态；
3. 是否存在持久化的 Call Ledger；
4. 重试会不会产生重复订单、消息、提交或审批；
5. 无法确认时是否需要用户决策或补偿动作。

建议持久化的最小调用记录包括：

```text
thread_id / turn_id / call_id
tool identity and source
normalized argument digest
approval decision and scope
started_at / terminal_at
execution status
external operation id or idempotency key
bounded result reference
```

恢复 Session 时，要识别 Pending、Running、Completed-without-observation 和 Aborted-but-still-running 等状态。不能简单把所有非 Completed 调用都再次分发。

## 资源治理与背压

Tool Budget 应是分层的：

| 预算 | 典型边界 |
| --- | --- |
| Call Budget | 单次 Response、Turn、Session 的最大调用数 |
| Time Budget | Queue Timeout、Tool Timeout、Turn Deadline |
| Concurrency Budget | 全局、每 Provider、每 Server、每资源的并发数 |
| Output Budget | 原始字节、模型 Token、展示行数、分页大小 |
| Cost Budget | Hosted Search、Browser、API、子 Agent 的费用 |
| Retry Budget | 最大次数、指数退避、累计等待时间 |

当下游达到 Rate Limit、连接池或并发上限时，Runtime 应排队、拒绝或降级，并把排队时间与执行时间分开记录。持续失败的远端服务可以使用 Circuit Breaker，避免每个模型 Turn 都重复触发相同故障。

预算耗尽是一种正常终态，不应伪装成工具成功。模型需要知道哪些动作未执行，用户界面需要知道限制来自哪一层。

## 可观测性

一次调用应能通过 `thread_id → turn_id → call_id → external_operation_id` 关联模型、Policy、Runtime 和外部系统。建议至少记录：

- Tool Name、Namespace、来源和 Exposure；
- Provider Response Item ID 与 `call_id`；
- Queue、Approval、Execution、Teardown 的分段耗时；
- Outcome：Completed、Failed、Rejected、TimedOut、Aborted；
- Error Category 和 Retry Count；
- 输入与输出大小、截断状态；
- Sandbox、Network、Credential Policy 结果；
- Hosted Tool、API 和 Token 成本；
- 参数和结果的脱敏摘要，而不是完整敏感内容。

核心指标可以包括：

```text
tool_call_success_rate
tool_call_latency{queue,approval,execution}
tool_error_rate{category}
tool_retry_rate
tool_rejection_rate
tool_output_truncation_rate
orphan_call_count
duplicate_effect_count
calls_per_successful_turn
```

日志用于诊断单次事件，Metric 用于发现趋势，Trace 用于还原跨模型和外部系统的调用链；三者不能相互替代。

## 测试金字塔

| 层级 | 主要验证内容 |
| --- | --- |
| Contract Test | ToolSpec 序列化、Schema、Strictness、Provider Wire Shape |
| Handler Test | 参数解析、语义验证、错误分类、输出结构 |
| Policy Test | Metadata、Approval Mode、Sandbox 和网络规则组合 |
| Runtime Test | 路由、并发锁、Timeout、Cancel、进程与连接清理 |
| Protocol Integration Test | Provider Tool Call、流式 Delta、Call/Output 配对 |
| External Integration Test | MCP、Database、SaaS 的认证、限流和故障行为 |
| Recovery Test | 响应丢失、进程崩溃、Resume、幂等与孤儿清理 |
| Adversarial Test | Prompt Injection、SSRF、数据外传、恶意 Schema 和 Approval 绕过 |

测试 Tool Loop 时，不只断言最终文本，还应断言完整调用轨迹：发送了哪些 Specs、模型产生什么 Call、Policy 是否执行、外部动作发生几次、Output 是否按同一 `call_id` 回写。

## Evaluation

测试验证已知行为，Eval 衡量模型在任务分布上的工具使用质量。建议跟踪：

- Tool Selection Precision / Recall；
- 参数字段准确率与首次调用成功率；
- 不必要调用率和重复调用率；
- 正确并行率与错误并行率；
- 从可恢复错误中修复的比例；
- 完成任务所需调用数、时间和成本；
- Policy Violation Attempt Rate；
- 外部恶意内容下的数据外传率；
- 最终任务成功率与人工介入率。

Eval 样本应包含相似工具、缺失工具、未认证工具、动态工具、长输出、部分失败、用户取消和恶意 Observation。只用“正常天气查询”无法评价生产 Agent 的 Tool 系统。

## Codex 跟读入口

完成概念学习后，可以按以下关系进入源码：

1. `codex-rs/core/src/session/turn.rs`：Turn 如何构建 Prompt 并推进模型与工具循环；
2. `codex-rs/core/src/client.rs`：每一轮 Provider Request 如何构造；
3. `codex-rs/core/src/tools/parallel.rs`：并发门、取消和终态输出；
4. `codex-rs/core/src/tools/registry.rs`：Handler、Hook、Telemetry 和错误边界；
5. `codex-rs/core/src/context_manager/history.rs`：Tool Output 进入历史后的规范化和预算控制；
6. `codex-rs/core/tests/suite/`：端到端 Agent 行为与 Provider Mock；
7. `codex-rs/app-server/tests/suite/`：公开 App Server API 上的工具行为。

先沿一个 Function Tool 完成完整闭环，再分别研究 Shell Process、MCP 和 Hosted Tool；不要从所有测试目录同时展开。

## 验收问题

1. `tool_choice` 为什么不能代替 Agent 级停止条件？
2. 模型允许并行与 Runtime 允许并发为什么是两层判断？
3. 响应丢失后，为什么写工具不能直接重试？
4. 一个可恢复错误应向模型暴露哪些信息，又应隐藏哪些信息？
5. 如何识别 Tool Thrashing？
6. Call、Time、Concurrency、Output、Cost 和 Retry Budget 如何共同限制一次 Turn？
7. Contract Test、Integration Test 和 Eval 分别发现哪类问题？
8. 如何证明一次 Resume 没有制造重复外部副作用？
