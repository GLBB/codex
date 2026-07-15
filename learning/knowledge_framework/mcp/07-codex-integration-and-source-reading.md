# Codex MCP 集成与源码阅读

## 先区分三种事实

阅读 Codex MCP 时应始终标注事实来源：

1. MCP 规范：协议允许什么；
2. Codex 产品约定：当前配置和产品承诺什么；
3. Codex 仓库实现：当前分支具体实现什么。

规范中存在某个方法，不表示 Codex 已经把它提供给模型；源码中存在实验性分支，也不表示所有产品形态都已启用该功能。

## 当前实现概览

```text
配置 / Plugin / App 来源
    ↓
codex-mcp ConnectionManager
    ↓ 连接 + 初始化 + 发现能力
ToolInfo / Resource Client
    ↓
core Tool 定义规划 + 注册表
    ↓
McpHandler / McpResourceHandler
    ↓
mcp_tool_call 审批 + 生命周期
    ↓
调用结果 → Tool 输出 → 模型上下文
```

Codex 官方配置支持 stdio Server 的 `command`、`args`、`env`、`cwd`，也支持 Streamable HTTP Server 的 `url`、Header、Bearer Token 和 OAuth 相关配置。Server 和 Tool 还可以配置启停状态、允许列表、禁用列表、审批模式、启动超时和 Tool 超时。配置项应以当前 [Codex config.toml 参考](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml) 为准。

## 推荐源码阅读路线

### 1. Tool 身份与名称

打开 `codex-rs/codex-mcp/src/tools.rs`，先读 `ToolInfo` 保存哪些原始 Server / Tool 信息，再看 `normalize_tools_for_model_with_prefix` 如何生成模型可见名称并处理冲突。理解这一步后停止，不要立即进入所有测试分支。

### 2. 连接与能力发现

进入 `codex-rs/codex-mcp/src/connection_manager.rs`。沿初始化、获取 Tool、`call_tool`、`list_resources` 和 `read_resource` 阅读，重点关注启动超时、Tool 超时、缓存和连接状态。传输细节再继续阅读 `rmcp_client.rs`。

### 3. Client 能力与 Elicitation

阅读 `codex-rs/codex-mcp/src/rmcp_client.rs` 如何构造 Client、声明能力并接收 Elicitation；再看 `elicitation.rs` 如何保存待处理请求、执行策略、路由消息并关联响应。这里体现了 MCP Client 能够接收 Server 发起的反向请求。

### 4. 接入统一的 Tool 运行时

打开 `codex-rs/core/src/tools/handlers/mcp.rs`，观察 MCP Tool 定义如何转换成 Codex `ToolSpec` 和执行器，以及 Server 的并发声明和 `read_only_hint` 如何影响并发控制。然后回到 Tool 教程的 [工具目录](../tool/02-tool-catalog-and-planning.md) 和 [运行时](../tool/04-tool-runtime.md)，对照两者共用的处理流程。

### 5. 审批与调用生命周期

阅读 `codex-rs/core/src/mcp_tool_call.rs` 的审批决策、调用事件、结果处理和 Elicitation。重点区分 Tool 注解、用户配置和最终审批决定，不必一开始就读完所有界面模板和测试辅助代码。

### 6. Resources

最后阅读 `codex-rs/core/src/tools/handlers/mcp_resource/`。从 `list_mcp_resources.rs` 和 `read_mcp_resource.rs` 了解 Codex 如何把 Resource 访问包装成模型可调用的本地工具，再回头查看连接管理器发送的协议请求。

## 当前支持边界

以下矩阵是当前仓库的源码阅读结论，不是对未来版本的承诺：

| MCP 能力 | 规范状态 | 当前仓库中的实现情况 |
| --- | --- | --- |
| Tools list / call | 稳定 | 有发现、过滤、适配、审批和调用路径 |
| Resources list / read | 稳定 | 有 Resource Client，以及供模型调用的 list/read 处理器 |
| Prompts list / get | 稳定 | 未在上述 Codex 主要调用链中发现专用的提供路径 |
| Elicitation | 稳定 | 有能力声明、待处理请求、策略和响应路由 |
| Sampling | 稳定 | 未在上述 Codex MCP Client 主要调用链中发现 Sampling 处理器 |
| Roots | 稳定 | 未核对具体调用链前，不应假设 Codex 已对外提供 |
| Tasks | 实验性 | 不应假设支持 |

“未在主要调用链中发现”表示本教程不把它作为当前 Codex 能力来讲解。源码变化后应重新核对，不能据此断言 Codex 永远不会支持。

## 一次 Tool 调用的主要源码路径

```text
connection_manager.rs 发现远程 Tool
    ↓
tools.rs 创建 ToolInfo 和模型可见标识
    ↓
core tools/spec_plan.rs 决定是否向模型提供
    ↓
core tools/handlers/mcp.rs 转换 ToolSpec + 执行器
    ↓
模型返回 Tool 调用
    ↓
core mcp_tool_call.rs 执行审批和生命周期处理
    ↓
ConnectionManager call_tool
    ↓
截断、发送调用结果并写入上下文
```

阅读时应始终同时追踪三种 ID：模型 Tool 的 `call_id`、Codex 内部的 Server / Tool 标识，以及 MCP JSON-RPC 请求 ID。

## 源码练习

1. 追踪一个 `read_only_hint=true` 的 Tool 从发现到并发控制和审批。
2. 构造两个清洗后同名的 Server Tool，确认名称冲突如何解决。
3. 追踪 MCP Elicitation 如何让调用进入等待状态，以及怎样在轮次取消时结束等待。
4. 追踪 Resource URI 从模型参数到 `resources/read`，记录每层输出上限。
5. 对比 Hosted Tool、Core Tool 和 MCP Tool 分别由谁执行，以及它们经过哪些路由路径。
