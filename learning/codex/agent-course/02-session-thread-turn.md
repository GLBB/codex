# 02 Session / Thread / Turn：把一次对话拆成状态机

## 本课目标

本课学习 Agent 的状态建模。不要把所有东西都叫“对话历史”。在生产系统里，至少要拆开：

- Thread：用户看见的一条工作流。
- Session：进程内运行时。
- Turn：一次用户输入到完成事件的生命周期。
- Item：可以持久化、回放或展示的事件单元。

学完以后，你应该能解释 Codex 为什么能 resume、fork、并发执行和持久化。

## Step 1：先画对象关系

先画这张图：

```text
Thread
  -> Session
      -> Turn
          -> Items
          -> Tool calls
          -> Output events
```

然后补上两个问题：

1. 哪些东西应该持久化？
2. 哪些东西只应该活在进程内？

## Step 2：阅读 Thread 管理

按顺序打开：

1. `codex-rs/core/src/thread_manager.rs`
2. `codex-rs/core/src/codex_thread.rs`
3. `codex-rs/core/src/thread_rollout_truncation.rs`

重点找：

- 新建 thread。
- resume thread。
- rollout/history 如何加载。
- 历史过长时如何截断。

## Step 3：阅读 Session 运行时

打开：

1. `codex-rs/core/src/session/session.rs`
2. `codex-rs/core/src/session/mod.rs`
3. `codex-rs/core/src/state/session.rs`
4. `codex-rs/core/src/state/service.rs`

观察 Session 里有哪些服务：

- 模型客户端。
- MCP connection manager。
- 工具上下文。
- guardian review session。
- 配置和权限状态。

这些通常不应该直接等同于“历史消息”。

## Step 4：阅读 Turn 状态

打开：

1. `codex-rs/core/src/session/turn.rs`
2. `codex-rs/core/src/state/turn.rs`
3. `codex-rs/core/src/session/input_queue.rs`

重点看：

- 当前 turn 如何接收输入。
- mailbox/input queue 何时进入当前 turn，何时延后。
- turn complete 之前要发出哪些事件。

## Step 5：动手练习

设计一个状态表：

| 状态 | 触发事件 | 下一个状态 | 是否持久化 |
| --- | --- | --- | --- |
| NewThread | user query | RunningTurn | 是 |
| RunningTurn | model tool call | WaitingTool | 部分 |
| WaitingTool | tool result | RunningTurn | 是 |
| RunningTurn | final answer | CompletedTurn | 是 |
| RunningTurn | cancel | AbortedTurn | 是 |

把它改成你理解的 Codex 版本，并标出对应源码。

## Codex 对照源码

- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/src/codex_thread.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/state/turn.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/turn.rs`

## 推荐资料

- [OpenAI Agents SDK Python](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK JavaScript](https://openai.github.io/openai-agents-js/)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)

## 验收标准

你完成本课时，应该能回答：

- Thread 和 Session 为什么不是一回事？
- 一次 Turn 为什么可能有多个工具调用和多次模型请求？
- 哪些状态必须持久化，哪些状态可以只在内存里？
- resume 一个历史 thread 时，最容易破坏哪些不变量？
