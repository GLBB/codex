# 09 Agent 设计范式：Workflow、ReAct、Planning 与 Reflection

## 不要从框架名开始设计

面对“分析一个 PR 并建议测试”，可以写固定流水线，也可以让 Agent 自主探索，还可以拆成
多个角色。没有一种永远最好。选择范式的依据是任务不确定性、风险、可枚举程度和反馈
速度，而不是哪个名词更像 Agent。

## 四种系统先排成一条光谱

```text
Chatbot -------- Workflow -------- Agent -------- Multi-Agent
只生成文本      路径预先定义       路径动态决定      多个独立执行单元
```

- Chatbot 适合解释和生成，不主动改变外部状态。
- Workflow 适合步骤稳定、风险高、分支可枚举的流程。
- Agent 适合需要探索、工具反馈和动态决策的任务。
- Multi-Agent 只在并行、隔离或独立验收带来明确收益时使用。

生产系统常是混合体：Workflow 控制外层状态，某个节点内部运行 Agent Loop。

## ReAct：边做边看

ReAct 的核心：

```text
Reason/Decide -> Act -> Observe -> Reason/Decide
```

例如排查测试失败：先读日志，根据错误找文件，再运行单测，根据新结果决定是否修改。
它适合路径无法预先写死的探索。

优点是简单且能利用即时反馈；风险是循环、动作漂移和成本不可预测。工程上必须补：最大
轮数、工具预算、重复调用检测、权限和明确停止条件。

## Plan-and-Execute：先建立可检查结构

复杂任务可以先生成计划：

```text
1. 找到认证入口和失败测试
2. 定位行为变化
3. 实现最小修复
4. 运行相关测试
5. 检查兼容性
```

计划让用户和系统更容易审核，也适合把独立步骤并行化。但计划不是合同：新证据出现时
要更新状态、解释变化，而不是为了“完成计划”继续错误路径。

好的计划项描述可验证结果，不写“分析代码”“继续处理”这类模糊动作。执行器每完成一步
要更新共享的任务状态，而不是把整段自然语言历史当状态机。

### Plan-and-Execute 与 ReAct 可以同时存在

二者不是必须二选一的两套 Harness。Plan-and-Execute 解决的是任务的整体结构，ReAct
解决的是执行当前步骤时如何根据新证据决定下一动作。生产系统常把计划放在外层，把
ReAct loop 放在每个计划项内部：

```text
用户请求
  -> 生成结构化计划
  -> 执行步骤 1：Decide -> Act -> Observe -> Decide
  -> 更新计划状态
  -> 执行步骤 2：Decide -> Act -> Observe -> Decide
  -> 验证并结束
```

例如“修复认证失败、补回归测试并检查兼容性”可以先拆成定位入口、确认行为变化、实现
修复、补测试和验证五步。执行“定位入口”时，Agent 仍然要根据搜索结果决定读哪个文件，
这部分就是 ReAct。搜索结果若证明原假设错误，Agent 还应修改计划，而不是机械执行旧步骤。

仅仅在回答中列出几条 Todo 不足以构成 Plan-and-Execute。计划需要进入可更新的执行状态，
至少能表示 `pending`、`in_progress` 和 `completed`；后续动作要参考这个状态；出现新证据时
能够重新规划；结束前还要检查计划是否真正完成。否则它只是给人看的任务清单。

### 模型如何决定是否先规划

常见实现不是 Harness 用关键字或固定阈值判断“这是 ReAct”还是“这是
Plan-and-Execute”，而是在 system 或 developer instructions 中告诉模型选择原则，同时
提供结构化计划工具。模型结合用户请求、已有上下文、工具能力和这些规则，在首次推理时
决定直接回答、立即调用业务工具，还是先创建计划。这是一种受指令约束的模型自主决策，
也可称为 prompt-based routing。

适合先规划的信号包括：

- 任务包含多个可验证交付物；
- 阶段之间存在依赖或执行顺序；
- 工作时间长，需要向用户展示中间进度；
- 需求或实现路径有歧义，需要先建立检查点；
- 风险较高，执行结构应先被审核。

简单问答、单文件小修改或下一动作显而易见的任务通常不需要计划。路径无法预先确定、但
工具反馈很快的排查任务可以直接从 ReAct 开始。如果生产系统要求更强的确定性，也可以在
模型外增加显式 Router，按风险、任务类型或成本把请求送进固定 Workflow、Planner 或普通
Agent loop；这属于产品策略，不是 Plan-and-Execute 的必要条件。

### Harness 为计划执行提供什么

在轻量实现里，Harness 通常负责：

1. 把计划使用规则和计划工具定义放进模型上下文；
2. 接收并校验结构化计划，保存步骤和状态；
3. 执行模型发出的工具调用，把结果作为 Observation 返回模型；
4. 工具调用后继续模型循环，而不是把一次工具结果当作整个任务的结束；
5. 将计划更新发送给 TUI、IDE 或其他客户端；
6. 提供轮数、时间、token、权限、取消和停止条件等边界。

