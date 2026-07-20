# Completion 与 Failure Criteria

## 最后才宣布完成

回到“修改测试环境网站标题”的例子，只有在以下条件都满足后才能宣布 Complete：

```text
文件修改正确
    + 构建和相关测试通过
    + 目标 Deployment 使用当前 Commit
    + 页面实际显示“夏日促销”
    + 约定的页面健康检查通过
    + 如果 Success Criteria 要求人工验收，则已获得 Acceptance
    + 没有未对账的发布请求
        ↓
      Complete
```

如果发布请求仍然无法确认，对应的操作和 Criterion 应保持 `Unknown`，Task 则归约为 `Blocked / Waiting`。不能为了让流程结束而把它改写成 `Failed` 或 `Complete`。

## 完成是一次证据驱动的状态归约

Agent 不应在模型生成 Final Answer 时自动进入 Complete。更可靠的判定是：

```text
for every required criterion:
    resolve status from fresh evidence

check side effects and pending operations
check required human acceptance
check failure / cancel / deadline conditions
derive terminal or non-terminal state
```

Completion Verifier 的职责是把 Criterion 级结果归约成 Task 状态，同时保留为什么得出该状态。

## Criterion 状态与 Task 状态

Criterion 可以使用：

```text
Pass | Fail | Unknown | NotApplicable | Waived
```

Task 则可以区分：

| 状态 | 进入条件 |
| --- | --- |
| Complete | 所有必要 Criteria 为 Pass，或按规则合法 Waived；副作用已对账；必要 Acceptance 已获得 |
| Partial | 有可交付结果，但仍有明确未满足项；调用方允许部分交付 |
| Blocked / Waiting | 缺少用户输入、权限、依赖、外部事件或可获得的关键 Evidence |
| Failed | 必要 Criterion 已确定失败，且预算内没有合法恢复路径 |
| TimedOut | Deadline 到达；必须说明外部动作是否仍可能运行 |
| Cancelled / Interrupted | 收到取消或被替换；必须完成必要清理和状态保存 |
| Rejected | Policy 或授权明确禁止继续 |

不同产品可以使用不同枚举，但不能把这些语义全部压成 `success: true/false`。

## Failure Criteria 要提前定义

Failure Criteria 是触发停止或升级的明确条件，例如：

- 必要不变量已经被破坏；
- 关键测试稳定失败且无剩余修复路径；
- Policy 拒绝唯一可行动作；
- 证据表明目标本身不可同时满足；
- 重试、成本或 Deadline 预算耗尽；
- 副作用状态长期 Unknown，继续执行可能扩大损害；
- Critic–Revise 循环连续多轮没有新增 Evidence 或状态变化。

预先定义 Failure Criteria 能防止 Agent 因沉没成本无限循环，也能防止预算耗尽时把未完成包装成完成。

## Complete、Turn Complete 与 Process Exit 不同

```text
Process completed
    一个进程退出

Tool call completed
    一次调用进入协议终态

Turn completed
    本轮 Agent 交互结束

Task completed
    当前 Task 的必要 Criteria 已满足

Goal completed
    用户整体目标已经达到
```

下层终态可以触发上层检查，却不能自动证明上层完成。一个 Turn 可以正常结束并返回“我需要用户提供凭据”，此时 Turn 生命周期是 Completed，Task 却是 Blocked。

## Partial 与 Blocked 要提供可恢复信息

终态记录应包含：

```text
goal / task / terminal status
criterion results
evidence ids and verification methods
produced artifacts and versions
side effects: committed / compensated / unknown
checks not run and remaining risks
failure or blocking reason
completed and uncompleted work
safe resume point and required next input
usage / deadline / retry summary
```

这既是给用户的解释，也是 Resume、Audit 和 Evaluation 的输入。

## 防止误完成

进入 Complete 前至少检查：

1. Final Answer 是否只是声明，而非 Evidence；
2. 是否存在未结束的后台动作或 Pending Approval；
3. 所用 Evidence 是否绑定当前 Artifact 版本；
4. 必要检查是否被 Skip、截断或错误解释；
5. 是否有冲突 Evidence 或 Unknown 被隐藏；
6. 是否把用户 Acceptance、Waiver 或工具成功误写成 Criterion Pass；
7. 是否出现超范围副作用，即使主要结果正确。

## 失败也要验证

“我做不到”同样是一个 Claim。宣布 Failed 或 Blocked 前应证明：

- 缺少的资源或权限确实必要；
- 可用替代路径已经在授权范围内评估；
- 错误属于可重试、不可重试还是状态未知；
- 预算或 Deadline 的来源明确；
- 已产生的副作用得到保存、清理或对账。

不能因为第一次尝试失败就宣布任务失败，也不能在需要新权限时擅自扩展范围。

## Codex 源码阅读路线

先读 `codex-rs/protocol/src/protocol.rs` 中的 `TurnCompleteEvent`、`TurnAbortedEvent` 和 `TurnAbortReason`，理解 Core 事件如何表达 Turn 生命周期。再读 `codex-rs/app-server-protocol/src/protocol/v2/turn.rs` 的 `TurnStatus`，随后进入 `codex-rs/app-server/src/bespoke_event_handling.rs`，从 `TurnCompletionMetadata` 附近观察 Error 如何映射为 `Failed`、无 Error 如何映射为 `Completed`。

最后阅读 `codex-rs/app-server-protocol/src/protocol/thread_history_projection.rs`，看历史事件怎样投影为客户端可读状态。读完后应明确：这些类型可靠表达 Runtime / Turn 终态，但应用层仍需要自己的 Success Criteria、Evidence 与 Human Acceptance 才能证明用户 Goal 完成。

## 本篇检查

1. Criterion 与 Task 是否使用不同状态层级？
2. Complete 是否要求全部必要 Evidence、新鲜度和副作用状态明确？
3. Partial、Blocked、Failed、TimedOut、Cancelled、Rejected 是否可区分？
4. Failure Criteria 和无进展条件是否预先定义？
5. 终态是否包含恢复所需的未完成项与下一输入？
6. Runtime 完成是否被错误等同于用户 Goal 完成？

---

[上一篇：Human Acceptance](06-human-acceptance.md) · [返回学习地图](README.md) · [下一篇：完整案例、设计检查与练习](08-complete-case-and-checklist.md)
