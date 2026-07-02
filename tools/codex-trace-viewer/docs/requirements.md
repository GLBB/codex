# Codex Trace Viewer 需求文档

> 隐私说明：rollout trace bundle 是本地诊断产物，可能包含完整 prompt、模型响应、工具参数、工具输出、终端输出、文件路径和用户数据。Viewer 必须默认把每个 bundle 当作敏感数据处理。

## 目标

基于 `codex-rollout-trace` 构建一个本地 Codex 专属 trace viewer。

Viewer 要让 Codex 的业务流程一眼可见：session、thread、turn、用户 query、完整 prompt、prompt 各个段落、model call、assistant message、tool call、terminal operation、compaction 和多 agent 交互。

第一版优先支持本地诊断工作流：

```text
rollout bundle -> replay_bundle/state.json -> Codex Trace Viewer
```

它不是 OpenTelemetry dashboard 的替代品。后续可以把 reduced rollout graph 投影成 OpenTelemetry GenAI spans，再接 Aspire、Langfuse、Phoenix 等平台。

## 需要回答的核心问题

Viewer 应该帮助工程师回答：

- 这次任务运行在哪个 session 和 thread 里？
- 哪个用户 query 或 pending input 触发了 turn？
- 实际发给模型的完整 prompt 是什么？
- prompt 中哪些段来自 base instructions、developer instructions、AGENTS.md、权限说明、skills、tools、历史消息、上下文和当前用户输入？
- 每次 inference call 使用了哪个 model 和 provider？
- 模型返回的是 assistant message、reasoning、tool call、compaction 还是 agent message？
- 哪个模型请求产生了某个 tool call？
- 每个 tool call 收到了什么参数，产生了什么结果，耗时多久？
- 某个 tool result 背后对应哪个 terminal operation 或 code-mode cell？
- 多 agent 场景下，哪个 parent thread spawn 或 message 了哪个 child thread，结果又回到了哪里？
- 延迟、失败、取消、重试、compaction 分别发生在哪一步？

## 范围

### 第一版范围内

- 从磁盘加载一个 rollout trace bundle。
- 优先读取 bundle 中已有的 `state.json`。
- 当 `state.json` 缺失时，可调用 `codex debug trace-reduce <trace-bundle>` 生成 reduced state。
- 展示 `state.json` reduced graph。
- 展示 thread、turn、inference、conversation item、tool call、terminal、code cell、compaction、interaction edge。
- 用户明确打开时展示 raw payload。
- 提供 Prompt Inspector，用于查看完整 prompt 和 prompt 分段。
- 支持本地搜索和过滤。
- 具备监测能力：当前 trace bundle 出现新的 Codex 请求、turn、model call、tool call 或 assistant message 时，Viewer 应自动刷新并让用户看到新内容。

### 第一版范围外

- 远程上传或托管 trace storage。
- 用户账号、分享、权限和多租户。
- 生产 telemetry ingestion。
- 完整 OpenTelemetry exporter。
- 编辑或 replay trace。
- 模型质量评估。

## 信息架构

UI 应提供五个主要视图：

- Timeline：选中 thread 或 turn 的业务时间线。
- Prompt：完整模型请求和 prompt 分段。
- Agent Graph：多 agent 场景下 parent / child thread 关系。
- Raw Payloads：reduced objects 引用的原始证据。
- Stats：耗时、token、数量、状态和失败摘要。

## 监测能力

Viewer 应支持持续观察 Codex 新请求。

第一层能力是监测当前打开的 active trace bundle：

- 监听 `trace.jsonl`、`state.json` 或 `payloads/` 目录变化。
- 当出现新的 raw event 或新的 reduced state 时，自动刷新 thread tree、timeline、Prompt、Agent Graph 和 Stats。
- 如果当前选中的是正在运行的 thread 或 turn，新节点应增量出现，不需要用户手动刷新页面。
- 新增 model call、tool call、assistant message、terminal operation 和 agent edge 应有清晰的视觉提示。
- 对正在写入中的 bundle 做 best-effort 展示；遇到不完整 payload 时显示 pending / partial 状态，而不是让整个 viewer 失败。

第二层能力是监测 trace root 下新增 bundle：

- 当 `CODEX_ROLLOUT_TRACE_ROOT` 下出现新的 rollout trace bundle 时，Viewer 应能在 trace 列表中自动发现。
- 用户可以切换到新的 bundle 查看新 session / thread。
- 如果开启“跟随最新请求”，Viewer 可自动跳到最新 active bundle 和最新 active turn。

