# 13 Tool Discovery、Apps 与 Connectors：工具太多时怎样按需出现

## 从“给模型 500 个工具”这个坏主意开始

企业 Agent 可能连接日历、网盘、邮件、工单和几十个内部服务。如果每个工具 schema 都放进
每次模型请求，会出现三个问题：输入昂贵、模型选错工具、工具清单频繁变化导致 prompt
cache 失效。

解决办法不是少装工具，而是拆开四个状态：

```text
Registered：运行时知道 handler
Visible：本次模型请求直接看到 schema
Discoverable：可通过 tool_search 找到
Callable：发现后且通过权限检查，可以执行
```

已注册不代表模型可见；被发现也不代表被授权。

## Tool Exposure：为不同表面选择可见性

当前模型可以直接调用工具，也可能在 Code Mode 中嵌套调用。Exposure 描述工具在哪些
surface 出现：

| Exposure | 首轮模型 | Tool Search | Code Mode |
| --- | --- | --- | --- |
| Direct | 是 | 否 | 是 |
| Deferred | 否 | 是 | 是 |
| DeferredModelOnly | 否 | 是 | 否 |
| DirectModelOnly | 是 | 否 | 否 |
| CodeModeOnly | 否 | 否 | 是 |
| Hidden | 否 | 否 | 否 |

基础 shell、patch 可能值得 direct；数量庞大的外部 connector tools 更适合 deferred；内部
dispatch helper 可以注册为 hidden。Exposure 是模型可见策略，不替代权限。

## `tool_search` 搜索的是工具，不是业务数据

模型收到用户要求“安排明天下午会议”，首轮没有日历工具，只看到 `tool_search`。它搜索：

```json
{"query": "calendar find availability create meeting", "limit": 5}
```

搜索引擎匹配有界 metadata：tool name、description、namespace 和来源。返回的
`LoadableToolSpec` 被加入后续模型请求，模型下一轮才看到并调用 `create_event`。

```text
Tool metadata catalog
  -> BM25 search
  -> matched specs
  -> ToolSearchOutput / AdditionalTools
  -> next model request
  -> real tool call
```

Discovery 本身不查询日历内容，也不创建会议。它只改变下一轮可见 schema。零命中应让模型
换 query 或说明能力不可用，不能幻觉一个工具名。

## 为什么需要 Namespace

网盘和邮件 connector 都可能有 `search`，两个 MCP server 也可能都叫 `lookup`。扁平名称
会冲突，因此调用身份要包含 namespace：

```text
mcp__calendar / create_event
mcp__drive / search
mcp__mail / search
```

Registry 对 canonical name 做冲突检查；不同 namespace 可以同名，默认 namespace 的保留
名称不能被外部 runtime 抢占。搜索返回多个同 namespace 工具时，还要合并 namespace
声明，避免模型看到互相覆盖的重复定义。

## Apps/Connectors 与 MCP 的关系

App 是产品层的 connector：有名称、图标、安装、可访问性和账号状态。在模型运行时，它的
可调用能力表现为宿主 Apps MCP server 中的一组 namespaced tools。

```text
App metadata / installation
  -> hosted Apps MCP catalog
  -> connector namespace + tool runtimes
  -> direct/deferred exposure
  -> normal ToolRouter
```

用户可以用 `app://<connector-id>` 显式 mention，系统也可根据任务隐式使用已安装 App。
“安装了”不一定“可调用”：账号未授权、配置禁用或策略过滤都会改变 callable 状态。
Plugin 从 Marketplace 被发现、安装并使这些 App 进入候选 catalog 的上游过程，见
[第 16 课](16-plugin-marketplace-distribution.md)；本课只继续追踪安装后的工具怎样暴露。

Apps 工具发现应走 `tool_search`。`list_mcp_resources` 与
`list_mcp_resource_templates` 枚举的是 MCP resources，不是 hosted Apps tool catalog；重复
调用它们既浪费上下文，也不会正确加载 connector tools。

## 动态发现怎样影响安全和缓存

发现工具只增加模型选择面，执行仍经过：

```text
ToolRouter -> PreToolUse Hook -> Permission/Guardian -> Runtime -> PostToolUse -> Trace
```

搜索 query、命中 specs 和实际调用都应进入 trace，且带 namespace/source。否则只能看到
“模型调用错工具”，无法知道是 catalog metadata、search ranking 还是模型决策出了问题。

稳定 direct prefix 有利于 prompt cache；每轮加载大量不同 deferred tools 会扩大 cache
miss。应限制 query 次数、每次命中数、source description 总大小和一个 turn 的累计新工具。

## Discovery Eval 不只测搜索准确率

至少覆盖：

| 场景 | 期望 |
| --- | --- |
| 明确日历任务 | calendar tools 进入 top-k |
| 普通文件任务 | 不加载邮件/网盘工具 |
| 同名跨 namespace | 调用正确 connector |
| 未安装或未授权 App | 不报告为 callable |
| 高风险 share tool | 可以发现，但执行仍需 approval |
| 零命中 | 不捏造工具 |

“该发现时发现”和“不该暴露时不暴露”同样重要。

## 动手实验：模拟 Calendar 与 Drive

给 `mini-codex-agent` 注册：

```text
calendar: search_events, create_event
drive: search_files, share_file
```

首轮只暴露文件基础工具和 `tool_search`。为四个 deferred tools 建 metadata index，然后运行：

1. “安排明天下午会议”只加载 calendar。
2. “查找设计文档”只加载 drive。
3. 两组都含 `search`，验证 namespace 路由。
4. `share_file` 被发现后触发 approval，拒绝时无副作用。
5. 禁用 drive App 后，search 不再返回它。

输出一张 discovery trace：query、候选 score、命中 spec、下一轮 visible tools、实际调用、
权限结果和 cache-key 变化。

## 常见误区

- deferred 工具没有注册。它仍在 registry，只是不在首轮 schema。
- `tool_search` 执行业务搜索。它只搜索工具 metadata。
- 被发现等于可以执行。权限与账号状态仍可能拒绝。
- App 就是 MCP resource。App 的可调用能力是 hosted MCP tools。
- 工具越多，搜索 limit 越大越好。噪声和 context 成本也会增加。

## 理解之后再对照 Codex

Exposure 定义在 `tools/src/tool_executor.rs`，注册与冲突在
`core/src/tools/registry.rs`，最终可见计划在 `core/src/tools/spec_plan.rs`。Tool Search 的
spec、BM25 handler 和结果类型位于 `core/src/tools/handlers/tool_search_spec.rs`、
`tool_search.rs`、`core/src/tools/context.rs`。

Apps 模型提示在 `core/src/context/apps_instructions.rs`，connector 名称规范化在
`codex-mcp/src/codex_apps.rs`，catalog 在 `codex-mcp/src/connection_manager/tool_catalog.rs`，
产品协议类型在 `app-server-protocol/src/protocol/v2/apps.rs`。

用实验中的五个 query 验证这些实现点，不需要先阅读整个 registry 或 App Server。

## 本课验收

你应该能：

1. 区分 registered、visible、discoverable 和 callable。
2. 解释工具从 BM25 metadata 命中到下一轮可调用的完整过程。
3. 说明 App metadata、hosted MCP catalog、namespace 和账号状态的关系。
4. 设计同时覆盖准确率、安全和 cache 成本的 discovery eval。
