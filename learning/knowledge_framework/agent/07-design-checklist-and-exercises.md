# 设计检查、常见错误与练习

## 常见错误

### 把 Goal 写成愿望

只有“做好”“优化一下”而没有 Success Criteria，系统就无法可靠停止。应补充可观察结果、约束、失败条件和验收证据。

### 把 Task、Turn 和模型请求混为一谈

Task 是工作单元，Turn 是一次用户输入触发的处理过程，模型请求只是 Turn 内的一次推理。强行一一对应会妨碍工具闭环、等待和恢复。

### 把 State 等同于消息列表

消息列表通常不能完整表示依赖、Budget、待处理调用、审批、外部副作用和恢复点。关键控制事实应结构化保存。

### 把模型输出当成执行结果

Tool Call 只是请求，Structured Output 只是表达格式，Final Answer 只是候选回答。三者都需要相应校验。

### 只验证动作，不验证 Goal

“写入成功”或“命令退出码为 0”只说明局部动作结果。完成判定必须回到 Success Criteria。

### 无限制地继续 Loop

相同参数反复调用、Observation 没有新增信息、错误类别不变，通常意味着无效循环。系统应重新规划、询问用户或在预算内终止。

### 把 Wait 当 Fail，把 Timeout 当未执行

Wait 是可恢复暂停；Timeout 只表示没有按时得到终态，外部动作可能已经发生。

### 恢复时重放所有未完成动作

“未收到结果”不等于“没有副作用”。Recover 应先查询调用账本和外部状态，再决定接受结果、Retry 或 Compensate。

### 把 Approval 当 Sandbox

用户批准动作不代表可以突破文件、进程或网络隔离。Approval 决定是否授权，Sandbox 负责强制执行边界。

### 通过改 Plan 降低 Success Criteria

Plan 可以调整实现路线，不能未经授权删掉验收条件。预算不足时应返回部分结果或超时状态。

## 完整设计检查表

### Goal 与 Task

1. 谁触发任务？
2. Goal、Success Criteria、Failure Criteria 和不可违反的约束是什么？
3. Task 如何拆分，Subtask 的依赖与并行边界是什么？
4. Plan 与 Progress 保存在哪里？
5. 谁有权修改 Goal 和成功标准？

### State 与生命周期

6. Session、Turn 和 Checkpoint 分别如何创建、结束、持久化与恢复？
7. State 是否覆盖 Task、交互、执行、环境、知识和控制状态？
8. History、Working State、Memory 和 Model Context 如何区分？
9. Token、调用、输出、并发、费用和 Retry Budget 如何累计？
10. Task、Turn、模型请求和工具调用的 Deadline 如何嵌套？

### 输入与决策

11. 每轮如何选择 Prompt / Instructions、Conversation、Session State、Environment、Workspace、Memory、RAG、Skills 和 Available Tools？
12. Context 如何记录来源、优先级、可信度、新鲜度和硬上限？
13. Final Answer、Structured Output、Tool Call、Clarification 和 Handoff 如何区分？
14. Handoff 是否携带任务、上下文、权限、Budget 和验收标准？

### 动作控制

15. Schema 与 Semantic Validation 分别由谁执行？
16. Policy、Permission 和 Approval 的职责边界是什么？
17. Tool Runtime 如何处理路由、并发、Timeout、Cancel、输出截断和错误分类？
18. Sandbox 与 Remote Executor 如何限制文件、进程、网络、身份和凭据？
19. Tool Call 与 Tool Result 如何通过 `call_id` 配对？

### 观察与验证

20. Observation、Artifact、Diff 和 Evidence 如何区分？
21. Preconditions、Postconditions 和 Success Criteria 分别如何验证？
22. History、Memory、Usage、Progress 和 Checkpoint 在何时更新？
23. 原始输出、模型视图和用户视图如何分别限界与脱敏？

### 转移与恢复

24. Continue 与 Complete 的条件是什么？
25. Wait for User、Approval 和 Event 各由什么事件唤醒？
26. Retry 如何检查幂等性、错误类型、退避与预算？
27. Recover 如何核对已经发生的副作用？
28. Compensate 是否也经过 Policy、Approval 和 Verification？
29. Timeout、Cancel、Reject 和 Fail 如何区分？
30. 系统如何发现重复调用和无效循环？

## 练习一：为模糊 Goal 补齐成功标准

用户请求：

```text
帮我把这个接口优化一下。
```

完成以下内容：

1. 列出必须向用户澄清的信息；
2. 假设目标是降低延迟，写出可度量的 Success Criteria；
3. 写出不能破坏的兼容性与安全约束；
4. 为每项标准指定 Evidence；
5. 说明 Budget 到期但只完成一半时如何表达。

## 练习二：画出 Task Graph

任务是“迁移数据库字段并保持服务可用”。至少拆出：

- 兼容性分析；
- Schema 变更；
- 双写或兼容代码；
- 数据回填；
- 验证；
- 切换与清理。

标出依赖、可并行步骤、不可逆副作用、Approval 点和 Compensation 方案。不要只列线性清单。

## 练习三：设计 State

为一个“生成报告并等待用户批准后发送邮件”的 Agent 设计最小 State。至少包含：

- Goal、Success Criteria 和 Task 状态；
- 报告 Artifact 与版本；
- 审批对象、范围和状态；
- 邮件发送 `call_id`、幂等键和外部消息 ID；
- Budget、Deadline 和取消状态；
- Checkpoint 与恢复信息。

解释哪些内容进入 Model Context，哪些只供 Runtime 和审计使用。

## 练习四：处理响应丢失

模型请求发送邮件，Tool Runtime 超时且没有返回结果。回答：

1. 为什么不能立即 Retry？
2. 应查询哪些本地与外部状态？
3. 如何利用幂等键和外部消息 ID？
4. 无法确认时应进入 Wait、Fail 还是请求用户决定？
5. 最终响应如何说明不确定副作用？

## 练习五：实现一个 Fake Agent Loop

使用 Fake Model 和 Fake Tool 实现以下轨迹：

```text
第 1 次模型请求：返回 ToolCall("read_state")
工具结果：返回当前状态
第 2 次模型请求：返回 ToolCall("update_state")
工具结果：模拟响应丢失，但实际已经写入
恢复流程：查询外部状态，不重复写入
第 3 次模型请求：返回 FinalAnswer
Verifier：检查 Success Criteria 后进入 Complete
```

打印并断言：

```text
[model request]
[decision]
[policy]
[tool call]
[observation]
[verification]
[state transition]
[checkpoint]
[final result]
```

除了最终文本，还要断言写操作只发生一次、`call_id` 正确配对、Budget 正确扣减，并且恢复后没有制造重复副作用。

## 最终验收

如果能独立完成以上练习，并能用执行链、数据链和信任链解释自己的设计，就已经掌握了 Goal、Task、State 与 Agent Loop 的核心结构。

---

[上一篇：完整案例：修复大文件上传问题](06-complete-case.md) · [返回学习地图](README.md)
