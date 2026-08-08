# 8. 扩展机制、阅读路线与心智模型

扩展机制很多，但它们没有另造一条 Agent 主循环。大多数扩展只在四个接缝进入：构造上下文、构造工具、包围生命周期、处理工具调用。

## 8.1 接入点总表

| 机制 | 发现/初始化 | 注入主链的位置 | 是否条件分支 |
| --- | --- | --- | --- |
| MCP | Session 初始化 runtime；可刷新 | Step 捕获 binding；`build_tool_router` 加 specs/handlers；MCP handler 执行 | 是，配置/提及/可用性决定 |
| Skills | Session 启动 warmup，TurnContext 持有 snapshot | Turn 解析显式 mention，注入 skill instructions；依赖可要求 MCP server | 是，不是所有 skill 每轮注入 |
| Plugins | PluginsManager 加载 capabilities、hooks、MCP/app 配置 | Turn 注入 plugin instructions；Step 贡献 MCP/apps/tools；构造 hooks | 是，按启用与提及 |
| Hooks | `build_hooks_for_config` 合并配置和 plugin hooks | session/turn/user-prompt 生命周期，以及 pre/post tool use | 是，可关闭或拒绝/改写 |
| Extensions | 上层传入 `ExtensionRegistry` | thread/turn context、turn input、WorldState、tools、turn item、lifecycle contributor | 是，注册表可为空 |
| 多 Agent | Session 持有 AgentControl，WorldState 提示模式 | Router 暴露 spawn/send/wait 等工具；子 Agent 也是新 Thread/Session | 是，feature/mode/depth 控制 |

## 8.2 MCP

MCP 在三个时间尺度出现：

1. Session 启动：根据配置与 Plugins 生成 runtime 配置；
2. Turn 开始：[`required_mcp_servers_for_input`](</home/goulei1/code/codex/codex-rs/core/src/session/turn.rs:628>) 从 plugin/skill/tool mention 推导必须等待的 servers；
3. Step 捕获：固定当前 `McpBinding`，并由 tool plan 投影为本次请求的 tools。

这解释了为什么 MCP 同时像“启动服务”又像“动态工具”：连接生命周期较长，但每次模型采样看到的是一个精确快照。

阅读 MCP 时到 [`McpHandler::handle_call`](</home/goulei1/code/codex/codex-rs/core/src/tools/handlers/mcp.rs:154>) 返回 `McpToolOutput` 即停。server transport、OAuth、resource APIs 是 MCP 子系统支线。

## 8.3 Skills

Session 初始化在 [`session.rs`](</home/goulei1/code/codex/codex-rs/core/src/session/session.rs:970>) 并行预热 Plugins 与 Skills。Turn 开始时，[`build_skills_and_plugins`](</home/goulei1/code/codex/codex-rs/core/src/session/turn.rs:729>) 根据用户显式 mention、connector 名称和当前 snapshot 选择 skill。

Skill 的核心产物通常是模型可见的 `ResponseItem`，不是 Rust handler。Skill 声明的 MCP 依赖可以促使 runtime 安装/等待相应 server；这才把“说明书”与“工具能力”连接起来。

不要把扫描到的所有 `SKILL.md` 都视为 Prompt 内容。启动 warmup 建索引/缓存，Turn 选择后才注入正文。

## 8.4 Plugins

Plugin 是能力包，而不是一种独立的模型消息。它可以贡献：

- developer-role plugin instructions；
- MCP server 注册和 app connector；
- hooks；
- capabilities/skills 等可发现信息。

`required_mcp_servers_for_input` 先刷新 plugin 与 MCP 对齐状态，再从显式 plugin mention 得到 server 名称。`build_skills_and_plugins` 构造当轮注入项；`build_tool_router` 使用已经加载的 MCP/app/extension 结果生成工具。

因此 Plugin 横跨启动、Turn 与 Step，但仍服从主链的上下文/工具两个入口。

## 8.5 Hooks

[`build_hooks_for_config`](</home/goulei1/code/codex/codex-rs/core/src/session/mod.rs:4166>) 把 legacy notify、feature 设置、信任策略与 plugin hook sources 合成 `Hooks`。运行时可见两类调用：

