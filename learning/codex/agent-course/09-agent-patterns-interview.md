# 09 Agent 设计范式：把 ReAct、Planning、Reflection 讲清楚

## 本课目标

面试里经常会问“Agent 和 Workflow 有什么区别”“ReAct 是什么”“Plan-and-Execute 和 Reflection 怎么选”。本课把这些范式讲成可落地的工程取舍。

## Step 1：区分 Chatbot、Workflow、Agent、Multi-Agent

面试推荐回答：

```text
Chatbot：主要生成文本，不主动改变外部状态。
Workflow：步骤固定，LLM 只是某些节点的能力。
Agent：目标明确，但步骤由模型根据观察动态决定。
Multi-Agent：多个 agent 有不同职责，通过消息、共享状态或协议协作。
```

工程判断：

- 流程稳定、风险高、可枚举：优先 workflow。
- 任务开放、需要探索、需要工具反馈：可以用 agent。
- 单 agent 上下文或能力不够：再考虑 multi-agent。

## Step 2：ReAct

ReAct 的核心是：

```text
Reason -> Act -> Observe -> Reason
```

对应到 Coding Agent：

```text
理解任务
  -> 调用 shell/read/apply_patch
  -> 观察工具结果
  -> 决定下一步
```

优点：

- 简单，适合探索式任务。
- 工具反馈自然进入下一轮推理。

缺点：

- 容易循环。
- 计划不稳定。
- 成本和延迟可能不可控。

Codex 对照：

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/tools/orchestrator.rs`
- `codex-rs/core/src/tools/events.rs`

## Step 3：Plan-and-Execute

Plan-and-Execute 先产出计划，再执行步骤：

```text
plan = make_plan(goal)
for step in plan:
  execute(step)
  update_state()
```

适合：

- 任务复杂，需要先拆解。
- 需要给用户展示计划。
- 执行步骤可审核。

风险：

- 计划可能过早固定，遇到新信息要能改计划。
- planner 和 executor 的上下文边界要清楚。

Codex 对照：

- `codex-rs/core/src/tools/handlers/plan.rs`
- `codex-rs/core/src/agent/control/spawn.rs`
- `codex-rs/core/src/tasks/regular.rs`

## Step 4：Reflection

Reflection 是让模型检查自己的结果或过程：

```text
draft
  -> critique
  -> revise
```

适合：

- 代码 review。
- 复杂回答质量检查。
- 危险动作审批前审查。

风险：

- 反思不等于正确，可能只是更自信。
- 增加 token 成本和延迟。
- 审查者要有独立上下文和明确标准。

Codex 对照：

- `codex-rs/core/src/tasks/review.rs`
- `codex-rs/core/src/session/review.rs`
- `codex-rs/core/src/guardian/review_session.rs`
- `codex-rs/core/src/guardian/prompt.rs`

## Step 5：为什么有时候要手搓 Agent

高频问法：

```text
为什么不用 LangChain / LangGraph / CrewAI，非要自己实现？
```

建议回答：

- 框架适合快速验证，但生产系统需要控制状态、权限、日志、成本、上下文和失败恢复。
- 如果业务需要强安全、强审计、可恢复、可回放，就要理解并可能自定义 agent harness。
- 手搓不是从零造所有轮子，而是把核心边界掌握在自己手里：tool registry、context builder、approval、trace、eval。

## Step 6：动手练习

为同一个任务设计三种方案：

```text
任务：分析一个 PR，找出潜在 bug，并建议测试。
```

分别写：

1. Workflow 方案。
2. ReAct Agent 方案。
3. Multi-Agent 方案。

每个方案回答：

```text
适用条件:
主要风险:
如何停止:
如何记录 trace:
如何评估:
```

## Codex 对照源码

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/tools/handlers/plan.rs`
- `codex-rs/core/src/tasks/review.rs`
- `codex-rs/core/src/guardian`
- `codex-rs/core/src/agent`
- `codex-rs/core/src/tools/tool_dispatch_trace.rs`

## 推荐资料

- [小林面试笔记：Agent 面试专题](https://www.xiaolinnote.com/ai/)
- [Building effective agents 中文精读版](../../articles/building-effective-agents.zh.md)
- [A practical guide to building agents 中文精读版](../../articles/a-practical-guide-to-building-agents.zh.md)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)

## 验收标准

你完成本课时，应该能回答：

- Agent 和 Workflow 的核心区别是什么？
- ReAct、Plan-and-Execute、Reflection 分别适合什么场景？
- 为什么 Reflection 不能保证正确？
- 什么情况下应该手搓 agent harness？

