# Codex MCP 集成与源码阅读

## 先区分三种事实

阅读 Codex MCP 时应始终标注事实来源：

1. MCP Specification：协议允许什么；
2. Codex Product Contract：当前配置和产品承诺什么；
3. Codex Repository Implementation：当前分支具体实现什么。

协议存在某个方法不表示 Codex 已将它暴露给模型；源码中存在实验分支也不表示所有产品 Surface 已启用。

## 当前实现地图

```text
Config / Plugin / App Sources
    ↓
codex-mcp ConnectionManager
    ↓ connect + initialize + discover
ToolInfo / Resource Client
    ↓
core Tool Spec Plan + Registry
    ↓
McpHandler / McpResourceHandler
    ↓
mcp_tool_call Approval + Lifecycle
    ↓
Call Result → Tool Output → Model Context
```

Codex 官方配置支持 stdio Server 的 `command`、`args`、`env`、`cwd`，也支持 Streamable HTTP Server 的 `url`、Header、Bearer Token 和 OAuth 相关配置。Server 和 Tool 还可以配置启停、Allowlist、Denylist、Approval Mode、Startup Timeout 和 Tool Timeout。配置项应以当前 [Codex config.toml Reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml) 为准。

## 推荐源码阅读路线

### 1. Tool 身份与名称

打开 `codex-rs/codex-mcp/src/tools.rs`，先读 `ToolInfo` 保存哪些原始 Server / Tool 信息，再看 `normalize_tools_for_model_with_prefix` 如何生成模型可见名称并处理冲突。理解这一步后停止，不要立即进入所有测试分支。

### 2. Connection 与 Discovery

进入 `codex-rs/codex-mcp/src/connection_manager.rs`。沿初始化、获取 Tool、`call_tool`、`list_resources` 和 `read_resource` 阅读，关注 Startup / Tool Timeout、缓存和连接状态。Transport 细节再下钻到 `rmcp_client.rs`。

### 3. Client Capability 与 Elicitation

阅读 `codex-rs/codex-mcp/src/rmcp_client.rs` 如何构造 Client、初始化 Capability 并接收 Elicitation；再看 `elicitation.rs` 的 Pending Request、Policy、Router 和响应关联。这里体现了 MCP Client 能接收 Server 反向请求。

### 4. 适配到统一 Tool Runtime

打开 `codex-rs/core/src/tools/handlers/mcp.rs`，观察 MCP Tool Definition 如何变成 Codex `ToolSpec` 和 Executor，以及 Server 并发声明和 `read_only_hint` 如何影响并发门。然后回到 Tool 教程的 [Catalog](../tool/02-tool-catalog-and-planning.md) 和 [Runtime](../tool/04-tool-runtime.md) 对照共性管线。

### 5. Approval 与调用生命周期

阅读 `codex-rs/core/src/mcp_tool_call.rs` 的审批决策、调用事件、结果处理和 Elicitation。重点区分 Annotation、用户配置与最终 Approval Decision，不必一开始读完所有 UI 模板和测试辅助代码。

### 6. Resources

最后阅读 `codex-rs/core/src/tools/handlers/mcp_resource/`。从 `list_mcp_resources.rs` 和 `read_mcp_resource.rs` 看 Codex 如何把 Resource 访问包装成模型可调用的本地工具，再回看 Connection Manager 的协议请求。

## 当前支持边界

以下矩阵是当前仓库的源码阅读结论，不是对未来版本的承诺：

| MCP 能力 | 规范状态 | 当前仓库可见实现 |
| --- | --- | --- |
| Tools list / call | 稳定 | 有发现、过滤、适配、审批和调用路径 |
| Resources list / read | 稳定 | 有 Resource Client 和模型侧 list/read Handler |
| Prompts list / get | 稳定 | 未在上述 Codex 主链中看到专用暴露路径 |
| Elicitation | 稳定 | 有 Capability、Pending Request、Policy 和响应路由 |
| Sampling | 稳定 | 未在上述 Codex MCP Client 主链中看到 Sampling Handler |
| Roots | 稳定 | 不应在未核对具体调用链时假设已暴露 |
| Tasks | 实验性 | 不应假设支持 |

“未看到主链”表示本教程不把它作为当前 Codex 能力教授；后续源码变化应重新核对，而不是据此断言永远不支持。

## 一次 Tool Call 的源码主链

```text
connection_manager.rs discovers remote Tool
    ↓
tools.rs creates ToolInfo and model-visible identity
    ↓
core tools/spec_plan.rs selects exposure
    ↓
core tools/handlers/mcp.rs adapts ToolSpec + Executor
    ↓
model returns Tool Call
    ↓
core mcp_tool_call.rs applies approval and lifecycle
    ↓
ConnectionManager call_tool
    ↓
Result is truncated, emitted and written to context
```

阅读时始终同时追踪三种 ID：模型 Tool `call_id`、Codex 内部 Server / Tool 身份、MCP JSON-RPC Request ID。

## 源码练习

1. 追踪一个 `read_only_hint=true` 的 Tool 从发现到并发门和 Approval。
2. 构造两个清洗后同名的 Server Tool，确认名称冲突如何解决。
3. 追踪 MCP Elicitation 如何让调用等待，又怎样在 Turn 取消时解除。
4. 追踪 Resource URI 从模型参数到 `resources/read`，记录每层输出上限。
5. 对比 Hosted Tool、Core Tool 和 MCP Tool 的执行所有权及 Router 路径。