- 生命周期 hooks：session start/stop、user prompt、Turn stop 等；
- 工具 hooks：Registry 内的 pre-tool-use 与 post-tool-use。

Pre hook 可以拒绝调用或重写输入，所以它位于 handler 之前；post hook 看到统一 tool response。Hooks 不直接改写整个 History，产生的模型可见信息仍需通过标准记录边界。

## 8.6 Extensions

Extensions 是 typed contributor 机制。上层创建 `ExtensionRegistry<Config>` 并交给 ThreadManager/Session。当前主流程中的代表性接点有：

- [`build_extension_turn_input_items`](</home/goulei1/code/codex/codex-rs/core/src/session/turn.rs:871>)：根据本轮用户输入和环境贡献上下文；
- [`build_world_state_for_step`](</home/goulei1/code/codex/codex-rs/core/src/session/world_state.rs:31>)：追加可 diff 的 WorldState sections；
- [`build_tool_router`](</home/goulei1/code/codex/codex-rs/core/src/tools/spec_plan.rs:159>)：注册 extension tool executors；
- [`apply_turn_item_contributors`](</home/goulei1/code/codex/codex-rs/core/src/stream_events_utils.rs:210>)：在事件输出前丰富 `TurnItem`；
- Session/Task 生命周期 contributor：在相应开始、结束边界运行。

Extension data 分为 session、thread、turn/step 等 scope。阅读具体 extension 时先确认它拿到哪个 data store，避免误以为一次 Turn 写入的数据自动跨恢复持久化。

## 8.7 多 Agent

多 Agent 对父 Agent 表现为一组工具，工具规格在 [`spec_plan.rs`](</home/goulei1/code/codex/codex-rs/core/src/tools/spec_plan.rs:38>) 引入，handlers 位于 `tools/handlers/multi_agents*`。执行 spawn 时，AgentControl 最终让 ThreadManager 创建子 Thread/Session；send/wait/resume 等通过 agent 状态和 inter-agent communication 协调。

从父 Turn 视角，它仍是普通工具循环：模型 call → handler → output → 再采样。从系统视角，handler 的副作用是启动另一个同构 Session。WorldState 的 multi-agent sections 负责告诉模型当前模式、用法和已有环境/子 Agent。

第一次阅读到 spawn handler 调用 AgentControl 即停，不要同时递归跟入子 Session；子 Session 的运行方式就是本教程前七章。

## 8.8 30 分钟快速理解路线

目标：能画出请求主链，不追任何安全或恢复细节。

1. 打开 [`CodexThread`](</home/goulei1/code/codex/codex-rs/core/src/codex_thread.rs:193>)，只看 `submit` 与 `next_event`。
2. 打开 [`submission_loop`](</home/goulei1/code/codex/codex-rs/core/src/session/handlers.rs:703>)，只跟 `Op::UserInput`。
3. 打开 [`RegularTask::run`](</home/goulei1/code/codex/codex-rs/core/src/tasks/regular.rs:38>)，确认 Turn 生命周期。
4. 打开 [`run_turn`](</home/goulei1/code/codex/codex-rs/core/src/session/turn.rs:151>)，找出 Step 捕获、History、采样循环和 `needs_follow_up`。
5. 打开 [`Prompt`](</home/goulei1/code/codex/codex-rs/core/src/client_common.rs:16>) 与 [`handle_output_item_done`](</home/goulei1/code/codex/codex-rs/core/src/stream_events_utils.rs:288>)。

到这里停止。你应能用两分钟口述“一次无工具请求”和“一次有工具请求”。

## 8.9 半天掌握主链路线

目标：能定位 Prompt 或工具循环 bug。

上午前半按第 3、4 章完整跟一次 start + turn；后半依次阅读：

1. `TurnContext` 与 `StepContext` 字段；
2. `build_world_state_for_step` 与首轮/差量注入；
3. `ContextManager::for_prompt`；
4. `build_prompt` 到 `client.rs` Responses 请求；
5. `ToolRouter`、`ToolCallRuntime`、Registry；
6. Shell handler 到 ToolOrchestrator；
7. `record_conversation_items` 和 `send_event_raw`。

