# 00 跑起来：建立源码、日志和学习工作台

## 本课目标

你先不要急着读所有源码。本课只做三件事：

1. 确认仓库能运行。
2. 知道一条 query 会留下哪些日志和事件。
3. 建立后续每课都能复用的观察方法。

学完以后，你应该能回答：我输入一句话后，Codex 在哪里接收、哪里执行、哪里记录、哪里持久化？

## 前置准备

在仓库根目录：

```bash
pwd
git status --short
```

进入 Rust 工程：

```bash
cd codex-rs
just --list
```

如果 `just` 不存在，先安装：

```bash
cargo install just
```

## Step 1：确认 CLI 能启动

先看帮助，不直接跑复杂任务：

```bash
cd codex-rs
just codex --help
just exec --help
```

你要观察：

- `codex` 是交互式入口。
- `exec` 更适合做一次性 query 实验。
- 首次运行可能会触发编译，时间较长是正常的。

## Step 2：打开 Query 流程文档

阅读：

- [Codex Query 处理流程](../query-processing-flow.md)

只读这几个小节：

1. 如何把项目跑起来。
2. 如何打开运行日志。
3. 一条 query 的主链路。

把里面出现的入口文件记下来，后面每课都会回到它们。

## Step 3：建立观察清单

每次读一条 Agent 链路，都用同一张清单：

| 观察点 | 你要找什么 |
| --- | --- |
| 输入入口 | 用户 query 从哪个 API、CLI 或协议进入 |
| 状态对象 | 当前 thread/session/turn 保存了什么 |
| 模型请求 | system、developer、history、tools 如何组成 |
| 工具调用 | 模型输出如何变成 tool handler |
| 权限边界 | 是否需要 approval、sandbox、network policy |
| 输出事件 | UI 或客户端收到哪些事件 |
| 持久化 | 哪些 item 会进入 rollout/history |
| 日志 | debug 时看哪个 log 或 trace |

## Step 4：只追一个最小 query

用一个简单 query 做后续课程样例：

```text
请查看当前目录有哪些文件，并告诉我 README 是做什么的
```

这个 query 好用，是因为它会触发典型 coding agent 行为：

- 需要理解工作区。
- 可能调用文件/命令工具。
- 需要把工具结果转成自然语言。
- 可能受权限和沙箱影响。

## Step 5：写学习笔记

新建自己的笔记，不提交也可以。记录这四项：

```text
query:
入口:
我看到的事件:
我还不懂的源码:
```

## Codex 对照源码

本课只需要知道这些入口，不要求读懂：

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/src/tools`
- `codex-rs/rollout-trace/README.md`
- `codex-rs/otel/README.md`

## 推荐资料

- [Codex Query 处理流程](../query-processing-flow.md)
- [Codex 生产级 Coding Agent 学习总览](../production-coding-agent-overview.md)
- [AI 素养与 Agent 学习资源](../../resources/ai-agent-learning-resources.md)

## 验收标准

你完成本课时，应该能做到：

- 能运行 `just codex --help` 和 `just exec --help`。
- 能说出后续追踪 query 时固定看哪 8 类观察点。
- 能找到 Query 流程文档，并知道它和本系列课程的关系。
- 能说出为什么学习 Agent 不能只看模型调用，还要看工具、状态、权限和日志。
