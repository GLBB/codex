# Task、Subtask、依赖、Plan 与 Progress

## 从 Goal 到可执行工作

Goal 说明期望结果，Task 把结果转成可以创建、分配、执行和跟踪的工作单元。

```text
Goal
    修复大文件上传的内存问题
        ↓
Task
    完成定位、设计、实现和验证
        ↓
Subtask
    A. 定位内存增长点
    B. 设计有界读取方案
    C. 实现修改
    D. 添加回归测试
    E. 验证完成条件
```

Task 不等于一次模型调用，也不必等于一个 Turn。一个 Task 可能跨越多次模型调用、多个工具动作和多次等待；一个 Turn 也可能推进多个相关 Subtask。

## 什么是一个可跟踪的 Task

一个 Task 通常需要这些信息：

```text
Task ID / Parent Task
Goal / Expected Outcome
Status
Dependencies
Inputs / Constraints
Owner / Executor
Budget / Deadline
Expected Artifact / Evidence
Failure / Completion Criteria
```

不是所有系统都要持久化每个字段，但影响调度、恢复和验收的事实不能只存在于模型的临时推理中。

## Subtask 如何拆分

好的拆分应让每个 Subtask：

- 产生清晰的中间结果；
- 有可判断的完成状态；
- 与其他步骤的依赖明确；
- 可以在合适的权限和预算中执行；
- 失败时不会让整个流程处于不可解释状态。

不要为了形式而拆得过细。若一个步骤没有独立产物、不能单独调度，也不会改善验证或恢复，它可能只是一项普通动作，而不是 Subtask。

## Dependency 决定执行顺序

```text
A. 定位问题
        ↓
B. 设计方案
      ↙   ↘
C. 实现   D. 编写测试
      ↘   ↙
E. 运行验证
```

依赖关系用于判断：

- 哪些 Subtask 已经具备执行条件；
- 哪些可以并行；
- 上游失败后哪些下游应取消或重新规划；
- 恢复时应从哪个一致状态继续。

只有在没有数据依赖、执行器允许并发且目标资源不会冲突时，两个任务才适合并行。逻辑独立不代表它们可以同时修改同一文件或外部对象。

## Plan 是可更新的控制结构

Plan 描述 Task 的分解、顺序、依赖和当前执行策略。它不是只能存在于模型隐藏推理中的一段文本。

一个可执行 Plan 通常包含：

- 步骤及其依赖；
- 每一步的状态和负责人；
- 预期产物或完成条件；
- 当前阻塞项；
- 因新证据产生的调整。

Plan 不是越详细越好。简单任务可以只有一两个步骤；复杂、长时间或多参与者任务才需要显式依赖图。Plan 的粒度应服务于协调、恢复和用户理解。

## Progress 记录事实

Progress 应描述已经发生并有依据的事实：

```text
可靠的 Progress
    已运行 12 项相关测试，全部通过。
    修改已写入 upload.rs，尚未执行集成测试。
    外部审批仍在等待，写操作尚未执行。

不可靠的 Progress
    测试应该没问题。
    基本完成。
    看起来已经修好了。
```

常见状态可以是：

```text
Pending → Ready → InProgress → Verifying → Completed
                  ├──────────→ Blocked
                  ├──────────→ Waiting
                  ├──────────→ Cancelled
                  └──────────→ Failed
```

具体系统可以使用不同名称，但必须区分“动作做完”和“结果已验证”。

## 重新规划

出现以下情况时通常需要更新 Plan：

- Observation 推翻了原假设；
- 工具、权限或资源不可用；
- 上游 Task 失败或产生新依赖；
- 用户修改 Goal 或约束；
- 剩余 Budget 不足以执行原方案；
- 验证发现新的缺陷或副作用。

重新规划时应保留已经确认的事实和 Artifact，不能通过重写计划抹去失败、授权记录或已经发生的副作用。

## Plan 与 Success Criteria 的边界

```text
Success Criteria
    定义“什么结果算完成”

Plan
    定义“当前准备怎样达到结果”

Progress
    定义“已经推进到哪里”
```

Plan 可以频繁改变，Progress 随执行更新，Success Criteria 则需要明确授权才能调整。三者混在一起，会导致系统通过修改计划偷偷降低完成标准。

## 本篇检查

1. Task 是否有明确结果和状态？
2. Subtask 的粒度是否有助于调度、验证或恢复？
3. Dependency 是否覆盖数据与资源冲突？
4. Plan 是否可以显式更新并保留变更原因？
5. Progress 记录的是事实还是预测？
6. 动作完成与验证完成是否分开？
7. 上游失败后，下游任务如何取消或重新规划？

---

[上一篇：Goal、成功标准与完成判定](01-goal-success-criteria.md) · [下一篇：Session、Turn、Checkpoint 与 State](03-session-turn-checkpoint-state.md)
