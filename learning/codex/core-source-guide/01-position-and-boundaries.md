# 1. 项目定位与边界

## 1.1 core 解决的问题

[`core/README.md`](</home/goulei1/code/codex/codex-rs/core/README.md:1>) 对 crate 的表述很短：它包含 Codex 各种 Rust UI 共用的业务逻辑。结合实现，更精确的说法是：`codex-core` 把“有状态、可调用工具、可恢复的模型对话”封装成线程式运行时。

它负责：

- 管理 Thread 和 Session 的生命周期；
- 将外部协议命令转成 Turn；
- 组合模型可见上下文与工具定义；
- 调用模型并消费 Responses 流；
- 路由工具，协调审批、沙箱、MCP 和执行环境；
- 产生面向 UI 的事件；
- 维护内存 History，并将可恢复记录写入 Rollout。

它不负责最终 UI 展示，也不把 app-server 的 JSON-RPC 作为自己的 API。协议数据类型大量位于 `codex-protocol`，模型目录位于 `codex-models-manager`，MCP 的连接管理位于 `codex-mcp`，持久化后端抽象位于 thread store / rollout 相关 crate。core 的职责是把这些能力编排成一次 Agent 运行。

## 1.2 主要调用者

当前最清晰的生产入口是 app-server。在 [`message_processor.rs`](</home/goulei1/code/codex/codex-rs/app-server/src/message_processor.rs:271>) 中查看 `ThreadManager::new`：app-server 把认证、模型管理器、应用缓存、环境管理器、扩展注册表、thread store 等依赖交给 core。随后，`thread/start` 或 `thread/resume` 获得一个 `CodexThread`。

一次 v2 `turn/start` 在 [`turn_processor.rs`](</home/goulei1/code/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:474>) 中被转换为 core 的 `Op::UserInput`，并在 [`turn_processor.rs`](</home/goulei1/code/codex/codex-rs/app-server/src/request_processors/turn_processor.rs:557>) 提交给 `CodexThread`。因此常见桌面/TUI 链路应理解为：

```text
UI -> app-server JSON-RPC -> ThreadManager/CodexThread -> Session
```

当前交互式 CLI 会进入 TUI；TUI 通过 [`AppServerSession`](</home/goulei1/code/codex/codex-rs/tui/src/app_server_session.rs:261>) 使用同进程或远程 app-server。因此从 UI 看是 RPC，从 app-server 内部看仍是 `CodexThread::submit` / `next_event`。

并非所有调用者都必须经过 app-server。[`thread-manager-sample`](</home/goulei1/code/codex/codex-rs/thread-manager-sample/src/main.rs:141>) 直接构造 manager、`start_thread`、运行一轮并 shutdown；[`codex-mcp-server`](</home/goulei1/code/codex/codex-rs/mcp-server/src/message_processor.rs:98>) 也直接持有 `ThreadManager`。教程用 app-server 举例，是因为它把外部请求到 core 协议的边界展示得最完整，而不是因为 core 依赖 app-server。

## 1.3 公开 API

先打开 [`lib.rs`](</home/goulei1/code/codex/codex-rs/core/src/lib.rs:1>)，只看 `pub use`，不要立刻进入每个模块。最重要的公开面是：

- [`ThreadManager`](</home/goulei1/code/codex/codex-rs/core/src/thread_manager.rs:195>)：创建、恢复、fork、查找并维护进程内 Thread；
- [`StartThreadOptions`](</home/goulei1/code/codex/codex-rs/core/src/thread_manager.rs:202>)：启动时的配置、初始历史、工具和持久化选择；
- [`NewThread`](</home/goulei1/code/codex/codex-rs/core/src/thread_manager.rs:131>)：启动结果，包含 thread id、`CodexThread` 和配置事件；
- [`CodexThread`](</home/goulei1/code/codex/codex-rs/core/src/codex_thread.rs:193>)：外部提交 `Submission`、读取 `Event` 的双向句柄；
- 协议中的 [`Submission`](</home/goulei1/code/codex/codex-rs/protocol/src/protocol.rs:174>)、`Op` 和 `Event`：调用者与 Session 之间的命令/事件语言。

`Session` 本身主要是 crate 内部编排对象。外部代码通常不应直接操纵 Session 的内部状态，而是持有 `CodexThread`：[`CodexThread::submit`](</home/goulei1/code/codex/codex-rs/core/src/codex_thread.rs:236>) 将命令送入 Session 的 submission channel，[`CodexThread::next_event`](</home/goulei1/code/codex/codex-rs/core/src/codex_thread.rs:540>) 从 event channel 读取结果。

这形成一个重要边界：**外部看见异步命令与事件，core 内部看见 Session 状态与 Task。**

## 1.4 依赖边界

把 core 想成“编排中心”比“基础库”更准确。它依赖较多，但不应继续吸收所有新概念。仓库的工程约束也明确要求尽量避免让 `codex-core` 继续膨胀。

阅读时可用下面的边界判断代码属于哪里：

| 问题 | 所属边界 |
| --- | --- |
| 一次 Turn 何时开始、何时继续采样 | core |
| `ResponseItem`、`Op`、`EventMsg` 的共享数据结构 | protocol |
| 模型能力、默认指令模板、上下文窗口信息 | models-manager / protocol model types |
| MCP server 连接、工具目录和 binding | codex-mcp；core 负责投影和调用 |
| shell 真正在哪个环境运行 | executor/environment 相关 crate；core 负责策略编排 |
| JSON-RPC 请求如何映射为 core 命令 | app-server |
| UI 如何渲染事件 | TUI、桌面或其他客户端 |

## 1.5 本章阅读停点

打开 [`codex_thread.rs`](</home/goulei1/code/codex/codex-rs/core/src/codex_thread.rs:193>)，读到 `submit`、`next_event` 和 `shutdown_and_wait`，确认它只是句柄而不是 Agent 主循环。然后回到 [`thread_manager.rs`](</home/goulei1/code/codex/codex-rs/core/src/thread_manager.rs:807>) 的 `start_thread`。看到它进入内部 `spawn_thread` 后即可停下；Session 初始化由第 3 章接着读。
