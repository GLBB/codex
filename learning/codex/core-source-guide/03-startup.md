# 3. 启动流程

本章从 `ThreadManager::start_thread` 跟到 Session 可以接收命令为止。先看新建 Thread 的主路径，再标出 resume/fork 的差异。

## 3.1 外部准备 ThreadManager

app-server 在 [`message_processor.rs`](../../../codex-rs/app-server/src/message_processor.rs#L271) 构造 `ThreadManager`。输入不是一份简单 `Config`，还包括 `AuthManager`、`ModelsManager`、apps 缓存、环境管理器、扩展注册表、用户指令 provider、thread store 和 agent store 等共享服务。

输出是进程级 manager。它不立即创建模型会话；这些服务会在 spawn Session 时注入。

阅读到 `ThreadManager::new` 的参数结束即可停下，不要进入各 manager 的构造实现。此处只需确认：**依赖由上层组装，core 负责使用。**

## 3.2 `start_thread` 只统一入口参数

打开 [`ThreadManager::start_thread`](../../../codex-rs/core/src/thread_manager.rs#L807)。它接收 `StartThreadOptions`，为“新 Thread”选择 `InitialHistory::New`，再进入内部 spawn 路径。resume 和 fork 最终也复用同一套 Session spawn，只是初始历史与持久化语义不同：

- [`resume_thread_from_rollout`](../../../codex-rs/core/src/thread_manager.rs#L871) 先获得已有 Rollout；
- [`resume_thread_with_history`](../../../codex-rs/core/src/thread_manager.rs#L891) 使用 `InitialHistory::Resumed`；
- [`fork_thread`](../../../codex-rs/core/src/thread_manager.rs#L1031) 选取源 Thread 的历史边界；
- [`fork_thread_from_history`](../../../codex-rs/core/src/thread_manager.rs#L1074) 使用 `InitialHistory::Forked`。

这些函数的输出都是 `NewThread`，调用者由此拿到 thread id、`CodexThread` 和初始配置事件。

## 3.3 `spawn_thread` 组装 SessionSpawnArgs

继续到 [`ThreadManagerState::spawn_thread`](../../../codex-rs/core/src/thread_manager.rs#L1607)。这是 ThreadManager 与 Session 的真正交界：

1. 解析本地/远程执行环境；
2. 对 resume 做活跃 Thread 去重；
3. 从 user instructions provider 获取调用者级指令；
4. 推导 multi-agent 版本和 originator；
5. 把 manager 中的共享服务、启动配置和 `InitialHistory` 放入 `SessionSpawnArgs`；
6. 调用 [`Session::spawn`](../../../codex-rs/core/src/session/mod.rs#L493)；
7. 用返回的 `Session` 与 I/O 构造 `CodexThread`，登记到 manager。

这里的输入是“上层依赖 + 本 Thread 的启动选择”，输出是“已经运行 submission loop 的 Session”。看到 `Session::spawn` 调用后先停，不要在 ThreadManager 内继续研究列表或归档 API。

## 3.4 `Session::spawn_internal` 冻结会话级配置

打开 [`Session::spawn_internal`](../../../codex-rs/core/src/session/mod.rs#L517)。初始化顺序很重要：

1. 创建 bounded submission channel 和 event channel；
2. 加载 exec policy；
3. 刷新模型目录并选择默认/指定模型；
4. 决定 base instructions；
5. 从旧历史恢复 dynamic tools（若启动参数未显式提供）；
6. 生成 `SessionConfiguration`；
7. 调用 `Session::new` 构造实际状态；
8. spawn `submission_loop`。

Base Instructions 的优先级在此明确：配置中的 override 优先，其次是恢复历史的 session metadata，最后是 `ModelInfo::get_model_instructions`。因此“默认 Prompt”不是永远从一个固定 Markdown 文件读取。

模型信息也不是简单硬编码在 core。`ModelsManager` 负责可刷新模型目录；`ModelInfo` 提供默认指令、上下文窗口、输入模态和工具能力。看完 `SessionConfiguration` 的构造即可进入下一步。

## 3.5 `Session::new` 并行初始化持久化与能力

打开 [`Session::new`](../../../codex-rs/core/src/session/session.rs#L511)。这个函数很长，第一次只读五段：

### A. 确定身份和持久化

Session 根据 `InitialHistory` 确定 thread/session id。新建和 fork 使用 [`LiveThread::create`](../../../codex-rs/core/src/session/session.rs#L682) 或带继承上下文的创建路径；resume 使用 [`LiveThread::resume`](../../../codex-rs/core/src/session/session.rs#L701)。这里建立了后续 Rollout append 的落点。

### B. 初始化 auth、MCP 和插件投影

持久化初始化与 auth/MCP 配置准备并行执行。MCP 并非等第一次 tool call 才发现：Session 启动时会根据配置和已加载插件得到初始 MCP 投影。不过 server 的“当前精确 binding”仍会在 StepContext 捕获时刷新，因此启动期配置与采样期快照要区分。

### C. 初始化 shell、环境和项目指令管理器

Session 建立 shell/environment 相关状态，并创建 [`AgentsMdManager`](../../../codex-rs/core/src/agents_md_manager.rs#L11)。AGENTS.md 在启动期有缓存/预热，但真正用于某一步的内容由 `capture_step_context` 刷新，所以不能把它理解成只读取一次的静态字符串。

### D. 预热 Skills 与 Plugins，组装 Hooks/Extensions

初始化会触发 skills/plugin load 的 warmup，并根据 plugin 结果组装 hooks。Extensions 注册表由上层传入，Session 保存 thread 级 extension data；具体 turn/step contribution 在运行时再调用。

这里要区分“发现/缓存”和“注入”：启动期让资源可用，不代表所有 Skill/Plugin 正文已经塞进模型历史。实际选择与注入发生在 Turn 主链路。

### E. 发布配置并开始接收命令

Session 构造完成后发送 `SessionConfigured`，安装初始 MCP runtime，启动 worker/prewarm，最后调用 [`record_initial_history`](../../../codex-rs/core/src/session/mod.rs#L1294)。`Session::spawn_internal` 随后启动 [`submission_loop`](../../../codex-rs/core/src/session/handlers.rs#L703)。

至此外部可通过 `CodexThread` 提交命令。

## 3.6 新建、恢复和 fork 在启动末尾的区别

`record_initial_history` 是三条路径重新汇合的关键点：

| InitialHistory | 行为 |
| --- | --- |
| `New` / `Cleared` | 不立刻写初始模型上下文；等首个真实 Turn 合并 per-turn override 后再注入 |
| `Resumed` | 调用 rollout reconstruction 重建 History、上一轮设置、WorldState 基线和 token 信息 |
| `Forked` | 重建同样的内存状态，再按 referenced/copy 持久化策略为新 Thread 建立本地记录 |

“延迟首轮上下文注入”很关键。否则 app-server 在 `turn/start` 传入的模型、sandbox 或 developer instructions 覆盖会晚于已经写入历史的初始上下文，造成历史与实际设置不一致。

## 3.7 各信息何时加载

| 信息 | 首次准备 | 真正用于模型请求 |
| --- | --- | --- |
| Config / model selection | `spawn_internal` | `TurnContext` 创建时合并 per-turn settings |
| Base Instructions | `spawn_internal` 决定会话默认值 | 每次 `build_prompt` 读取 |
| MCP 配置/runtime | `Session::new` 初始化、启动后可刷新 | `capture_step_context` 固定本 Step binding 和 tools |
| AGENTS.md | Session 启动时建立 manager/预热 | 每个 Step 刷新并进入 WorldState |
| Skills | 启动期扫描/缓存 | Turn 开始时按显式引用等规则选择并注入 |
| Plugins | 启动期加载 capability/hook/MCP 投影 | Turn 中选择指令；Step 中贡献工具和 WorldState |
| 历史记录 | `InitialHistory` 传入 | `record_initial_history` 重建到 ContextManager |
| Extensions | manager 创建时注册 | Session/Turn/Step 的对应 contributor 调用点 |

## 3.8 本章阅读停点

在 `Session::new` 中读到 `record_initial_history` 即停。不要在第一次阅读时进入 tracing、analytics、remote environment 或每个 prewarm future。此时你应能解释：启动不是“创建一个 HTTP client”，而是建立 I/O、会话配置、持久化、能力目录和可执行主循环。
