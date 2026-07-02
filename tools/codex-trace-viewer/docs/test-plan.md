# 测试方案

## 目标

验证 TypeScript 版 Codex Trace Viewer 能正确解释 rollout trace bundle 中的 Codex 业务流程，包括完整 prompt、prompt 分段、model call、tool call、assistant message、terminal operation、compaction、多 agent 关系、多条 trace bundle 切换和新请求自动监测。

产品验收必须包含 Codex 实际生成的 rollout trace bundle。手写 demo fixture 只能用于 UI smoke 和 mapper 单元测试，不能替代真实 trace 验收。

测试需要覆盖产品体验、Node server 行为、React UI 行为和端到端用户流程。

## 测试工具

推荐：

- Vitest：单元测试和 Node API 集成测试。
- React Testing Library：组件测试。
- Playwright：端到端测试。
- Zod fixtures：校验 `state.json`、payload 和 viewer DTO。
- 临时目录 fixtures：模拟 bundle、payload、state 更新和新增 bundle。

## 测试层级

### 单元测试

覆盖 shared mapper、schema、搜索和 prompt section 推断。

后端 / shared 示例：

- `state.json` -> `ThreadTreeNode`。
- `state.json` -> `TimelineNode`。
- inference request payload -> `PromptView`。
- request JSON -> `PromptSection[]`。
- raw payload id -> bundle 内 payload 路径。
- search index construction。
- duration 和 status summary。
- bundle list sorting。
- watcher event debounce。

前端纯函数示例：

- timeline grouping 和 sorting。
- prompt section filtering。
- search highlighting。
- 长文本折叠阈值。
- node type label formatting。
- follow latest 状态机。

### Node API 集成测试

使用 sanitized fixtures 启动本地 server，测试 HTTP API。

必备 fixture 类型：

- 单个 regular turn，包含 user query 和 assistant response。
- regular turn，包含 model tool call 和 tool output。
- terminal-backed tool execution。
- 多次 model inference call。
- compaction。
- failed tool call。
- cancelled 或 aborted turn。
- multi-agent parent thread spawn child thread 并接收 result。
- prompt 同时包含 system/base instructions、developer instructions、AGENTS.md content、history、current query、tool definitions 和 output schema。

每个 fixture 应断言 API 结构，而不是只做 snapshot：

- thread count。
- turn count。
- timeline node type sequence。
- inference count。
- tool call count。
- agent edge count。
- prompt section labels 和 sources。
- raw payload references 可解析。

### React 组件测试

不启动完整 server，用 mock DTO 验证关键视觉状态。

场景：

- empty trace。
- 单 thread trace。
- 多 child threads trace。
- prompt 包含长 collapsed sections。
- prompt wire view。
- tool call details，包含 arguments 和 result。
- failed node details。
- raw payload loading error。
- live / reconnecting / paused 状态。
- 新 timeline node 高亮。

### 端到端测试

使用 Playwright 连接 TypeScript 本地 server。

端到端测试应验证完整产品行为：

- 用 fixture bundle 启动 viewer。
- 打开 app。
- 选择 bundle。
- 选择 thread。
- 选择 turn。
- 打开 Timeline。
- 打开某个 model call。
- 打开 Prompt tab。
- 验证 full wire request 可见。
- 验证 prompt sections 包含 system/base instructions、history、current user query 和 tools。
- 搜索 tool call id。
- 打开 tool details。
- 打开 raw payload。
- 对 multi-agent fixture 切换到 Agent Graph。
- 点击 agent edge，并验证选中了对应 originating tool 或 message。
- 在监测模式下更新 `state.json` 或追加 fixture state，验证 UI 自动出现新的请求、turn、model call、tool call 或 assistant message。

### 真实 Codex Trace 批量验证

使用 `npm run validate:real` 验证实际 Codex 生成的 trace bundle：

- `npm run validate:real -- --bundle <trace-bundle>`：验证单条真实 bundle。
- `npm run validate:real -- --bundle <bundle-a> --bundle <bundle-b>`：验证指定多条真实 bundle。
- `npm run validate:real -- --trace-root "$CODEX_ROLLOUT_TRACE_ROOT" --limit 10`：验证 trace root 下最近 10 条真实 bundle。

每条真实 bundle 必须先经过 `codex debug trace-reduce`，并验证：

- reduced state 能成功生成。
- 至少有 root thread 和 thread tree。
- timeline 非空。
- 有 inference request payload 时能生成 prompt sections。
- raw request payload 引用能在 bundle 内解析，不能越界访问。
- 多条 bundle 的验证结果独立输出，单条失败时应暴露具体 bundle path。

## 产品验证矩阵

