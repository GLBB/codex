# 实现方案

## 结论

第一版选择 TypeScript 全栈更合理。

Codex Trace Viewer 当前是 `tools/codex-trace-viewer` 下的独立二次开发工具，核心难点在 UI 体验和业务数据组织，而不是 Codex runtime 集成。第一阶段直接读取 `state.json` 和 `payloads/*.json`，可以最快验证 thread、turn、prompt、model call、tool call、多 agent 和监测体验。

Rust 深度集成后置：等产品形态稳定后，再考虑直接调用 `codex_rollout_trace::replay_bundle` 或接入 `codex debug trace-view`。

## 目标

构建一个 local-first 的 Codex Trace Viewer，把 rollout trace bundle 展示成可读的 Codex 业务流程 UI。

Viewer 重点展示：

- session / thread / turn
- query
- 完整 prompt
- prompt 分段
- model call
- assistant message
- reasoning / summary
- tool call / tool result
- terminal operation
- compaction
- 多 agent edge
- 新请求自动监测

初始实现不改变 Codex runtime 行为，只消费现有 rollout trace 证据和 reducer 输出。

## 技术原则

- 本地优先，只读访问 trace bundle。
- 默认把 trace bundle 当作敏感数据。
- 第一阶段只依赖 `state.json`，避免接入 Rust workspace。
- 优先使用 viewer DTO，避免 UI 直接耦合 raw JSON。
- raw payload 和长文本 lazy-load。
- 明确区分 model-visible conversation 和 runtime observation。
- 先做离线 viewer，再加入 active bundle 监测和自动刷新，最后再考虑 Rust 深集成和 OTEL export。

## 技术选型

### 语言和运行时

使用 TypeScript + Node.js。

原因：

- Viewer 的主要复杂度是前端交互和数据展示。
- `state.json`、raw payload 都是 JSON，TypeScript 读取和转换成本低。
- 前后端共用类型、schema、fixture 和测试工具，开发速度更快。
- 可以完全放在 `tools/codex-trace-viewer` 下，不改 Codex 既有 workspace。
- 后续可以通过 shell 调用 `codex debug trace-reduce <bundle>`，无需第一版直接链接 Rust。

### 前端

推荐：

- Vite
- React
- TypeScript
- React Router 或轻量 tab 状态管理
- `@tanstack/react-virtual`：长 timeline、长 prompt section 虚拟化
- React Flow：Agent Graph，第一版也可先用树视图
- 普通 CSS / CSS modules：先避免引入大型设计系统

### 本地服务端

推荐：

- Fastify 或 Express
- Node.js `fs/promises` 读取 bundle、state、payload
- `chokidar` 或轮询做文件监测
- Server-Sent Events 做 live update 推送
- `child_process.spawn` 调用 `codex debug trace-reduce`

Fastify 优点是 schema 和性能更好；Express 优点是最简单。第一版如果追求速度，可以选 Express；如果想 API 边界更清晰，选 Fastify。

### Schema 和类型

推荐：

- Zod 校验 `state.json`、raw payload 和 API DTO。
- 从 Zod 推导 TypeScript 类型，前后端共用。
- 对 `state.json` 采用宽松 schema：关键字段严格校验，未知字段保留，避免 reducer schema 小改导致 viewer 崩溃。

### 测试工具

推荐：

- Vitest：单元测试和 Node API 集成测试。
- React Testing Library：组件测试。
- Playwright：端到端测试。
- MSW 或本地 test server：前端 API mock。

## 推荐目录结构

```text
tools/codex-trace-viewer/
  README.md
  docs/
    README.md
    requirements.md
    implementation-plan.md
    test-plan.md
  package.json
  tsconfig.json
  vite.config.ts
  server/
    index.ts
    api/
    bundle-store.ts
    reducer-runner.ts
    watcher.ts
    search-index.ts
  web/
    index.html
    src/
      main.tsx
      app/
      components/
      features/
        timeline/
        prompt/
        agent-graph/
        raw-payloads/
        stats/
      api/
      styles/
  shared/
    schemas/
    types/
    dto/
  fixtures/
    README.md
    simple-chat/
    tool-call/
    multi-agent/
```

