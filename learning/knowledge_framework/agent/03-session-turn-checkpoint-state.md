# Session、Turn、Checkpoint 与 State

## 四个概念处在不同层级

| 概念 | 含义 | 典型内容 |
| --- | --- | --- |
| Session | 一段可持续或可恢复的交互与任务上下文 | 用户输入、历史、配置、工作区、累计用量 |
| Turn | 一次用户输入触发的处理过程 | 多次模型请求、工具调用、观察与最终响应 |
| Checkpoint | 可安全恢复的持久化状态点 | 当前任务、已完成动作、待处理调用、产物引用、预算 |
| State | Agent 继续决策和控制执行所需的全部显式事实 | Task、交互、执行、环境、知识和控制状态 |

一次 Turn 可能包含多次模型请求：模型先请求工具，系统执行后把结果写回，模型再决定继续调用还是回答。Session 则可以包含多个 Turn，甚至跨越暂停和进程重启。

## State 不是对话历史

对话历史只是 State 的一个来源。完整运行状态通常包括：

```text
Task State
    Goal、Success Criteria、Task Graph、Plan、Progress

Interaction State
    Session、Turn、用户输入、澄清、审批、交接信息

Execution State
    Tool Call、call_id、执行状态、外部操作 ID、产物与错误

Environment State
    Workspace、文件版本、进程、远程资源及其已知快照

Knowledge State
    History、工作记忆、RAG 证据、Skill 与来源信息

Control State
    Budget、Deadline、权限、重试计数、取消信号、当前终态
```

如果系统只保存消息列表，通常无法准确回答：哪个动作已经执行、外部写入是否成功、预算还剩多少、审批覆盖哪个参数、恢复时能否安全重试。

## State Store 与 Model Context

State Store 保存系统需要维护的状态；Model Context 是从 State 中选择出来、供本轮模型决策使用的有界视图。

```text
State Store
    完整任务图、调用账本、产物引用、审批、用量、历史
        ↓ 选择、压缩、过滤、标注来源
Model Context
    本轮相关指令、历史摘要、当前任务、证据和工具定义
```

两者不能画等号：

- 完整 State 可能太大、太敏感或与本轮无关；
- Model Context 会因 Token 预算进行压缩；
- 某些运行时事实只供调度和审计使用，不应发给模型；
- 模型需要知道的结论可以来自状态摘要，而不是原始大输出。

## State 的四条原则

### 显式

影响控制流程的事实不能只依赖模型“记住”。例如，重试计数、待审批动作和外部操作 ID 应结构化保存。

### 有来源

区分用户指令、系统规则、工具结果、外部内容和模型推测。外部文件中的命令式文字仍是数据，不能自动提升为高优先级指令。

### 有界

历史、工具输出、Artifact 和 Memory 都不能无限注入模型上下文。系统需要长度上限、分页、摘要、引用和遗忘策略。

### 可恢复

持久化状态应足以判断哪些动作已执行、哪些仍在运行、哪些可以重试、哪些必须先核对外部状态。

## Checkpoint 保存什么

Checkpoint 不只是保存对话文本。一个可恢复的最小检查点通常包括：

```text
session_id / turn_id / current_task
goal / success_criteria / plan / progress
pending and completed calls
call_id / normalized arguments / external operation id
approval decision and scope
artifact and evidence references
remaining budgets / deadline
environment version or workspace snapshot
last consistent transition
```

Checkpoint 的目标不是保存所有瞬时细节，而是建立一个一致的恢复边界。

## Budget 与 Deadline 也是 State

常见 Budget 包括：

| 类型 | 典型边界 |
| --- | --- |
| Model Budget | Token、模型请求次数、推理成本 |
| Tool Budget | 调用次数、输出大小、外部 API 成本 |
| Retry Budget | 最大次数、累计等待时间 |
| Concurrency Budget | 全局、服务、资源级并发数 |
| Context Budget | 单项与总上下文硬上限 |

Deadline 可以位于 Task、Turn、单次模型请求或单次工具调用层级。下层 Deadline 不应超过上层剩余时间。

预算耗尽或期限到达是正常控制结果，不表示成功。系统应保存哪些动作未执行、哪些结果可能不完整，以及外部副作用是否仍需核对。

## History、Memory 与 State

- History 记录当前 Session 中发生过的交互和事件；
- Working State 保存当前任务继续执行所需的信息；
- Memory 按写入策略保存值得跨步骤或跨 Session 复用的信息；
- Checkpoint 保存恢复控制流程所需的一致快照。

它们可以共享底层存储，但语义和生命周期不同。并非所有 History 都应成为 Memory，也不是所有 Memory 都应进入当前 Model Context。

## 本篇检查

1. Session 与 Turn 的创建和结束边界在哪里？
2. 一次 Turn 是否允许多次模型请求和工具调用？
3. 哪些事实属于结构化 State，而不是普通消息？
4. State Store 如何生成有界的 Model Context？
5. Checkpoint 是否足以恢复任务和核对副作用？
6. Budget 与 Deadline 在哪些层级累计？
7. History、Memory、State 和 Checkpoint 如何区分？

---

[上一篇：Task、Subtask、依赖、Plan 与 Progress](02-task-plan-progress.md) · [下一篇：Agent Loop：从输入到状态更新](04-agent-loop.md)