### Session 和 Thread

验证：

- root thread 可见。
- 有 child thread 时按 parent 关系嵌套展示。
- thread status 和 duration 可见。
- details 中可见或可复制 thread id。
- summary 中可见 session/root identity。

验收：

- 用户打开 trace 后 10 秒内能判断某段工作发生在哪个 thread。

### Turn 和 Query

验证：

- 每个 thread 下可见 turn list。
- 用户 query 作为 timeline node 展示。
- turn status 可见。
- 可用时展示 turn duration 和 token summary。

验收：

- 用户无需打开 raw JSON，就能定位触发 query 和最终 assistant response。

### Prompt Inspector

验证：

- 每个有 request payload 的 inference 都能打开 wire request JSON。
- rendered prompt sections 可见。
- system/base instructions 和 user/history content 分开。
- tool definitions 和 conversation items 分开。
- current query 与历史 user message 可区分。
- 长 section 默认折叠。
- copy actions 可用。
- prompt 内搜索可用。

验收：

- 用户能通过 UI 回答“实际发给模型的完整 prompt 是什么”和“这段文本来自哪个 prompt section”。

### Model Calls

验证：

- model / provider 可见。
- request / response raw payload references 可用。
- 可用时展示 token usage。
- retries 或 multiple inferences 可区分。
- assistant messages 关联 producing inference calls。

验收：

- 用户能判断每个 assistant message 和 tool call 来自哪次 model call。

### Tool Calls

验证：

- tool call name 和 call id 可见。
- arguments 可见或可访问。
- result preview 和 raw result 可访问。
- status 和 duration 可见。
- tool calls 可回溯到 producing model calls。
- tool outputs 可前溯到 follow-up model requests。

验收：

- 用户能判断坏结果来自模型决策、tool input、tool runtime 还是 tool output。

### Terminal 和 Code Mode

验证：

- terminal commands 作为 runtime operations 展示。
- 可用时展示 exit status、stdout/stderr preview、duration。
- nested code-mode tool calls 保留和 code cells 的关系。

验收：

- 用户能把 model-visible tool output 追溯到产生它的 runtime operation。

### Multi-Agent

验证：

- parent 和 child threads 可见。
- spawn 和 result edges 可见。
- 可用时展示 follow-up 和 send-message edges。
- 点击 edge 后选中 originating tool call 或 delivered conversation item。

验收：

- 用户无需读 raw payload，就能理解 agent 间信息如何流转。

### Search 和 Filtering

验证：

- 可搜索 thread id、turn id、inference id、tool call id、tool name、user text、assistant text、prompt section text。
- 可按 node type、status、model、thread、tool name 过滤。

验收：

- 用户能在大 trace 中快速找到已知 call id 或 prompt 文本。

### Monitoring

验证：

- 当前 `state.json` 更新后，UI 自动显示新增节点。
- 新 model call、tool call、assistant message 有视觉提示。
- 开启“跟随最新请求”时自动跳到最新 active turn。
- 暂停跟随后不强制跳转。
- trace root 下新增 bundle 后，bundle list 自动出现。
- trace root 下存在多条 bundle 时，UI 可切换 bundle，切换后 thread、timeline、prompt、payload、stats 全部来自当前 active bundle。

验收：

- Codex 有新请求时，用户无需手动刷新即可看到新请求和后续 model/tool/message 进展。
- Codex 连续产生多条 trace bundle 时，用户无需重启 viewer 即可看到新 bundle 并切换查看。

### Privacy 和 Safety

验证：

- 除本地 viewer server 外没有网络请求。
- raw payload 只有在用户请求时才加载。
- UI 有敏感内容提示。
- 长 prompt / tool content 默认折叠。
- viewer 不修改 trace bundle 文件。
- 监测模式下仍然不发起非本地网络请求。

验收：

- 在敏感本地 bundle 上运行 viewer 不上传、不改写数据。

## 端到端 Fixture 场景

### 场景 1：Simple Chat

输入：

- 一个 root thread。
- 一个 turn。
- 一个 user query。
- 一次 model inference。
- 一个 assistant message。

检查：

- thread tree 只有一个 thread。
- timeline 包含 query、model call、assistant message。
- Prompt tab 展示 wire request 和 sections。

### 场景 2：Tool Call

输入：

- 一次 inference 返回 tool call。
- runtime 执行 tool。
- follow-up inference 消费 tool output。
- assistant final response。

检查：

- timeline 展示 model call、tool call、tool result、follow-up model call、assistant message。
- tool details 展示 args、result、duration、status。
- follow-up request 的 prompt history 中包含 tool output。

### 场景 3：Prompt Section Coverage

输入：

