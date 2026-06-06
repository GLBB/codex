# 07 Multi-Agent、Guardian 与 Eval：走向生产系统

## 本课目标

前面 7 课让你理解单个 Agent 怎么运行。本课把它推向生产系统：

- Multi-Agent：把大任务拆给子 agent。
- Guardian / Review：让审查者保护危险动作或代码质量。
- Observability：知道系统到底发生了什么。
- Eval：用回放和测试防止 Agent 行为退化。

## Step 1：阅读 Multi-Agent

打开：

1. `codex-rs/core/src/agent/control.rs`
2. `codex-rs/core/src/agent/registry.rs`
3. `codex-rs/core/src/agent/control/spawn.rs`
4. `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
5. `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
6. `codex-rs/core/src/tools/handlers/multi_agents/send_input.rs`

观察：

- 父 agent 如何 spawn 子 agent。
- 子 agent 继承哪些上下文。
- 子 agent 和父 agent 如何通信。
- wait 的超时和失败如何处理。

## Step 2：阅读 Guardian / Review

打开：

1. `codex-rs/core/src/guardian/mod.rs`
2. `codex-rs/core/src/guardian/prompt.rs`
3. `codex-rs/core/src/guardian/review_session.rs`
4. `codex-rs/core/src/tasks/review.rs`
5. `codex-rs/core/src/session/review.rs`

区分两种审查：

- 对代码改动做 review。
- 对危险动作做 approval review。

思考：审查者本身也是 agent，它需要什么上下文？它应该被限制什么权限？

## Step 3：阅读 Observability

打开：

1. `codex-rs/otel/README.md`
2. `codex-rs/rollout-trace/README.md`
3. `codex-rs/core/src/tools/tool_dispatch_trace.rs`
4. `codex-rs/app-server/src/app_server_tracing.rs`

观察三层信号：

- 模型请求和响应。
- 工具调用和结果。
- 协议事件和 UI 展示。

## Step 4：阅读测试和回放

打开：

1. `codex-rs/core/tests/suite`
2. `codex-rs/app-server/tests`
3. `codex-rs/tui/src/markdown_render_tests.rs`
4. `codex-rs/tui/src/app/history_ui_tests.rs`

重点看测试如何 mock 模型 SSE 事件，以及如何断言工具调用、输出事件、审批和 UI。

## Step 5：动手练习

给 `mini-agent` 增加 4 个回放样例：

| 样例 | 期望 |
| --- | --- |
| 普通 read file | 成功调用工具并总结 |
| 工具失败 | 错误回填给模型，模型给出解释 |
| 权限拒绝 | 不执行危险命令，给出替代方案 |
| 上下文过长 | 触发压缩或截断，并记录原因 |

再设计一个 guardian：

```text
review(action):
  if action touches network or destructive command:
    return ask_or_deny with reason
  return allow
```

## Codex 对照源码

- `codex-rs/core/src/agent`
- `codex-rs/core/src/tools/handlers/multi_agents_v2`
- `codex-rs/core/src/guardian`
- `codex-rs/core/src/tasks/review.rs`
- `codex-rs/otel/README.md`
- `codex-rs/rollout-trace/README.md`
- `codex-rs/core/tests/suite`
- `codex-rs/app-server/tests`

## 推荐资料

- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [OpenAI Evals](https://github.com/openai/evals)
- [LangSmith / LangGraph observability](https://docs.langchain.com/langsmith/home)
- [Building effective agents 中文精读版](../../articles/building-effective-agents.zh.md)

## 验收标准

你完成本课时，应该能回答：

- 什么时候该用子 agent，什么时候只是普通工具调用？
- Guardian 为什么应该有独立上下文和更小权限？
- Agent 系统至少要记录哪些 trace 才方便排障？
- 为什么 eval 要覆盖失败路径，而不只是成功路径？