这里最重要的架构问题是“谁调度下一步”。轻量设计让模型读取计划并决定接下来执行什么；
Harness 主要保存和展示状态。更严格的 Plan-and-Execute 会增加 Planner、Plan Store、
Scheduler、Executor、Validator 和 Replanner：Scheduler 只挑选依赖已满足的步骤，Executor
只获得当前步骤，Validator 判定完成或失败，必要时再交给 Replanner。前者实现简单但更依赖
模型自律，后者更可控但增加模型请求、状态同步和恢复成本。

### Codex 中两个容易混淆的“Plan”

Codex Default mode 中的 `update_plan` 是执行任务时使用的 Todo/进度工具。模型是否调用它，
主要依据 developer instructions 给出的复杂度和多阶段任务规则。调用之后，Harness 发布
计划更新事件；模型仍在同一个工具反馈循环里选择 shell、文件编辑、测试等动作。因此它更
接近“ReAct loop 加模型维护的结构化计划”，而不是两个完全隔离的 Planner 和 Executor。

Codex 的 Plan Mode 则是另一件事。它是由客户端或上层配置显式选择的协作模式，用于只读
调查、澄清需求并输出可交付的方案，不执行会修改项目的实现动作。用户请求的语气不会让
Harness 自动进入或退出 Plan Mode。`update_plan` 也不会切换模式，并且在 Plan Mode 中不能
调用。阅读源码时，可以先看 `protocol/src/prompts/base_instructions/default.md` 中模型何时
使用计划的规则，再看 `core/src/tools/handlers/plan.rs` 如何处理 `update_plan`，最后沿
`core/src/session/turn.rs` 观察工具结果如何触发下一次模型推理。

## Reflection：增加独立检查，而不是重复生成

Reflection 常见形态：

```text
draft -> critique against rubric/evidence -> revise
```

有效 Reflection 需要新的约束或证据，例如测试输出、review checklist、安全 policy。若同一
模型用同一上下文“再想一次”，往往只是更自信地重复错误。

它适合代码 review、结构化结果校验和高价值回答；不适合每个简单步骤都强制执行，因为会
增加延迟和 token。更不能把 Reflection 当权限批准：安全动作仍走正式 policy。

## 用同一个 PR 任务比较三种方案

任务：分析一个 PR，找潜在 bug，并建议测试。

### Workflow

```text
load diff -> run fixed static checks -> summarize changed files -> model review -> report
```

适合仓库规范稳定、检查项明确。可预测、容易审计，但遇到新类型问题不灵活。

### ReAct Agent

模型根据 diff 决定打开哪些定义、运行哪些测试。适合需要跨文件探索，但要限制只读工具、
轮数和测试时间。

### Multi-Agent

业务逻辑、测试、协议兼容性分别给独立 worker，父 Agent 汇总。适合大 PR 且子问题独立；
小 PR 会浪费成本，worker 输出还可能重复或冲突。

## 为什么有时需要自建 Agent Harness

框架擅长快速验证；生产系统可能需要精确控制：

- thread/turn 持久化与恢复；
- 模型可见 context 和 cache；
- 工具权限、sandbox 与审批；
- 流式协议与取消；
- trace、replay 和行为 eval；
- 本地/远程 execution environment。

“自建”不是重写模型 SDK、数据库和所有工具，而是掌握这些产品不变量。可以继续复用 MCP、
模型 client 和存储组件。

## 动手实验：做一次有证据的架构选择

选择一个任务，例如“根据错误日志修复一个小 Bug”。分别写 Workflow、ReAct、
Plan-and-Execute 三份设计，每份回答：

```text
哪些步骤固定，哪些由模型决定？
状态在哪里？
怎样停止？
工具和权限是什么？
失败后怎样恢复？
怎样评测？
预计模型请求和工具调用数？
```

再加一个 Reflection 节点，明确它获得了什么新证据。最后按质量、延迟、成本、安全和实现
复杂度打分，选择一份，而不是强行宣布 Agent 最先进。

## 常见误区

- Workflow 不是 Agent，所以不够智能。稳定流程通常更可靠。
- 有 plan 就是 Plan-and-Execute。计划必须进入可更新的执行状态。
- Reflection 会保证正确。审查模型同样会犯错。
- Multi-Agent 等于多个 prompt 顺序调用。关键在独立状态、通信和生命周期。
- 手搓 Agent 就是不使用任何框架。真正目标是控制关键边界。

## 理解之后再对照 Codex

ReAct loop 对应 `core/src/session/turn.rs` 与工具 orchestrator；计划工具位于
`core/src/tools/handlers/plan.rs`；review/Reflection 对应 `core/src/tasks/review.rs`、
`core/src/session/review.rs` 与 `core/src/guardian`；Multi-Agent 控制位于
`core/src/agent`。

对照时选同一个 PR 场景，判断 Codex 在哪里使用动态 loop、显式计划、独立 review 和
子 Agent，而不是按目录给每个模块贴流行术语。

## 本课验收

你应该能：

1. 根据任务不确定性和风险选择 Workflow 或 Agent。
2. 解释 ReAct 的循环风险和 Plan-and-Execute 的计划僵化风险。
3. 设计一个真正获得新证据的 Reflection 节点。
4. 用成本、延迟、安全和可恢复性证明是否需要 Multi-Agent。
