# 01 Agent Loop：模型怎样从“会说”变成“会做”

## 从一个矛盾开始

语言模型只能根据输入生成输出，本身不会读取你的磁盘。可 Coding Agent 却能查看文件、
修改代码和运行测试。中间缺少的就是 Agent Loop：运行时不断把模型的“动作建议”变成
真实工具结果，再让模型基于结果决定下一步。

```text
Think/Decide -> Act -> Observe -> Think/Decide
```

这常被称为 ReAct，但工程重点不在名字，而在这个循环怎样安全、可取消、可恢复地停止。

## 用一个完整例子理解循环

用户提出：

```text
README 里写的安装命令是什么？
```

第一次模型请求可能包含用户问题和两个工具：`list_files`、`read_file`。模型不能凭印象
回答，于是返回：

```json
{"tool": "read_file", "arguments": {"path": "README.md"}, "call_id": "call-1"}
```

运行时完成四件事：验证参数、检查权限、执行读取、生成结构化结果。然后把结果和相同
`call_id` 放进下一次模型输入：

```json
{
  "call_id": "call-1",
  "ok": true,
  "content": "...安装命令...",
  "truncated": false
}
```

第二次模型请求现在有了证据，模型才返回最终回答。一次用户 turn 因而包含两次模型请求：

```text
user
  -> model request #1
  -> tool call
  -> tool result
  -> model request #2
  -> final answer
```

如果不把工具结果回填，模型不知道动作是否成功，只能继续猜。

## 教学版 Loop

先写出最小可运行模型：

```text
history = [user_message]

while true:
  response = model(history, visible_tools)
  history.append(response)

  if response has final_answer:
    return final_answer

  for call in response.tool_calls:
    result = execute(call)
    history.append(result linked by call_id)
```

这段伪代码只有十行，却包含三个重要不变量：

1. 模型输出和工具结果都按顺序进入历史，历史不被偷偷重写。
2. 每个结果必须关联原 call id，否则模型无法知道它回答了哪个调用。
3. 只有明确满足停止条件才退出，不能把“暂时没有文本”误判成完成。

## 为什么生产 Loop 复杂得多

真实模型返回的是流，不是一次完整对象。运行时会依次看到 response created、文本增量、
output item done、response completed 或 error。工具也可能并行、等待用户审批或被取消。

因此生产 loop 还要处理：

- 流式 item 尚未完成时不能提前执行。
- 多个工具能否并行取决于它们是否有顺序和副作用依赖。
- 用户 steer 新输入时，当前循环要在安全边界吸收它。
- 工具失败必须作为 observation 返回，而不是伪装成系统崩溃。
- 上下文过长时先压缩，再继续采样。
- 取消时要停止新动作，并决定正在运行的工具如何收尾。
- 每次开始、增量、完成和错误都要映射为客户端事件。

## 停止不是一个 `break`

一个健壮 loop 至少区分：

| 情况 | 应怎样处理 |
| --- | --- |
| 模型给出最终回答 | 完成 turn，持久化 terminal event |
| 模型给出工具调用 | 执行后继续下一次 sampling |
| 工具返回可恢复错误 | 把错误交给模型，允许换方案 |
| 权限被拒绝 | 不执行副作用，把拒绝事实交给模型 |
| 用户取消 | 中断当前 turn，清理或等待正在运行的 runtime |
| 上下文达到阈值 | compact 后继续，或明确终止 |
| 模型 stream 失败 | 按错误类型重试、降级或结束 |
| 循环次数/预算耗尽 | 给出有证据的受限结果，不能无限运行 |

“最终回答”也不一定绝对终止：Stop hook 或新的用户输入可能要求继续。停止条件属于运行时
状态机，而不只是模型输出格式。

## 动手实验：用 Fake Model 看清两轮

不接真实模型，实现一个 fake model：

```text
call #1:
  assert history contains user message
  return tool_call("list_files", call_id="c1")

call #2:
  assert history contains tool_result(call_id="c1")
  return final_answer("README.md exists")
```

运行时打印：

```text
[turn started]
[model request #1]
[tool call c1]
[tool result c1]
[model request #2]
[final answer]
[turn completed]
```

再增加三个失败实验：工具返回 error；用户在工具完成前 cancel；fake model 连续五次返回
同一调用。你要分别设计“交给模型恢复”“中断”“达到 loop budget 后停止”的行为。

## 常见误区

- 把 tool call 当成已经执行。它只是模型提出的动作。
- 工具异常直接抛出并丢失。模型需要看到结构化失败才可能自我修正。
- 只限制 token，不限制轮数和副作用次数。无限循环仍可能很便宜但很危险。
- 并行所有工具。两个写操作或“生成文件后测试”有明确依赖。
- 收到 completed 就只保留最终文本。排障还需要中间 item 和调用证据。

## 理解之后再对照 Codex

从 `codex-rs/core/src/session/turn.rs` 的 `run_turn` 建立主循环，跟到
`run_sampling_request` 和 `try_run_sampling_request`。当流中出现完成的 output item，
进入 `codex-rs/core/src/stream_events_utils.rs` 的 `handle_output_item_done`，看它怎样把
item 变成工具调用、事件或上下文输入。工具执行链再对应
`codex-rs/core/src/tools/orchestrator.rs`。

读源码时只验证三件事：下一轮由什么条件触发、工具结果怎样进入下一次 request、哪些
分支结束 turn。验证完就停止。

## 本课验收

你应该能：

1. 画出一次用户 turn 中的两次模型请求，并标出 call id 的作用。
2. 解释工具失败为什么通常是 observation，而不是整个 Agent 崩溃。
3. 列出至少六种停止或继续条件。
4. 用 fake model 重放成功、失败、取消和循环预算四种场景。