- base instructions。
- developer instructions。
- AGENTS.md content。
- conversation history。
- current user query。
- tool definitions。
- output schema。

检查：

- Rendered Prompt tab 对每个来源都有独立 section。
- Wire View 和 raw request payload 匹配。
- current query 不会和旧 user history 混淆。

### 场景 4：Multi-Agent

输入：

- root thread 调用 spawn tool。
- child thread 接收 task。
- child 返回 result。
- root thread 接收 notification / result。

检查：

- Agent Graph 展示 root 和 child。
- spawn edge 链接到 spawn tool call。
- result edge 链接 child assistant output 和 root conversation item。
- timeline 可以只过滤 child thread。

### 场景 5：Failure And Abort

输入：

- tool call failed 或 turn aborted。

检查：

- failed status 在 timeline 可见。
- details panel 展示 error summary。
- search/filter 能隔离 failed nodes。

### 场景 6：Large Prompt

输入：

- prompt 包含长 AGENTS.md、长历史消息和大 tool output。

检查：

- UI 保持响应。
- sections 默认折叠。
- 展开一个 section 不会展开全部。
- search 仍可用。

### 场景 7：Live Monitoring

输入：

- 一个正在运行或可模拟增长的 trace bundle。
- 测试过程中更新 `state.json` 或追加新的 fixture state。

检查：

- UI 不刷新整个页面也能出现新 timeline node。
- 新 model call、tool call、assistant message 有视觉提示。
- 当前打开 active turn 时，新内容自动追加。
- 暂停跟随后，新内容进入列表但不强制跳转。
- 恢复跟随后，自动跳到最新 active turn。

### 场景 8：New Bundle Discovery

输入：

- 一个 trace root 目录。
- 测试过程中创建新的 rollout trace bundle。

检查：

- trace list 自动出现新 bundle。
- 开启“跟随最新请求”时自动切到新 bundle。
- 关闭“跟随最新请求”时只显示提示，不打断当前查看。

### 场景 9：Trace Reduce Fallback

输入：

- 一个没有 `state.json`、但包含 `manifest.json`、`trace.jsonl` 和 `payloads/` 的 bundle。
- test double 或真实 `codex debug trace-reduce` 命令。

检查：

- server 检测到缺少 `state.json`。
- server 调用 reducer 命令或展示需要 reduce 的可读状态。
- reduce 成功后 UI 自动加载生成的 `state.json`。
- reduce 失败时显示错误，不崩溃。

## 性能目标

初始本地目标：

- 读取中等 `state.json` 后 2 秒内打开首屏。
- timeline 1,000 个 nodes 时浏览器无明显卡顿。
- 100k+ 字符 prompt section 使用折叠和 lazy rendering。
- 大于 256 KB 的 raw payload lazy-load。
- `state.json` 更新后 1 秒内让 UI 看到更新提示。

## 发布门禁

MVP 完成前：

- 至少一个 fixture 覆盖每个 P0 surface：thread、turn、timeline、prompt、model call、tool call、assistant message、raw payload。
- simple chat、tool call、prompt section coverage 端到端测试通过。
- E2E 测试中没有非本地网络请求。
- missing raw payload 有可读错误。
- viewer 不修改 fixture bundle 文件。

实用版完成前：

- multi-agent E2E 测试通过。
- large prompt E2E 测试通过。
- failed tool / aborted turn E2E 测试通过。
- live monitoring E2E 测试通过。
- new bundle discovery E2E 测试通过。
- trace reduce fallback 测试通过或明确标记为后续阶段。
- search 和 filters 有自动化覆盖。
- prompt section inference 有 fixture-based regression tests。

## 手动探索清单

- 打开一个真实本地 Codex trace bundle。
- 确认首屏无需 raw JSON 就能解释发生了什么。
- 从一个 assistant message 回溯到 model call 和 prompt。
- 从一个 tool output 回溯到 tool call 和 raw runtime payload。
- 搜索一个已知用户 query 片段。
- 检查一个 multi-agent run，并解释 parent / child 通信。
- 尝试 partially written 或 incomplete bundle。
- 尝试包含超长 prompt 的 trace。
- 启动监测模式，确认 Codex 有新请求时 UI 能自动看到新内容。
- 在 trace root 下创建新 bundle，确认列表自动发现。

## 已知测试缺口

- 初期可能没有 prompt section 级别的精确 token count。
- 在加入 diagnostic-only section metadata 前，prompt section source attribution 可能依赖启发式推断。
- 如果第一版不自动调用 `codex debug trace-reduce`，reduce fallback E2E 可以后置。
- OpenTelemetry export 测试等 exporter 开始后再补。
