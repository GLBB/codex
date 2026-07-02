# Codex Trace Viewer

Codex Trace Viewer 是基于 `codex-rollout-trace` 的本地业务流程查看器二次开发项目。

它的目标是把 rollout trace bundle 里的 Codex 执行过程展示成清晰的业务视图，包括：

- session / thread / turn
- 用户 query
- 完整 prompt
- prompt 各个段落及来源
- model call
- assistant message
- reasoning / summary
- tool call / tool result
- terminal operation
- compaction
- 多 agent 父子 thread 和消息流转

预期本地工作流：

```text
rollout bundle -> replay_bundle/state.json -> Codex Trace Viewer
```

当前需求见 [`docs/requirements.md`](docs/requirements.md)。

## 本地运行

安装和验证：

```bash
npm install
npm run check
npm test
npm run build
```

端到端验证：

```bash
npx playwright install chromium
npm run test:e2e
```

如果本机缺少浏览器系统依赖，先按 Playwright 提示安装依赖后重试。

打开单条 bundle：

```bash
npm run serve -- --bundle examples/demo-bundle --port 0
```

打开 trace root，支持多条 bundle 自动发现和切换：

```bash
npm run serve -- --trace-root "$CODEX_ROLLOUT_TRACE_ROOT" --port 0 --auto-reduce
```

## 真实 Codex Trace 验证

`examples/demo-bundle` 只用于 UI smoke，不作为产品验收依据。

真实验收应使用 Codex 实际生成的 rollout trace bundle，也就是包含 `manifest.json`、`trace.jsonl` 和 `payloads/` 的目录。可以验证单条：

```bash
npm run validate:real -- --bundle /path/to/trace-bundle
```

也可以基于 trace root 批量验证最近多条：

```bash
npm run validate:real -- --trace-root "$CODEX_ROLLOUT_TRACE_ROOT" --limit 10
```

该命令会调用 `codex debug trace-reduce` 生成临时 reduced state，然后验证 thread tree、timeline、prompt section 和 raw payload 引用是否能被 Viewer 正确解释。

## 和 Rollout Trace 的关系

`codex-rollout-trace` 负责 trace bundle 格式、raw event 写入、raw payload 保存和离线 reducer。

Codex Trace Viewer 只消费 reducer 之后的业务图和 raw payload 引用，用于展示和诊断。它不应该修改 trace 原始证据，也不应该改变 Codex 的 prompt 构造或模型请求行为。

## 隐私原则

trace bundle 可能包含完整 prompt、模型响应、工具参数、工具输出、终端输出、文件路径和用户数据。

Viewer 必须默认本地优先、只读、不上传 bundle 内容。
