# Side-Effect Reconciliation

## 先看一个超时请求

部署请求发出后，客户端在收到平台确认前超时。此时最准确的结论不是“部署失败”，而是“部署状态未知”。平台可能已经部署成功，立即重试可能产生第二个 Deployment。

```text
Unknown
    ↓ 查询 Request ID / Deployment ID
确认已部署 → Succeeded
确认 Running → 等待或轮询
确认 NotStarted / FailedNoEffect → 在条件允许时重试
无法权威确认 → 保持 Unknown，阻塞任务或请求人工决策
```

“查询不到 Deployment”不等于“确认没有部署”：目标平台可能仍在处理，查询结果也可能尚未一致。只有权威状态确认请求未开始、失败且无副作用，或者目标服务能用同一 Idempotency Key 保证重试不会扩大效果时，才可以重试。

## 最危险的不是明确失败，而是结果未知

外部写操作通常跨越 Agent、Tool Runtime 和目标服务。调用方超时，不代表目标端没有执行：

```text
Agent ── request ──> Tool / External Service
                        │
                        ├── side effect committed
                        │
Agent <── connection lost before acknowledgement
```

此时重新执行可能造成重复消息、订单、提交、付款或资源。把 `timeout` 直接映射为“未执行”，是 Agent 可靠性设计中最危险的错误之一。

Reconciliation 的目标不是盲目重试，而是把本地意图、调用记录与外部真实状态重新对齐。

## 先区分执行状态

| 状态 | 含义 | 安全下一步 |
| --- | --- | --- |
| NotStarted | 确认请求未到达执行边界 | 可在预算内执行 |
| Running | 已开始，尚未进入终态 | 等待、轮询或取消 |
| Succeeded | 副作用已提交且可核对 | 写回 Observation，检查 Postconditions |
| FailedNoEffect | 明确失败且无副作用 | 修复原因后可重试 |
| PartiallyApplied | 只完成部分效果 | 完成剩余步骤或补偿 |
| Unknown | 无法判断是否执行 | 查询、对账或请求人工决策 |
| Compensated | 原效果已通过补偿处理 | 验证补偿后的业务状态 |

`Unknown` 不能被压缩成普通 `Failed`。它会影响重试权限、用户提示、终态和审计。

## Reconciliation 依赖稳定身份

建议为每次有副作用的调用持久化：

```text
thread_id / turn_id / task_id / call_id
tool identity + normalized arguments digest
idempotency key / external operation id
approval scope and actor
started_at / last_observed_at / terminal_at
local execution state
external state and version
result or artifact reference
compensation state
```

稳定 `call_id` 负责协议配对，Idempotency Key 让目标服务识别重复业务请求，External Operation ID 用于查询目标状态。三者相关但不相同。

## 对账顺序

恢复或超时后可以按以下顺序处理：

1. 冻结相同业务动作的自动重试；
2. 从持久化 Ledger 读取调用身份、参数摘要和最后状态；
3. 使用 External Operation ID、Idempotency Key 或业务唯一键查询目标系统；
4. 比较目标状态与期望 Postconditions；
5. 若已经完成，补写本地 Observation，不重复执行；
6. 若明确未执行，才在原授权与预算仍有效时重试；
7. 若部分完成，选择 Roll Forward 或 Compensation；
8. 若仍 Unknown，进入阻塞或人工处理，而不是声明成功或失败无副作用。

查询本身也必须按正确身份、租户和资源范围执行，否则会用另一个对象的状态“证明”当前调用完成。

## Idempotency 与 Compensation

- **Idempotency**：重复提交同一业务意图，最终效果等价于一次；
- **Deduplication**：服务识别并拒绝重复请求；
- **Compensation**：用新的业务动作抵消已经发生的动作；
- **Rollback**：在同一事务边界内恢复原状态。

补偿不是时间倒流。撤回消息可能留下通知记录，退款也不同于付款从未发生。Verifier 必须检查补偿后的业务可接受状态，并保留原动作与补偿动作的审计链。

## 本地副作用同样需要对账

文件、进程和 Git 也会出现部分状态：

- 补丁只应用了部分 Hunk；
- 命令被取消后子进程仍在运行；
- 文件写入成功但测试响应丢失；
- Commit 已创建但 Push 结果未知；
- 临时文件或锁没有清理。

恢复时应重新读取 Git、文件系统和进程真实状态，不能仅依赖最后一条 History。对于不可逆删除，执行前的 Precondition、审批和可恢复备份比事后补偿更重要。

## Codex 源码阅读路线

先读 `codex-rs/core/src/tools/handlers/unified_exec/write_stdin.rs` 中对交互进程完成的处理，观察后续 Poll 如何为原始执行调用带回最终完成状态。再看相邻的 `unified_exec_tests.rs`，理解测试为什么要校验原始 Call ID 与完成 Payload 的关联。

随后阅读 `codex-rs/core/src/tools/handlers/request_plugin_install.rs` 中的 `verify_request_plugin_install_completed`。这里适合观察“发起动作”和“确认安装完成”为什么是两个阶段。最后回到 `codex-rs/core/src/session/rollout_reconstruction_tests.rs`，选择一个恢复场景理解 History 重建；读到能画出 Pending、Completion 与恢复关系即可，不必横向展开所有 Session 测试。

## 本篇检查

1. Timeout、Disconnect 和 Cancel 后是否保留 `Unknown` 状态？
2. 写操作是否有稳定调用身份、幂等键和外部操作 ID？
3. 重试前是否重新查询真实状态？
4. 部分成功是否有 Roll Forward 或 Compensation 方案？
5. 补偿本身是否经过权限检查与 Postcondition 验证？
6. 恢复流程能否证明没有制造重复副作用？

---

[上一篇：Critic、Verifier 与 Evaluator](04-critic-verifier-and-evaluator.md) · [返回学习地图](README.md) · [下一篇：Human Acceptance](06-human-acceptance.md)
