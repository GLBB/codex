# 完整案例、设计检查与练习

## 案例：修复并发布重复 Webhook 问题

用户要求 Agent 修复订单服务重复发送 Webhook 的问题。Agent 可以修改代码和运行测试，但发布到 Staging 需要 Approval；生产发布由值班工程师执行并验收。此前一次 Staging 发布请求曾超时，是否已经生效未知。

这个案例故意包含四类容易误判的“成功”：代码已写入、测试通过、发布 API 返回、用户接受结果。它们分别属于动作、产物、外部副作用和任务层级。

## 第一步：建立 Criteria 与 Verification Matrix

Goal 是“同一订单状态变化只产生一次业务 Webhook，并且重复投递可以安全恢复”。Agent 与用户确认范围后形成：

| ID | Success Criterion | Verification | Required Evidence |
| --- | --- | --- | --- |
| C1 | 重复请求不产生第二个业务效果 | 幂等性集成测试 | 同一 Key 的两次请求与一次外部记录 |
| C2 | 正常首次投递行为不变 | 回归测试 | 现有用例和新增用例结果 |
| C3 | 并发请求不会绕过去重 | 并发集成测试 | 目标服务记录、稳定业务 ID |
| C4 | 代码满足仓库类型与静态规则 | Type Check / Lint | 命令、版本、退出状态 |
| C5 | Staging 运行目标版本 | 部署状态与 Commit 查询 | Deployment ID、Commit、环境 |
| C6 | 超时发布没有造成重复 Deployment | Reconciliation | 本地 Ledger 与平台状态 |
| C7 | 值班工程师接受 Staging 行为 | Human Acceptance | Actor、版本、决定和时间 |

Failure Criteria 包括：无法建立稳定 Idempotency Key；测试显示并发下仍重复；部署状态长期 Unknown 且再次发布可能扩大影响；必要权限或发布窗口失效。

## 第二步：动作前契约

修改代码前，Agent 检查当前分支、Workspace、文件版本和用户允许的范围。写补丁的 Preconditions 是目标文件仍与读取版本一致、Diff 只涉及幂等逻辑和测试；Postconditions 是文件可解析、预期逻辑出现、无意外文件变化。

这些条件通过只说明补丁动作成功。C1 到 C4 仍需独立检查。

## 第三步：Tests、Assertions 与 Critic

Agent 先运行相关测试。新增用例第一次只检查两个响应都是 200，Critic 指出它没有断言实际 Webhook 次数，因此不能证明 C1。修订后，测试对同一 Idempotency Key 发起两次调用，并比较完整的外部记录集合。

并发测试失败，说明当前实现采用“先查询、再写入”，存在 TOCTOU。Agent 根据失败 Evidence 调整实现为目标存储中的唯一约束与原子写入，再运行：

```text
focused idempotency tests
concurrency integration test
affected service test suite
type check / lint
```

Verifier 将每个结果绑定到当前 Commit 和测试环境。它不会用串行测试通过替代 C3，也不会把 Lint 通过解释为业务修复成功。

## 第四步：构造 Claim 与 Evidence

Agent 准备修复说明时建立映射：

```text
Claim: 重复请求只产生一次业务效果
  ├── E1: integration test case + run artifact
  └── E2: test database record set

Claim: 并发请求受原子约束保护
  ├── E3: unique constraint / transaction diff location
  └── E4: concurrency test artifact
```

代码位置 Citation 说明机制，测试与数据库状态 Evidence 说明观察到的行为。只引用实现代码不能证明运行结果，只引用测试绿色也不解释为何修复成立。

## 第五步：发布超时后的 Reconciliation

Agent 获得 Staging Approval 后，以稳定 Idempotency Key 发起发布。连接在平台返回前断开，本地记录为 `Unknown`。此时 Agent 不再提交第二次发布，而是：

1. 从 Ledger 取得 Deployment Request ID、Commit 和环境；
2. 查询平台的 Deployment 列表；
3. 找到同一 Request ID 已部署且健康检查完成；
4. 比较实际 Commit 与预期 Commit；
5. 将本地调用补记为 `Succeeded`；
6. 验证没有第二个同 Key Deployment。

这些 Evidence 同时满足 C5 与 C6。若平台没有查询接口且状态仍 Unknown，正确状态是 Blocked，而不是假定发布失败后重试。

## 第六步：人工验收

Agent 提交给值班工程师的 Acceptance Package 包含：

- Staging Deployment、Commit 与测试环境；
- C1–C6 的状态和 Evidence；
- 可复现步骤与业务记录；
- 尚未执行生产发布；
- Rollback 路径和剩余风险；
- 请求对 C7 作出 Accepted、Rejected 或 Changes Requested 决定。

值班工程师在目标版本上完成一次代表性业务验证并 Accepted。该决定绑定当前 Deployment，而不是以后任何版本。Staging Approval 只授权部署动作，不能代替这次 Acceptance。

## 第七步：完成归约

Completion Verifier 最终得到：

| Criterion | Status | Evidence |
| --- | --- | --- |
| C1 | Pass | E1、E2 |
| C2 | Pass | 回归测试 Artifact |
| C3 | Pass | E3、E4 |
| C4 | Pass | Type Check、Lint Artifact |
| C5 | Pass | Deployment ID、Commit、健康状态 |
| C6 | Pass | Ledger 与平台状态对账 |
| C7 | Pass | 值班工程师 Acceptance Record |

