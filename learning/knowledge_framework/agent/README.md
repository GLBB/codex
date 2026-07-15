# Goal、Task、State 与 Agent Loop 学习地图

## 这组教程解决什么问题

Agent 不是“能够调用工具的模型”，而是围绕目标持续推进状态的控制系统：

```text
Goal / Success Criteria
          ↓
Task / Plan / Current State
          ↓
      Agent Loop
          ├── 构建本轮输入
          ├── 让模型生成候选决策
          ├── 校验并执行动作
          ├── 观察结果并验证
          └── 更新状态、继续或终止
```

其中：

- Goal 说明最终想达到什么结果；
- Success Criteria 说明用什么证据判断结果合格；
- Task 是可调度、可跟踪的工作单元；
- Plan 描述 Task 的分解、顺序和依赖；
- State 保存继续推进任务所需的显式事实；
- Agent Loop 反复执行“决策—行动—观察—验证—转移”，直至进入终态。

模型只生成候选决策。动作能否执行、结果是否可信、任务是否完成，还要分别经过策略、运行时和验证机制判断。

## 推荐学习顺序

1. [Goal、成功标准与完成判定](01-goal-success-criteria.md)：先明确 Agent 为什么行动，以及怎样证明完成。
2. [Task、Subtask、依赖、Plan 与 Progress](02-task-plan-progress.md)：把目标变成可调度、可跟踪的工作结构。
3. [Session、Turn、Checkpoint 与 State](03-session-turn-checkpoint-state.md)：理解控制状态、模型上下文和持久化状态的边界。
4. [Agent Loop：从输入到状态更新](04-agent-loop.md)：学习一次完整循环的六个阶段。
5. [状态转移、恢复与终止](05-state-transitions.md)：处理等待、重试、恢复、补偿、超时和失败。
6. [完整案例：修复大文件上传问题](06-complete-case.md)：沿执行链、数据链和信任链串起全部概念。
7. [设计检查、常见错误与练习](07-design-checklist-and-exercises.md)：检查设计完整性并进行实践。

初学者应按顺序阅读。已有 Agent 基础的读者，可以先读本文和第 4、5 篇，再通过第 6、7 篇查漏补缺。

## 全局关系

```text
                     Context / Memory / RAG
                               │
                               ▼
 Goal / Task / State ───── Agent Loop ─────── Model
         │                     │                │
         │                     ▼                ▼
 Policy / Approval ─────── Tool Runtime ◄── Decision
         │                     │
         ▼                     ▼
     Sandbox          Observation / Artifact
                               │
                               ▼
                  Verification / Completion
                               │
                               ▼
                   State / Trace / Evaluation
```

Agent Loop 是控制中心，但不是整个 Agent。Context Store、Tool Runtime、Verifier、Policy、Sandbox、Persistence 和 Observability 都在循环外围提供必要能力。

## 三条分析主线

阅读任何 Agent 系统时，应同时跟踪三条链：

```text
执行链
Trigger → Goal → Task → Context → Model → Decision
        → Action → Observation → Validation → State Transition → Result

数据链
Input → Session / Task State → Tool Result → Artifact / Evidence
      → Summary → Memory / Evaluation Data

信任链
Identity → Input Provenance → Instruction Priority → Permission
         → Isolation → Side Effect → Audit
```

只实现执行链，通常只能得到 Agent Demo。补齐数据链和信任链，系统才具备可部署、可恢复和可审计的基础。

## 内容覆盖表

| 知识框架节点 | 对应教程 |
| --- | --- |
| Goal / Success Criteria | 第 1 篇 |
| Task / Subtask / Dependency、Plan / Progress | 第 2 篇 |
| Session / Turn / Checkpoint、Budget / Deadline / Terminal State | 第 3、5 篇 |
| Prompt / Instructions、Conversation、Environment、Memory / RAG / Skills、Available Tools | 第 4 篇 |
| Final Answer、Structured Output、Tool Call、Clarification、Handoff | 第 4 篇 |
| Schema / Semantic Validation、Policy / Permission / Approval、Tool Runtime、Sandbox / Remote Executor | 第 4 篇 |
| Observation、Artifact / Diff / Evidence、Verification、History / Memory / Usage、Checkpoint / Progress | 第 4 篇 |
| Continue / Complete、Wait、Retry / Recover / Compensate、Timeout / Cancel / Reject / Fail | 第 5 篇 |
| 综合运用与设计验收 | 第 6、7 篇 |

## 学习完成标准

完成本组教程后，应能回答：

1. Goal、Task、Plan、Session、Turn 和 State 为什么不能混为一谈？
2. 成功标准如何影响计划、验证和停止条件？
3. 每轮模型输入从哪些状态中选择，为什么必须有界？
4. 模型输出为什么只是候选决策？
5. Tool Call 在执行前后分别经过哪些控制？
6. Observation、Artifact 和 Evidence 有什么区别？
7. Agent 如何判断继续、等待、恢复或终止？
8. 中断和响应丢失后，如何避免重复副作用？