## 数据流

### Stage 1：读取已有 state.json

```text
trace bundle
  state.json
  payloads/*.json
      |
      v
TypeScript server
      |
      v
Viewer DTOs
      |
      v
React UI
```

第一阶段要求用户或测试 fixture 已经存在 `state.json`。这避免第一版直接依赖 Rust API。

### Stage 2：自动生成 state.json

当 bundle 没有 `state.json` 时：

```text
trace bundle
  manifest.json
  trace.jsonl
  payloads/*.json
      |
      v
spawn("codex", ["debug", "trace-reduce", bundle])
      |
      v
state.json
      |
      v
TypeScript server -> React UI
```

这一步仍然不链接 Rust crate，只通过 CLI 调用 reducer。

### Stage 3：可选 Rust 深集成

如果 viewer 成为 Codex 官方调试入口，再评估：

- 新增 Rust crate 直接调用 `codex_rollout_trace::replay_bundle`。
- 或把 TypeScript 静态资源嵌入 `codex debug trace-view`。
- 或维持工具独立，只提供 CLI wrapper。

## 本地服务 API

建议 API：

- `GET /api/trace`：trace summary、root thread id、bundle path、state status。
- `GET /api/bundles`：trace root 下已发现的 bundles。
- `GET /api/bundles/select?id=...`：选择当前 active bundle。
- `GET /api/threads`：thread tree。
- `GET /api/threads/:threadId/timeline`：业务 timeline nodes。
- `GET /api/turns/:turnId`：turn details。
- `GET /api/inferences/:inferenceId`：model call summary。
- `GET /api/inferences/:inferenceId/prompt`：prompt wire view 和 rendered sections。
- `GET /api/tools/:toolCallId`：tool call details。
- `GET /api/payloads/:payloadId`：lazy-loaded raw payload。
- `GET /api/search?q=...`：本地搜索。
- `GET /api/watch`：SSE 推送当前 bundle 更新。
- `GET /api/bundles/watch`：SSE 推送新增 bundle。

## 监测与自动刷新方案

监测能力分两层实现。

### Active Bundle 监测

目标：当前打开的 bundle 有新 Codex 请求时，UI 自动看到新内容。

实现：

- Node server 监测 `state.json`、`trace.jsonl` 和 `payloads/`。
- 第一版优先监测 `state.json` mtime；变化后重新读取 state，并推送 `trace_updated`。
- 第二版在 raw bundle 变化但 state 未更新时，自动调用 `codex debug trace-reduce <bundle>`。
- 使用 SSE 推送更新通知。
- 前端收到通知后增量拉取 thread tree、timeline、prompt、stats。
- 新 timeline node 短暂高亮。
- 支持“跟随最新请求”和“暂停跟随”。

### Trace Root 监测

目标：`CODEX_ROLLOUT_TRACE_ROOT` 下出现新 bundle 时，自动发现。

实现：

- Node server 监测 trace root 目录。
- 发现新 `manifest.json` 后加入 bundle list。
- SSE 推送 `bundle_added`。
- 前端列表自动出现新 bundle。
- “跟随最新请求”开启时，自动切到最新 active bundle。
- 当前第一版实现为轮询 trace root，推送 `bundles_updated`，用户可在左侧 bundle list 手动切换 active bundle。

## Viewer DTO

创建稳定 DTO，前端只依赖 DTO，不直接依赖 reduced graph 原始结构。

关键 DTO：

- `TraceSummary`
- `BundleSummary`
- `ThreadTreeNode`
- `TimelineNode`
- `TimelineEdge`
- `PromptView`
- `PromptSection`
- `InferenceSummary`
- `ToolCallSummary`
- `RawPayloadSummary`
- `StatsSummary`

### TimelineNode

字段：

- `id`
- `type`
- `label`
- `threadId`
- `turnId`
- `startedAtUnixMs`
- `endedAtUnixMs`
- `status`
- `summary`
- `relatedIds`
- `rawPayloadRefs`