监测能力必须保持 local-only，不应上传事件或请求远程服务。

## UI 布局

默认使用三栏布局。

```text
+----------------------+----------------------------------+----------------+
| Threads              | Timeline                         | Details        |
|                      |                                  |                |
| v root thread        | Turn 1 regular 42.3s             | Type           |
|   model: gpt-5-codex | +------------------------------+ | gen_ai.chat    |
|   status: completed  | | User Query                   | |                |
|                      | | "..."                        | | IDs            |
|   v Turn 1           | +------------------------------+ | thread.id      |
|     query            |                                  | turn.id        |
|     prompt           | +------------------------------+ | inference.id   |
|     model call #1    | | Prompt Build                 | |                |
|     tool: exec       | | 38 input items, 12 tools      | | Model          |
|     assistant msg    | +------------------------------+ | gpt-5-codex    |
|                      |                                  | provider       |
|   v child agent A    | +------------------------------+ | openai         |
|     Turn 1           | | Model Call                   | |                |
|     result           | | TTFT=1.2s input=42k          | | Tokens         |
|                      | +--------------+---------------+ | input: 42000   |
| Search               |                |                 | cached: 18000  |
| [ call_id / text ]   | +--------------v---------------+ | output: 3100   |
|                      | | Tool Call: exec_command      | |                |
| Filters              | | status=ok duration=230ms     | | Payload        |
| [x] messages         | +--------------+---------------+ | [view raw]     |
| [x] tool calls       |                |                 | [copy json]    |
| [x] model calls      | +--------------v---------------+ |                |
| [x] agent edges      | | Assistant Message            | |                |
|                      | | "..."                        | |                |
|                      | +------------------------------+ |                |
+----------------------+----------------------------------+----------------+
```

## Timeline 要求

Timeline 展示业务级节点，而不是只展示 raw events。

必须支持的节点类型：

- session / thread started 和 ended。
- turn started、completed、failed、cancelled、aborted。
- 用户 query 和 pending input。
- prompt build。
- model inference call。
- assistant message。
- reasoning 或 reasoning summary。
- function call、custom tool call、MCP tool call、tool-search call。
- tool result 和 tool failure。
- terminal command、write、poll、exit。
- code-mode cell execution 和 nested tool call。
- compaction trigger、request、response、installed checkpoint。
- 多 agent spawn、task delivery、send message、result、close。

每个节点应暴露：

- 稳定 id。
- 所属 thread id。
- 可用时的所属 turn id。
- 可用时的开始和结束时间。
- 状态。
- 关联 raw payload references。
- 可用时的 producer / consumer 关系。

## Prompt Inspector

Prompt inspection 是 P0 需求。

每个 model inference call 都应该有 Prompt tab，支持两种视图：

- Rendered View：面向人的 prompt 分段视图。
- Wire View：实际发送给 provider 的请求 JSON。

### Rendered View 分段

数据可用时，Viewer 应把 prompt 归类为以下段落：

- Request Metadata
  - model
  - provider
  - service tier
  - reasoning effort
  - reasoning summary mode
  - parallel tool calls
  - output schema
- System / Base Instructions
- Developer Instructions
- AGENTS.md Instructions
- Permission and sandbox instructions
- Collaboration mode instructions
- Skill instructions
- Plugin and app instructions
- Environment context
- Thread / session metadata
- Conversation history
- 历史中已有的 tool calls
- 历史中已有的 tool outputs
- Current user query
- Pending user input
- Model-visible tool definitions
- 之前模型响应返回的 additional tools
- Output schema and strictness

### Prompt Section Metadata

每个 prompt section 应展示：

- section id。
- kind：system、developer、user、assistant、tool、context、tool_definition、schema 或 metadata。
- source：base_instructions、config、AGENTS.md、permissions、skills、plugins、apps、conversation_history、current_query、pending_input、tool_registry、model_response、compaction 或 unknown。
- 可用时的 role。
- 字符数。
- 可用时的估算 token 数。
- 是否被包含在实际请求中。
- 可用时的 raw payload reference。

### 完整 Prompt 要求

Prompt Inspector 必须支持：

- 复制完整 request JSON。
- 复制某个 prompt section。
- 展开和折叠长 section。
- 在 prompt 内搜索。
- 从 prompt history item 跳转到 timeline 中的 conversation item。
- 从 tool definition 跳转到使用该 tool 的 tool calls。
- 可用时高亮 compacted 或 summarized history。

### 隐私默认值

