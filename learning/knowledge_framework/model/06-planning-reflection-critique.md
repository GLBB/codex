# Planning、Reflection 与 Critique

## 三者作用于不同对象

Planning、Reflection 和 Critique 经常被笼统称为“让模型多想一遍”，但三者应有不同输入、产物和触发条件：

| 机制 | 主要对象 | 典型产物 |
| --- | --- | --- |
| Planning | 尚未完成的 Goal 与当前 State | Task、顺序、依赖、验证点 |
| Reflection | 已发生的轨迹与 Observation | 新事实、失败解释、下一步调整 |
| Critique | 候选方案、Artifact 或完成声明 | 缺陷、风险、反例、是否通过 |

```text
Plan:       接下来打算怎么推进？
Reflection: 刚才发生了什么，状态应怎样更新？
Critique:   当前方案或结果哪里可能不成立？
```

三者都不能替代外部验证。模型自评“正确”仍只是候选判断。

## Planning：把成功标准变成可执行结构

计划至少要连接四件事：

```text
Success Criterion
    → Task
    → Required Evidence
    → Completion / Replan condition
```

好的计划不是预写整条不可改变的思维链，而是保留可编辑的控制结构。每个步骤应有明确产物和停止点；遇到新证据可以局部重排，而不必从头生成整份计划。

适合显式 Planning 的条件包括：任务跨多个系统、存在依赖或审批、需要长时间推进、失败代价高。单步只读查询通常不需要维护庞大计划。

Plan Mode 是产品交互状态，Planning 是通用决策机制。前者可能限制写操作、要求用户确认方案；后者也可以在普通执行模式中以简短内部任务结构存在。

## Reflection：只从可观察轨迹更新状态

Reflection 的输入应该是有界轨迹：上一步意图、实际 Tool Call、Observation、错误和当前 Success Criteria。它要回答：

1. 哪些事实已经被证据确认？
2. 哪些假设被推翻？
3. 失败属于参数、权限、环境、容量还是方案问题？
4. 下一步是重试、改计划、请求输入还是终止？

Reflection 不应重写历史，把失败描述成成功；也不应把模型猜测直接写入长期 Memory。只有经过验证、具有来源且值得复用的事实才适合持久化。

## Critique：寻找反例，而不是润色答案

Critique 应针对明确的验收契约。例如代码变更的 Critic 可以检查：

- 是否真的覆盖根因而不是症状；
- 是否违反 API、权限或平台兼容性；
- 是否缺少必要测试；
- 是否存在未验证的副作用；
- Diff 是否超出用户授权范围。

Critic 与 Generator 使用同一模型、同一 Prompt 和同一上下文时，错误相关性很高。提高独立性的方法包括：

- 使用不同 Prompt 角色和只读权限；
- 隐藏生成者的自我辩护，只提供 Artifact 与标准；
- 使用独立模型或不同路由；
- 加入确定性 Test、Static Analysis 或 Policy Engine；
- 要求 Critic 指向具体证据和可复现反例。

Critic 的否决也不是绝对真理。系统要定义它可以阻断、建议还是仅记录，以及冲突如何交给用户或确定性规则裁决。

## 常见编排形态

### Plan–Execute–Observe

```text
plan next bounded step
  → execute
  → observe
  → update plan
```

适合一般工具型 Agent。不要一次生成几十步后盲目执行。

### Evaluator–Optimizer

```text
generate candidate
  → evaluate against rubric
  → revise with concrete feedback
  → stop on pass or iteration budget
```

适合文案、代码方案和结构化产物。Rubric 必须来自 Success Criteria。

### Independent Critic / Guardian

```text
planned high-risk action
  → isolated reviewer with narrow context
  → structured allow / deny / revise
  → policy applies final decision
```

适合高风险动作。Reviewer 应尽量只读、权限收缩，并有超时和失败时的保守策略。

## 停止条件与预算

多轮自我改进很容易形成无限循环。每个机制都要有终止条件：

- Planning：计划足以产生下一个有界动作；
- Reflection：状态和下一转移已经确定；
- Critique：满足 Rubric，或达到轮次、成本、延迟上限；
- 无新证据：停止重复，转向工具、用户或失败状态。

“再想一次”必须说明预期获得什么新信息。若输入完全相同，只改变措辞，通常不构成有效进展。

## Codex 源码阅读路线

先阅读 `codex-rs/core/src/tools/handlers/plan_spec.rs`，理解计划更新如何作为一个显式 Tool Contract 暴露给模型。然后回到 `codex-rs/core/src/session/turn.rs`，观察 Tool Call 结果进入历史并触发下一次 Sampling 的闭环。重点是计划属于可观察状态，而不是隐藏推理文本。

接着打开 `codex-rs/core/src/config/mod.rs` 的 `plan_mode_reasoning_effort`，再沿 Collaboration Mode 与 Turn Context 的构造位置阅读。观察工作模式如何改变有效配置，而不是更换整个 Agent Loop。

最后阅读 `codex-rs/core/src/guardian/mod.rs` 顶部模块说明和 `GuardianOutcome` 一类结构化结果，再进入 `guardian/review_session.rs` 的 `build_guardian_review_session_config`。注意 Reviewer 如何继承必要配置，同时收缩工具、Memory、Hooks、Approval 和重试。到 Review Session 配置完成处停止；具体审批 UI 不属于本篇重点。

## 本篇检查

1. Plan 是否连接 Success Criteria、Task 和 Evidence？
2. Reflection 是否只根据真实 Observation 更新状态？
3. Critique 是否使用明确 Rubric 并指出可复现问题？
4. Reviewer 是否与 Generator 有足够的上下文或模型独立性？
5. Critic 的权限和裁决权是否明确？
6. 每个自我改进循环是否有轮次、成本和无进展停止条件？

---

[上一篇：Reasoning Effort 与 Sampling](05-reasoning-effort-and-sampling.md) · [返回学习地图](README.md) · [下一篇：Model Routing 与 Fallback](07-model-routing-fallback.md)