节点类型覆盖：query、prompt build、inference、assistant message、reasoning、tool call、tool result、terminal operation、code cell、compaction、agent edge。

### PromptView

字段：

- `inferenceId`
- `model`
- `provider`
- `wireRequestPayloadRef`
- `wireRequestJson`
- `sections`
- `warnings`

### PromptSection

字段：

- `id`
- `kind`
- `label`
- `source`
- `role`
- `content`
- `contentRef`
- `charCount`
- `estimatedTokens`
- `included`
- `rawPayloadRef`

第一版从 request JSON 推断 sections：

- `instructions` -> System / Base Instructions。
- `input` items -> Conversation history、current query、tool outputs、context-like items。
- `tools` -> Model-visible tool definitions。
- `text` / output schema -> Output Schema。
- request metadata fields -> Request Metadata。

如果推断不足，再推动 rollout trace 增加 diagnostic-only prompt section metadata。

## UI 方案

### 布局

三栏布局：

- 左栏：bundle list、thread tree、turn tree、search、filters。
- 中栏：timeline、prompt、agent graph、raw payloads、stats。
- 右栏：selected node details。

Tabs：

- Timeline
- Prompt
- Agent Graph
- Raw Payloads
- Stats

### Prompt Inspector

P0 能力：

- rendered prompt sections。
- exact wire request JSON。
- 长 section 展开 / 折叠。
- 复制完整 request。
- 复制单个 section。
- prompt 内搜索。
- section 和 timeline item 之间跳转。

### Agent Graph

第一版可以用 collapsible tree。数据和交互稳定后，再接 React Flow。

必须支持的 edge type：

- spawn
- task delivery
- follow-up task
- send message
- result
- close

## 里程碑

### Milestone 1：TypeScript 离线骨架

- 创建 TypeScript package。
- 创建 Node server。
- 创建 Vite React UI。
- 从指定 bundle 读取 `state.json`。
- 展示 trace summary、bundle path、thread tree。

### Milestone 2：Timeline 和 Details

- 从 `state.json` 构建 viewer DTO。
- 渲染 timeline nodes。
- 增加 details panel。
- 支持 node type 和 status 过滤。

### Milestone 3：Prompt Inspector

- 解析 inference raw request payload。
- 构建 wire view。
- 推断 prompt sections。
- 支持 prompt search、copy、展开折叠。

### Milestone 4：Tools、Raw Payload 和 Agent Flow

- 关联 model tool calls 和 runtime tool calls。
- 展示 tool args、result、status、duration。
- lazy-load raw payload。
- 增加 terminal / code cell 关系导航。
- 增加 multi-agent tree / graph view。

### Milestone 5：监测模式

- 监测 active bundle 的 `state.json` 变化。
- SSE 自动通知前端刷新。
- 支持 trace root 下新增 bundle 自动发现。
- 支持“跟随最新请求”和“暂停跟随”。
- 增加 live / reconnecting / paused 状态。

### Milestone 6：Reducer 调用和产品化

- bundle 缺少 `state.json` 时，调用 `codex debug trace-reduce <bundle>`。
- 大 bundle 性能优化。
- 空状态和错误状态优化。
- sanitized fixtures。
- 完整端到端测试。
- 评估是否接入 `codex debug trace-view`。

## 风险

- 从 raw request JSON 推断 prompt sections 可能无法保留足够来源信息。
- `state.json` schema 变化可能影响 TypeScript parser，需要 Zod 宽松校验。
- 大 prompt 和大 payload 可能导致朴素 UI 渲染卡顿。
- 调用 `codex debug trace-reduce` 会依赖本机 Codex CLI 可用。
- raw payload 可能包含敏感数据，本地只读和不上传边界必须清楚。

## 未来扩展

- 直接调用 Rust `codex_rollout_trace::replay_bundle`。
- 把 TypeScript 静态资源嵌入 Codex CLI。
- 把 reduced graph 导出成 OpenTelemetry GenAI spans。
- 从 Aspire、Langfuse、Phoenix 等平台导入 OTEL spans 做对照。
- 用 redaction profiles 生成可分享的 sanitized traces。
- 导出单文件 HTML report。