- 长内容默认折叠。
- raw payload 只有在用户明确操作后才打开。
- UI 明确提示 prompt 和 tool output 可能包含敏感数据。
- Viewer 不上传 bundle 内容。

## Agent Graph 要求

Agent Graph tab 用于展示多 agent thread 关系。

它应展示：

- root thread。
- spawned child threads。
- parent thread id 和 child thread id。
- 可用时的 agent nickname、role、path。
- spawn、task delivery、follow-up task、send message、result、close 边。
- 每条边对应的 tool call 或 conversation item。
- 每个 thread 的状态和耗时。

示例：

```text
root thread
  |
  | spawn_agent(task="scan telemetry")
  v
child: explorer
  |
  | assistant result
  v
root thread
  |
  | followup_task
  v
child: reviewer
```

点击边时，应打开产生该边的 tool call、delivered message 或 result payload。

## 搜索和过滤

Viewer 应支持搜索：

- thread id。
- turn id。
- inference call id。
- tool call id。
- tool name。
- agent path 或 nickname。
- assistant text。
- user query text。
- prompt section text。
- raw payload id。

过滤条件应包括：

- thread。
- turn。
- status。
- model。
- tool name。
- node type。
- agent edge type。
- failed 或 slow operations。

## Stats 要求

Stats tab 应汇总：

- 总耗时。
- turn 耗时。
- inference 耗时。
- tool 耗时。
- terminal operation 耗时。
- 按 inference 和 turn 统计 token usage。
- cached input tokens。
- output tokens。
- reasoning output tokens。
- tool call 数量。
- failed tool call 数量。
- 可用时的 retry 数量。
- compaction 数量。
- child thread 数量。

## 数据模型预期

第一版应尽量复用 existing reduced graph：

- `AgentThread`
- `CodexTurn`
- `ConversationItem`
- `InferenceCall`
- `ToolCall`
- `CodeCell`
- `TerminalOperation`
- `Compaction`
- `InteractionEdge`
- `RawPayloadRef`

第一版可以先从 inference request payload 推断 prompt sections。如果推断不够准确，再在后续给 rollout trace 增加 diagnostic-only prompt section metadata，但不能改变模型请求行为。

未来可能引入的 trace-only model：

```text
PromptTrace
  inference_call_id
  raw_request_payload_id
  sections: Vec<PromptSection>

PromptSection
  id
  kind
  label
  source
  role
  content_ref
  char_count
  estimated_tokens
  included
```

这些 metadata 只用于诊断，不影响 prompt 构造。

## 实现阶段

### Stage 1：离线 Viewer MVP

- 增加本地命令，例如 `codex debug trace-view <trace-bundle>`。
- 加载并 reduce 一个 bundle。
- 启动本地 Web UI。
- 展示 thread tree、timeline、details、prompt wire view、raw payload view 和基础搜索。

### Stage 2：业务流程 Viewer

- 增加 rendered prompt sections。
- 增加 agent graph。
- 增加 tool / result / terminal 关系导航。
- 增加 stats 和 latency summary。
- 增强过滤和 deep links。

### Stage 3：导出和实时调试

- 支持 active bundle live tailing。
- 支持监测 trace root 下新增 bundle，并自动发现新的 Codex 请求。
- 支持“跟随最新请求”模式，自动跳转到最新 active thread / turn / model call。
- 支持从 reduced graph 导出 OpenTelemetry GenAI spans。
- 可选导出到 Aspire、Langfuse、Phoenix 等 dashboard。
- 如果 trace 离开本机，增加更强的 redaction 和 sharing controls。

## 非功能要求

- local-first。
- 对 trace bundle 只读。
- 对 incomplete 或 partially written bundle 做 best-effort 渲染。
- 大 payload lazy-load。
- 长 prompt 和大量 tool calls 下 UI 仍可用。
- Viewer 不需要网络访问。
- Viewer 不修改 raw trace evidence。
- 明确区分 model-visible conversation 和 runtime observations。
- 监测模式下 UI 应能自动看到新请求、新 turn、新 model call、新 tool call 和新 assistant message。

## 开放问题

- 第一版是否完全作为 TypeScript 独立工具交付，还是同时提供 `codex debug trace-view` wrapper？
- prompt section metadata 应加到 `codex-rollout-trace`，还是第一版先从 raw request payload 推断？
- 实现开始后，viewer 应继续放在 `tools/codex-trace-viewer`，还是迁入 `codex-rs/cli` 或新 crate？
- section-level token 估算应复用现有 history token estimation，还是先展示字符数？
- raw payload rendering 是否需要本地 redaction profiles？
