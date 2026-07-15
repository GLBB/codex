# 状态转移、恢复与终止

## 每一轮都必须有明确去向

Agent Loop 处理完一次决策或 Observation 后，必须选择显式状态转移：

| 转移 | 适用条件 | 关键要求 |
| --- | --- | --- |
| Continue | 尚未满足成功标准，且存在可执行下一步 | 更新 Plan、Progress 和剩余 Budget |
| Complete | 所有必要成功标准已有 Evidence | 返回结果及必要证据 |
| Wait for User | 缺少只有用户能决定或提供的信息 | 保存问题、上下文和恢复点 |
| Wait for Approval | 动作已准备好，但需要授权 | 绑定具体动作、参数和授权范围 |
| Wait for Event | 必须等待外部任务、时间或事件 | 保存订阅、轮询或恢复信息 |
| Retry | 错误可恢复且重试安全 | 限制次数、退避和总 Deadline |
| Recover | 进程或 Session 中断后继续 | 先核对已发生动作，避免重复副作用 |
| Compensate | 需要撤销或抵消已发生的副作用 | 记录补偿结果和剩余风险 |
| Timeout | 超过 Deadline | 停止等待，核对可能已发生的副作用 |
| Cancel | 用户或上层系统要求停止 | 传播取消并清理可控资源 |
| Reject | Policy、Permission 或 Approval 不允许 | 明确动作未执行，不得假装成功 |
| Fail | 当前策略下无法恢复 | 保存诊断、已完成部分和副作用状态 |

## Terminal State 与非终态

Continue、Wait、Retry、Recover 和 Compensate 都是非终态：系统仍有下一步，或存在明确的恢复与唤醒条件。

常见终态至少包括：

```text
Complete   已有证据满足成功标准
Cancelled  用户或上层系统主动取消
Rejected   整个任务因策略或权限无法继续
TimedOut   超过期限，副作用状态已经记录或待核对
Failed     出现当前策略下不可恢复的错误
```

Terminal State 应包含结果、原因、Evidence、已完成部分、未执行部分、用量和副作用状态，便于用户理解，也支持后续恢复或审计。

## Continue 与 Complete

Continue 需要同时满足两个条件：任务尚未完成，并且仍存在合理的下一步。如果没有新信息、相同调用不断重复或错误类别始终不变，继续循环只是在消耗预算。

Complete 必须由 Evidence 支持全部必要 Success Criteria。以下情况都不能进入 Complete：

- 只完成了主要步骤，但验证尚未运行；
- 模型给出答案，却没有核对真实状态；
- 部分成功被包装成全部成功；
- 为了赶上 Deadline 临时降低验收标准；
- 外部写操作的最终状态仍不确定。

## 三种 Wait

### Wait for User

用于缺少只有用户才能提供的关键选择、输入或验收。等待前应保存：问题是什么、为什么需要、可选范围、已经完成的工作，以及收到回答后从哪里继续。

### Wait for Approval

Approval 必须绑定具体动作及其参数、资源和范围。用户批准“修改这个文件”，不应被解释成批准修改整个工作区或进行任意联网操作。

### Wait for Event

适用于异步任务、外部构建、定时条件或消息事件。系统应明确由订阅、回调还是轮询唤醒，并给等待设置 Deadline，避免永久悬挂。

Wait 是可恢复的暂停状态，不是成功或失败。

## Retry：错误可恢复还不够

Retry 至少要检查：

1. 错误是否属于瞬时错误；
2. 相同参数再次执行是否安全；
3. 是否存在幂等键或去重记录；
4. Retry Budget 和总 Deadline 是否允许；
5. 退避后是否有机会得到不同结果；
6. 当前 Observation 是否已经表明部分副作用发生。

Schema 错误通常应先修复参数，而不是原样重试。Policy Reject 通常不能通过重试绕过。响应丢失后的写操作则必须先查询外部状态。

## Recover：先对账，再继续

中断后，调用可能处于以下任一状态：

```text
NotDispatched
Queued
Running
CompletedWithoutObservation
AbortedButStillRunning
Failed
```

这些状态分别可能表示：调用尚未发送、已经发送但尚未开始、正在执行、已产生副作用但 Observation 尚未写回，或者本地已经取消但远端仍在运行。不能仅凭“本地未完成”推断外部动作没有发生。

Recover 应按顺序处理：

1. 加载最近一致 Checkpoint；
2. 查询调用账本中的 `call_id` 和参数摘要；
3. 通过外部操作 ID 或幂等键核对真实业务状态；
4. 修正本地 State 与外部状态的差异；
5. 再决定接受既有结果、Retry、Compensate、等待或 Fail。

不能把所有非 Completed 调用直接再次分发。

## Compensate 不是时间倒流

某些副作用无法真正撤销，只能用另一个动作抵消。例如：

- 创建订单后发起取消；
- 发送错误消息后发送更正；
- 修改配置后写回旧版本；
- 创建临时资源后执行清理。

补偿本身也是有风险的动作，需要 Policy、Approval、Runtime 和验证。系统必须记录补偿是否成功，以及是否仍有费用、通知、日志或不可逆影响。

## Timeout 的不确定性

Timeout 只表示调用方没有在规定时间内得到终态，不表示下游没有执行。外部服务可能已经完成写入，只是响应未能及时返回。

因此超时后应区分：

```text
Timed out before dispatch
    可以确认动作未执行

Timed out while queued
    需要确认是否已经开始

Timed out while running
    可能已有部分或完整副作用

Timed out after remote completion
    结果丢失，需要外部状态核对
```

停止等待不等于撤销动作。

## Cancel 的传播

取消信号应从 Task 或 Turn 传播到：

- 待发送的模型请求；
- 排队和运行中的工具调用；
- 子进程、后台任务和远程执行器；
- 子 Agent 或被委派任务；
- 等待中的审批或事件订阅。

取消后还要清理可控资源并保存已发生副作用。无法取消的外部动作应标记为待核对，而不是从 State 中删除。

## Reject 与 Fail

Reject 表示策略或权限不允许某项动作，重点是“未获授权”。Fail 表示当前策略下没有可恢复路径，重点是“无法继续”。

一次动作被 Reject 后，Agent 可以选择安全替代方案或请求用户调整目标；若没有替代方案，Task 才可能最终 Fail。无论哪种情况，都不得声称被拒绝的动作已经执行。

## 防止无效循环

出现以下信号时，应重新规划、询问用户或终止：

- 相同工具和参数连续调用；
- Observation 没有新增信息；
- 错误类别和条件没有变化；
- Plan 在几个状态间反复切换；
- 剩余 Budget 不足以完成验证；
- 继续动作不能推进任何 Success Criteria。

模型协议中的 `tool_choice` 只能约束一次模型响应，不能代替 Agent 级 Budget、Deadline、重复阈值和停止规则。

## 本篇检查

1. 每个非终态是否都有明确的下一步和唤醒条件？
2. Complete 是否由 Success Criteria 和 Evidence 驱动？
3. Retry 是否同时检查错误类型、幂等性和预算？
4. Recover 是否先核对外部副作用？
5. Timeout、Cancel、Reject 和 Fail 是否明确区分？
6. Compensation 是否也经过授权和验证？
7. 系统如何发现并终止无效循环？

---

[上一篇：Agent Loop：从输入到状态更新](04-agent-loop.md) · [下一篇：完整案例：修复大文件上传问题](06-complete-case.md)