暂时不读 resume reconstruction 的逆向扫描、各 OS sandbox backend、MCP transport 和 multi-agent handlers。

## 8.10 深入贡献代码路线

目标：能修改 core 并设计覆盖行为的测试。

在半天路线基础上：

1. 阅读 [`core/tests/suite`](</home/goulei1/code/codex/codex-rs/core/tests/suite/mod.rs:1>) 的集成测试入口，理解 `test_codex` 和 mock Responses；
2. 阅读 `stream_events_utils` 与工具相关 `*_tests.rs`，确认 item/event 时序；
3. 阅读 compaction 与 rollout reconstruction，尤其 replacement history 和 WorldState baseline；
4. 针对修改点再进入具体扩展、MCP、sandbox 或 executor 子系统；
5. 若改变 Agent 逻辑，优先添加 core integration test，断言完整 outbound Responses input 和事件序列；
6. 若改 app-server 对外行为，再从 JSON-RPC v2 API 补集成覆盖。

贡献时始终检查三类不变量：模型可见上下文是否有界且可恢复；工具 spec 与执行 router 是否来自同一 Step；外部事件/API 是否出现兼容性变化。

## 8.11 最终心智模型

可以把 core 记成四层：

```text
控制层：ThreadManager -> CodexThread -> Session submission/event channels
回合层：RegularTask -> TurnContext -> run_turn -> StepContext
推理层：ContextManager + WorldState -> Prompt -> ModelClient
行动层：ToolRouter -> Registry/Hooks -> approval/sandbox/MCP/executor
持久层：ResponseItem/EventMsg/TurnContext/WorldState -> Rollout
```

最重要的不变量是：

- 一个 Thread 可跨 Session 恢复；一个 Turn 可包含多次 Step/采样；
- Session 同时最多一个活跃 task，工具是否并发由 ToolCallRuntime 单独控制；
- History 是模型上下文，不是完整审计日志；Rollout 才是恢复材料；
- 首轮注入完整上下文，后续 WorldState 以差量进入 History；
- 模型看到的 tool specs 与执行 call 的 ToolRouter 绑定在同一个 StepContext；
- tool call 和 output 都进入 History，下一次采样才构成 Agent 循环；
- compaction 重写 History，但以 checkpoint + baseline 保留可恢复语义；
- UI 接收的是 core 规范化事件，不是 Responses stream 的裸透传。

## 8.12 容易误解的地方

- `Thread`、`Session` 不是绝对同义词：前者是持久身份，后者是运行实例。
- `Step` 不是一条 tool call；它是一次采样及其所承诺工具环境的请求级快照。
- `Prompt` 不是某个 `.md` 文件；它是 `instructions + input + tools + schema` 的结构化组合。
- AGENTS.md、Skills 与用户自然语言都可使用 user role，但来源和 marker 不同。
- MCP、Plugins、Skills 不是并列的同一种扩展：Plugin 可提供 MCP/hooks/skills，Skill 可声明 MCP 依赖。
- approval 不等于 sandbox，sandbox 也不等于 executor。
- resume 不是把 Rollout 原样塞回模型，而是重放出规范化 History 和状态基线。

## 8.13 可继续研究的问题

完成本教程后，适合选择一个问题纵向深入：

- Responses WebSocket 增量请求如何复用 `ModelClientSession`？
- 不同 model capabilities 如何改变 tools、input modalities 和 base instructions？
- remote environment 如何让 app-server 与 executor 跨 OS？
- hooks 的拒绝/改写怎样影响审计和 tool output？
- referenced fork 与分页 subagent 如何减少复制？
- rollout reconstruction 如何演进为真正 lazy reverse loader？

若你现在能从 `Op::UserInput` 一路讲到 `TurnComplete`，并能指出工具结果、WorldState diff 与 compaction checkpoint 分别写在哪里，就已经能够独立回答：**一次 Codex 用户请求如何在 core 中运行。**
