# Critic、Verifier 与 Evaluator

## 三种角色解决不同问题

| 角色 | 核心问题 | 典型输入 | 典型产物 | 是否决定当前任务终态 |
| --- | --- | --- | --- | --- |
| Critic | 候选结果哪里可能有问题？ | Goal、候选产物、Rubric、部分 Evidence | 缺陷、反例、修订建议 | 通常不直接决定 |
| Verifier | 指定条件是否已经满足？ | Criteria、实际状态、Evidence | Pass / Fail / Unknown 及理由 | 可以提供决定依据 |
| Evaluator | 系统在任务分布上表现怎样？ | 数据集、轨迹、结果、评分规则 | Score、分类、聚合指标 | 通常不决定单次运行终态 |

同一个模型可以在不同阶段承担三种角色，但必须使用不同的契约。把所有额外模型调用统称为“反思”，会掩盖它们的输入、权限和可靠性差异。

## Critic 用于寻找缺陷

Critic 不应只把原答案换一种说法。有效 Critique 需要：

- 明确 Rubric 或 Success Criteria；
- 寻找反例、遗漏、冲突和过强结论；
- 指向产物的具体位置；
- 区分确定缺陷与待验证风险；
- 给出能产生新 Evidence 的下一步。

```text
Generate candidate
    ↓
Critic identifies a concrete gap
    ↓
Revise or run a targeted check
    ↓
New artifact / evidence
```

如果每轮 Critic 都只说“可以更完善”，而没有新发现、状态变化或新证据，Evaluator–Optimizer Loop 应触发无进展停止条件。

## Verifier 应尽量独立

Verifier 最重要的输入是 Criteria 与可观察 Evidence，而不是生成者的自我解释。独立性可以来自：

- 确定性测试、类型系统、Schema 或形式规则；
- 与生成路径不同的查询或工具；
- 隔离环境中的重放；
- 不共享候选理由的独立模型或领域系统；
- 人工验收。

“独立模型”仍可能共享训练偏差，也可能被同一错误 Evidence 误导，所以不能自动视为 Ground Truth。高风险任务应优先使用真实状态、确定性规则或领域权威系统。

Verifier 的结果最好不是裸布尔值：

```text
criterion_id
status = pass | fail | unknown | not_applicable
evidence_ids
method and verifier version
reason
freshness / confidence / limitations
```

`unknown` 很重要。证据不足不是 `fail`，更不是 `pass`。

## Evaluator 服务于系统改进

Evaluator 通常跨越多条 Trajectory，回答：

- Task Success Rate 是否提高；
- 哪类 Criteria 经常缺 Evidence；
- Tool Selection、调用次数、延迟和成本如何；
- Critic 是否带来有效修订；
- 人工介入、误完成和错误拒绝各有多少；
- 新版本是否产生 Regression。

Evaluator 可以消费运行时 Verifier 的结构化结果，但不能只复用最终 `completed` 标签，因为那个标签本身可能存在误判。

## LLM-as-a-Judge 的使用边界

模型 Judge 适合评估开放式质量，如清晰度、覆盖度、语气和方案合理性，但需要：

1. 明确 Rubric 与评分锚点；
2. 对候选顺序、长度和身份偏差做控制；
3. 给 Judge 足够但有界的 Evidence；
4. 用人工标注集校准一致性；
5. 对高风险硬约束保留确定性检查；
6. 保存 Judge 模型、Prompt 与版本，保证分数可解释。

不要让 Judge 根据候选答案自己编造事实再评分。事实正确性应有可核查来源。

## 防止验证器被优化穿透

当生成器知道固定检查细节时，可能学会“通过检查”而非完成目标。典型现象包括只针对公开样例、修改测试而非实现、堆砌引用、迎合 Judge 文风。缓解方式包括：

- 将不可违反的产品约束与具体测试样例分离；
- 组合公开检查、隐藏检查和真实环境验证；
- 审查测试或 Rubric 的变更；
- 监控任务结果而非代理指标；
- 定期从生产失败中更新 Eval Set。

## Codex 源码阅读路线

Codex 的 Review 能力可作为 Critic 的具体例子。先从 `codex-rs/protocol/src/review_format.rs` 理解 Review 输出格式，再读 `codex-rs/core/src/tasks/review.rs` 中的 `ReviewTask`、`process_review_events` 和 `parse_review_output_event`，观察独立 Review 会话怎样生成结构化 Finding。重点是区分“指出缺陷”和“证明整个任务完成”，不必把 Review 流程误读成通用 Completion Verifier。

随后阅读 `codex-rs/core/tests/suite/` 中与 Review 或 Tool Loop 相关的一条集成测试，观察测试怎样成为确定性 Verifier。最后对照 `codex-rs/core/src/session/turn.rs` 的 Turn 推进逻辑，标出模型决策、工具观察和终止信号的位置，判断仓库当前哪些完成语义由 Agent Prompt 承担，哪些由 Runtime 强制。

## 本篇检查

1. Critic 是否产出具体缺陷和可执行的验证建议？
2. Verifier 是否以 Criteria 和独立 Evidence 为中心？
3. `unknown`、`not_applicable` 是否与 `pass`、`fail` 分开？
4. Evaluator 是否跨样本评估结果、轨迹、成本与安全？
5. 模型 Judge 是否经过版本化、校准和偏差检查？
6. 系统是否防止只优化固定测试或评分器？

---

[上一篇：Evidence、Grounding 与 Citation](03-evidence-grounding-and-citation.md) · [返回学习地图](README.md) · [下一篇：Side-Effect Reconciliation](05-side-effect-reconciliation.md)
