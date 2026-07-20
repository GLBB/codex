# Human Acceptance

## 先区分“允许做”和“接受结果”

用户批准部署到 Staging，只表示 Agent 被允许执行部署；它不表示页面已经正确，也不表示用户已经接受最终结果。Acceptance 需要绑定具体版本、环境和验收标准。

## 人在环中有多种不同职责

| 机制 | 人在回答什么问题 | 发生阶段 |
| --- | --- | --- |
| Clarification | 目标、范围或偏好是什么？ | 规划前或证据不足时 |
| Approval | 这个动作是否允许执行？ | 高风险动作之前 |
| Steering | 是否调整当前方向或计划？ | 执行过程中 |
| Domain Review | 产物是否满足专业标准？ | 产物形成后 |
| Acceptance | 是否接受结果并结束任务或交付？ | 完成判定附近 |

Approval 不是 Acceptance。用户允许 Agent 发布消息，只说明动作被授权；消息内容是否达到沟通目标，仍需要验证或验收。反过来，用户喜欢一个方案也不能绕过必要的安全审批。

## 哪些条件适合人工验收

人工验收适用于机器难以完整表达的标准：

- 视觉、语气、品牌一致性和交互感受；
- 法律、医疗、财务等领域判断；
- 需求本身存在合理偏好空间；
- 高影响、不可逆或对外承诺；
- 多方利益权衡和例外处理；
- 机器证据冲突或仍为 Unknown。

人工验收不是自动验证缺失时的万能占位。类型、安全、权限、数据完整性等可自动检查的硬约束仍应先检查，避免把低质量或危险产物全部推给用户筛选。

## 提交可验收包

不要只问“可以吗？”。一个好的 Acceptance Package 应包含：

```text
requested goal and agreed scope
artifact or preview
changes made and side effects
criterion-by-criterion verification summary
evidence and citations
checks not run / unknown state / remaining risks
decision requested from the human
available revisions or rollback path
```

用户应该能看懂自己正在接受什么、哪些内容已经机器验证、哪些风险仍由人承担。

## Acceptance 状态应可追溯

人工决定至少记录：

- Actor 与授权身份；
- Artifact / Version / Hash；
- 接受的 Scope 和具体 Criteria；
- 决定：Accepted、Rejected、Changes Requested、Waived；
- 时间、理由和附加条件；
- 是否允许后续发布或关闭任务。

“用户之前说没问题”如果没有绑定当前版本，不能自动应用到修改后的产物。任何实质变更都可能使旧 Acceptance 失效。

## Waiver 不等于验证通过

用户或负责人可以在有权限时接受某项剩余风险，但记录应是：

```text
criterion = C7
verification = not_passed
disposition = waived_by_authorized_user
reason = ...
scope / expiry = ...
```

不能把它改写成 `C7 = pass`。强制安全、法律或平台策略也可能根本不允许 Waiver。

## 沉默、超时与代理身份

- 没有回复通常表示 Pending Acceptance，不是默认接受；
- 超时应进入 Wait / Timed Out，并保留产物和状态；
- 群聊中的任意成员不一定有验收权限；
- 代理审批人只能在委托 Scope 内决定；
- 多方验收要明确是任一人、全部人还是特定角色通过。

系统可以提醒或升级，但不能为了自动收尾而伪造接受。

## 验收后的变更

Acceptance 之后仍可能发生部署、格式转换或外部同步。这些动作会生成新副作用和新版本，应再次检查：

1. 最终发布物是否与已验收 Artifact 一致；
2. 发布动作是否获得独立 Approval；
3. 发布后的 Postconditions 是否成立；
4. 若发布改变用户可见内容，是否需要再次 Acceptance。

## Codex 对照阅读

Codex 当前最清晰的人机边界之一是 Approval。先从 `codex-rs/protocol/src/protocol.rs` 中的 `AskForApproval` 和相关审批事件理解协议，再读 `codex-rs/app-server/src/bespoke_event_handling.rs` 中命令执行审批的请求与响应映射。阅读时把它标注为“执行前授权”，不要把 `Approved` 误写成任务验收。

随后查看 `codex-rs/app-server-protocol/src/protocol/v2/turn.rs` 的 `TurnStatus` 和一条 `turn_interrupt` 集成测试，理解客户端可见的生命周期终态。Codex 的通用人工 Acceptance 更多由上层产品交互和用户回复表达；这正说明协议生命周期完成与用户接受结果需要分层建模。

## 本篇检查

1. Clarification、Approval、Review 和 Acceptance 是否分开？
2. 人工验收是否只用于真正需要主观或领域判断的标准？
3. Acceptance Package 是否包含产物、证据、未知项和剩余风险？
4. 决定是否绑定具体 Actor、Artifact Version 和 Scope？
5. Waiver 是否与 Pass 分开记录？
6. 沉默和超时是否保持 Pending，而非自动接受？

---

[上一篇：Side-Effect Reconciliation](05-side-effect-reconciliation.md) · [返回学习地图](README.md) · [下一篇：Completion 与 Failure Criteria](07-completion-and-failure-criteria.md)
