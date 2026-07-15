# 完整案例：修复大文件上传问题

本案例沿一次代码修复展示 Goal、Task、State 与 Agent Loop 如何协作。重点不是具体代码，而是每个阶段的控制事实和证据。

## 用户请求

```text
修复上传大文件时的内存溢出，并确保现有行为不变。
```

## 第一步：初始化 Goal 与 State

Agent 将请求整理为：

```text
Goal
    消除大文件上传导致的内存溢出。

Success Criteria
    1. 上传使用有界内存；
    2. 小文件和错误处理行为保持不变；
    3. 相关测试通过；
    4. 不新增越权路径、资源泄漏或未清理的临时文件。

Task Graph
    A. 定位问题
    B. 设计方案       depends_on: A
    C. 实现修改       depends_on: B
    D. 编写测试       depends_on: B
    E. 运行验证       depends_on: C, D

Control State
    Workspace、权限、Budget、Deadline、取消信号
```

此时还不能决定具体修复方案，因为根因尚未确认。

## 第二步：构建第一轮输入

本轮 Model Context 包含：

- 仓库和系统 Instructions；
- 用户 Goal 与 Success Criteria；
- 当前 Task A 和 Plan；
- 工作区、平台和版本状态；
- 相关代码搜索与读取工具；
- 尚未产生 Evidence 的明确状态。

Memory、RAG 或 Skill 只有与当前问题相关且来源可信时才注入。Runtime 中存在但本轮不需要的高风险工具可以不暴露。

## 第三步：模型选择只读动作

模型产生搜索和读取代码的 Tool Call。Agent 依次执行：

```text
解析 Tool Call
    ↓
校验参数 Schema
    ↓
检查路径和查询语义
    ↓
应用 Workspace Policy
    ↓
在受控 Runtime 中执行
```

Observation 显示上传函数把完整文件一次性读入内存。Agent 将相关文件、调用结果和 `call_id` 写入 History，把定位结论作为 Evidence 关联到 Task A。

状态变化：

```text
A: Completed
B: Ready
C: Pending
D: Pending
E: Pending
```

## 第四步：制定并更新 Plan

模型基于新证据提出有界缓冲方案。Plan 同时安排：

- C 修改读取流程；
- D 增加大文件、错误路径和资源清理测试；
- E 在 C、D 都完成后运行验证。

C 和 D 在逻辑上可以分别准备，但若都会修改同一个文件，调度器仍需串行或隔离工作区。依赖图只说明数据关系，不自动保证资源并发安全。

## 第五步：执行修改

模型生成补丁 Tool Call。系统检查：

- Patch 格式是否合法；
- 修改目标是否位于允许路径；
- 当前文件版本是否仍与读取时一致；
- 动作是否需要 Approval；
- Sandbox 是否限制到正确工作区。

执行成功后得到：

- Observation：补丁已应用；
- Artifact：修改后的源文件；
- Diff：本次变更的可检查表示。

这时 Task C 可以进入 Verifying，但 Goal 仍未完成。写入成功不能证明行为正确。

## 第六步：验证并发现问题

模型选择运行相关测试。Runtime 返回：主体测试通过，但错误路径测试失败，临时文件没有清理。

Agent 应：

1. 将失败结果写入 History 和 Evidence；
2. 把 C 或 D 标记为待修复，而不是 Completed；
3. 更新 Plan，增加资源清理修复；
4. 扣减 Tool、Time 和 Retry Budget；
5. 保留当前 Diff 和失败测试，避免重复定位。

它不能因为主要功能已经工作就声称完成，也不能删除失败 Evidence 来保持原 Plan 不变。

## 第七步：修复并重新验证

Agent 修复资源清理逻辑，再运行：

- 大文件上传测试；
- 小文件兼容测试；
- 错误路径与临时文件清理测试；
- 必要的格式、类型或静态检查。

测试通过后，Agent 重新读取关键 Diff，确认实际 Artifact 与预期一致。Task C、D、E 才能进入 Completed。

## 第八步：完成判定

Verifier 将 Evidence 映射回 Success Criteria：

| Success Criteria | Evidence | 结果 |
| --- | --- | --- |
| 有界内存 | 流式实现 Diff 与大文件测试 | 满足 |
| 现有行为不变 | 小文件和错误处理测试 | 满足 |
| 自动化测试通过 | 测试报告与退出状态 | 满足 |
| 无新增资源泄漏 | 清理测试与代码复核 | 满足 |

所有必要条件满足后，状态从 Continue 转为 Complete。最终响应说明修改结果、验证证据和仍存在的限制。

## 如果中途发生特殊情况

### 需要用户选择

若发现两种方案会产生不同兼容性影响，Agent 保存 Checkpoint 并进入 Wait for User，而不是自行改变 Goal。

### 写操作需要审批

Agent 将具体 Patch、目标文件和影响范围绑定到 Approval，请求批准后进入 Wait for Approval。

### 测试超时

停止等待不代表测试进程已经退出。系统先取消或查询进程状态，再决定 Retry、Recover 或 Fail。

### 修改结果响应丢失

Agent 先重新读取文件或查询调用账本，确认 Patch 是否已经生效，不能直接重复应用。

### 用户取消

取消信号传播到模型请求、测试进程和后台任务。系统保存已产生的 Diff、未完成步骤和资源清理结果，进入 Cancelled。

## 三条分析链

```text
执行链
Goal → Context → Model → Tool Call → Runtime
     → Observation → Verification → Complete

数据链
Workspace → Source Snapshot → Diff → Test Result
          → Evidence → History / Checkpoint

信任链
Instruction Provenance → Path Policy → Approval
                       → Sandbox → Side Effect → Audit
```

执行链回答“怎样推进”；数据链回答“事实和证据怎样流动”；信任链回答“谁有权让什么副作用发生”。缺少任何一条，都无法完整解释这个 Agent 为什么可以安全地宣布完成。

## 案例复盘

1. Goal 在整个过程中保持稳定，Plan 随 Evidence 调整；
2. Task Graph 控制顺序，资源冲突进一步限制并发；
3. State 保存的内容远多于对话消息；
4. 模型输出只是候选决策，每个动作都经过校验与 Runtime；
5. Observation、Artifact、Diff 和 Evidence 分工不同；
6. 动作成功不等于 Goal 完成；
7. Wait、Retry、Recover、Timeout 和 Cancel 都需要可恢复状态；
8. Complete 只由 Success Criteria 和 Evidence 决定。

---

[上一篇：状态转移、恢复与终止](05-state-transitions.md) · [下一篇：设计检查、常见错误与练习](07-design-checklist-and-exercises.md)
