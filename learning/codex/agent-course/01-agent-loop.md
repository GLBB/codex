# 01 Agent Loop：从一条 query 看闭环

## 本课目标

Agent loop 是整套系统的心跳。本课你要沿着一条 query 看清：

```text
用户输入 -> 构建模型请求 -> 模型输出 -> 工具执行 -> 工具结果回填 -> 继续模型请求或结束
```

学完以后，你应该能画出 Codex 的核心 loop，并能解释为什么生产级 loop 比教学版复杂。

## Step 1：先建立最小模型

先不要看 Codex，自己写下教学版伪代码：

```text
messages = [system, user]
loop:
  response = model(messages, tools)
  if response.final_answer:
    return response.final_answer
  for tool_call in response.tool_calls:
    result = run_tool(tool_call)
    messages.append(result)
```

这段伪代码后面会被拆成很多生产问题：stream、并发、取消、失败重试、权限、日志、历史压缩。

## Step 2：打开 Codex 的主循环

按顺序阅读：

1. `codex-rs/core/src/session/turn.rs`
2. `codex-rs/core/src/tasks/regular.rs`
3. `codex-rs/core/src/session/turn_context.rs`

先找这些名字：

- `run_turn`
- `run_sampling_request`
- `try_run_sampling_request`
- `handle_output_item_done`

你不需要逐行读完，先把函数之间的调用方向画出来。

## Step 3：追踪模型流式事件

重点观察：Codex 不是等模型一次性返回完整 JSON，而是处理 stream event。

你要在源码里找：

- response created
- output item done
- completed
- error
- tool call output

写下每类事件会改变什么状态，或者会发给 UI 什么通知。

## Step 4：找退出条件

Agent loop 什么时候停？

至少列出这些情况：

- assistant 给出最终回答。
- 工具调用全部完成，继续下一轮模型请求。
- 用户取消。
- 模型或工具错误。
- 上下文或预算触发压缩、截断或终止。

对照 `turn.rs`，找出每种情况大概在哪里处理。

## Step 5：动手练习

写一个最小 `mini-agent` 伪实现，不要求接真实模型，可以用一个 fake model：

```text
第 1 次调用：返回 tool_call("list_files")
第 2 次调用：根据 tool_result 返回 final_answer
```

要求打印：

```text
[model request]
[model event]
[tool call]
[tool result]
[loop decision]
[final answer]
```

## Codex 对照源码

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/core/src/tasks/regular.rs`
- `codex-rs/core/src/tools/orchestrator.rs`
- `codex-rs/core/src/tools/events.rs`

## 推荐资料

- [Building effective agents 中文精读版](../../articles/building-effective-agents.zh.md)
- [A practical guide to building agents 中文精读版](../../articles/a-practical-guide-to-building-agents.zh.md)
- [Hugging Face Agents Course](https://huggingface.co/learn/agents-course/en)

## 验收标准

你完成本课时，应该能回答：

- Codex 的 Agent loop 主入口在哪里？
- 工具结果为什么必须回到下一次模型输入？
- 教学版 loop 和生产版 loop 差在哪些工程问题？
- 一次 turn 为什么可能包含多次模型请求？