所有必要标准通过，副作用已对账，没有 Pending 动作，Agent 才把“修复并完成 Staging 验证”的 Task 标为 Complete。生产发布不在已同意 Scope 内，因此记录为未执行的后续工作，而不是隐含包含在本次完成声明中。

## 三条链复盘

```text
执行链
Goal → Patch → Tests → Deploy → Reconcile → Acceptance → Complete

数据链
Source / Commit → Test Artifacts → Deployment State
                → Evidence Records → Completion Record

信任链
User Scope → Workspace Policy → Staging Approval
           → Deployment Identity → Human Acceptance → Audit
```

Verification 同时消费三条链：没有执行链就没有结果，没有数据链就无法证明，没有信任链就不能确认结果是在合法身份和范围内产生的。

## 设计检查表

### Criteria 与契约

1. Goal 是否拆成必要、可选和不可违反的 Criteria？
2. 每个 Criterion 是否有验证方法、Evidence 类型和失败表达？
3. Preconditions 是否在真正执行边界检查？
4. Postconditions 是否读取真实状态，而不是复述工具返回？
5. Action、Task 和 Goal 的条件是否分层？

### 自动化检查

6. Schema、Type Check、Assertion、Unit、Integration 和 E2E 各自证明什么？
7. 检查范围是否覆盖实际影响面、平台和异常路径？
8. 测试是否比较真实不变量、完整对象或调用轨迹？
9. Flaky、Skipped、Cached 和未运行是否如实记录？
10. Evidence 是否绑定当前代码、环境和工具版本？

### Evidence 与判定者

11. 每个重要 Claim 是否有可定位 Evidence 和 Citation？
12. Provenance、Freshness、Scope、冲突和反证是否保留？
13. Critic 是否提出具体缺陷或新验证步骤？
14. Verifier 是否能返回 Pass、Fail、Unknown 和 NotApplicable？
15. Evaluator 是否跨任务衡量误完成、成本和 Regression？

### 副作用与人机边界

16. 响应丢失后能否区分未执行、已执行、部分执行和 Unknown？
17. 是否有 Call ID、Idempotency Key、External Operation ID 和 Ledger？
18. 重试、Roll Forward 和 Compensation 是否各有条件？
19. Clarification、Approval、Review、Waiver 与 Acceptance 是否分开？
20. Acceptance 是否绑定 Actor、Artifact Version、Scope 和时间？

### 终态

21. Complete 是否要求全部必要 Criteria 和副作用状态明确？
22. Partial、Blocked、Failed、TimedOut、Cancelled 和 Rejected 是否可区分？
23. Failure Criteria、Budget 和无进展停止条件是否明确？
24. 终态是否保存 Evidence、Artifact、未完成项、剩余风险和恢复入口？
25. Turn / Tool / Process 完成是否与用户 Goal 完成分开？

## 练习

### 练习一：建立 Verification Matrix

为“根据内部资料生成一份季度分析”写出五项 Success Criteria。分别指定自动检查、Citation 检查和人工验收，并说明哪些标准不能由 LLM Judge 单独判定。

### 练习二：设计动作契约

选择“修改配置”“创建日程”或“发送消息”之一，列出结构、语义、权限、状态和并发五类 Preconditions，再写出可观察的 Postconditions。

### 练习三：审计一个绿色测试

找一个只断言退出码或非空文本的测试。说明它实际证明了什么、遗漏了哪个业务不变量，并改写为完整对象、状态或协议轨迹断言。

### 练习四：构造 Evidence Graph

为三个重要 Claim 建立 `Claim → Evidence → Source` 映射，加入一条冲突 Evidence。决定继续查询、降低 Claim 强度还是返回 Unknown，并说明理由。

### 练习五：恢复未知副作用

分别为“Git Push 响应丢失”“付款 API 超时”“消息发送超时”设计 Reconciliation。明确稳定身份、查询路径、可否重试和 Compensation 的真实含义。

### 练习六：设计终态归约器

输入一组包含 Pass、Fail、Unknown、Waived 的 Criterion 结果，再加入 Deadline、Pending Approval 和 Running Side Effect。写出 Complete、Partial、Blocked、Failed、TimedOut 的归约优先级。

## 源码综合阅读路线

第一遍沿单次动作与 Observation 阅读：从 `codex-rs/core/src/tools/handlers/apply_patch.rs` 的参数验证和执行开始，经 `codex-rs/core/src/tools/registry.rs` 的 Handler 外围，回到 `codex-rs/core/src/session/turn.rs` 的 Tool Output 与下一轮决策。停下来画出 Precondition、Action、Observation 和可能的 Postcondition，不要先追所有工具实现。

第二遍沿 Artifact 与 Critic 阅读：查看 `codex-rs/core/src/turn_diff_tracker.rs` 如何形成 Diff Artifact，再进入 `codex-rs/protocol/src/review_format.rs` 与 `codex-rs/core/src/tasks/review.rs`，理解 Review Finding 的结构和生命周期。此时标出哪些内容是 Critique，哪些才可能成为独立 Evidence。

第三遍沿终态阅读：从 `codex-rs/protocol/src/protocol.rs` 的 `TurnCompleteEvent` 与 `TurnAbortedEvent`，进入 `codex-rs/app-server/src/bespoke_event_handling.rs` 的终态映射，再到 `codex-rs/app-server-protocol/src/protocol/v2/turn.rs` 和 `thread_history_projection.rs`。最后对照本案例说明为什么 Runtime 的 Turn Status 仍不足以替代应用层 Completion Record。

---

[上一篇：Completion 与 Failure Criteria](07-completion-and-failure-criteria.md) · [返回学习地图](README.md)
