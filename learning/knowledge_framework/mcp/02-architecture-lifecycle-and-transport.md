# MCP 架构、生命周期与传输

## 两层协议

MCP 可以分成两层：

| 层 | 负责内容 |
| --- | --- |
| Data Layer | JSON-RPC 消息、生命周期、Capability、Primitives、通知和错误 |
| Transport Layer | 建连、消息 framing、进程或网络传输、HTTP 认证 |

Server 支持 `tools/list` 属于 Data Layer；它通过 stdio 还是 Streamable HTTP 提供服务属于 Transport Layer。不要用 Transport 推断业务能力或安全等级。

## JSON-RPC 消息

MCP Data Layer 基于 JSON-RPC 2.0，包含三种基本消息：

- Request：带 `id`，接收方必须返回 Response 或 Error；
- Response：使用相同 `id` 与 Request 配对；
- Notification：没有 `id`，不等待 Response。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

JSON-RPC `id` 只负责一条 MCP 连接上的请求响应关联，不等于模型 Provider 返回的 Tool `call_id`。Host 桥接两套协议时需要分别维护它们。

## 初始化与能力协商

典型生命周期是：

```text
Transport Connected
    ↓
Client → initialize
    protocolVersion + clientInfo + clientCapabilities
    ↓
Server → initialize result
    protocolVersion + serverInfo + serverCapabilities
    ↓
Client → notifications/initialized
    ↓
Normal Operations
    ↓
Shutdown / Disconnect / Cleanup
```

初始化解决三件事：协商协议版本、交换实现身份、声明可选 Capability。双方只能使用已协商的能力；“规范定义过”不表示当前连接支持。

Server 的 Initialize Result 还可以包含 `instructions`，表达跨 Tool 的共同工作流、约束和使用建议。Host 应保留它的 Server Provenance，并像 Tool Description 一样将其视为外部声明；它不能覆盖 System、Developer、用户指令或组织 Policy。

Capability 还可以声明变化通知，例如 Server 的 `tools.listChanged`。收到 `notifications/tools/list_changed` 后，Host 应重新获取并治理 Catalog，而不是直接相信缓存永久有效。

## stdio

stdio Transport 常用于本地 Server：Host 启动子进程，通过标准输入输出交换协议消息。

关键工程点：

- 命令、参数、工作目录和环境变量由谁配置；
- stdout 必须保持协议 framing，诊断日志应走 stderr；
- 子进程继承哪些文件、网络和凭据权限；
- 启动超时、退出码、崩溃和进程树怎样清理；
- 多 Session 是否共享 Server 进程和状态。

“本地”只描述部署位置，不代表可信。安装包、启动命令和环境变量都属于供应链与执行边界。

## Streamable HTTP

Streamable HTTP 适合远程 Server。Client 使用 HTTP POST 发送消息，Server 可以使用 Server-Sent Events 提供流式响应。需要额外处理：

- TLS、Origin 和目标 URL 校验；
- Bearer Token、OAuth 和 Scope；
- 连接中断、重连和请求去重；
- 代理、企业网络和重定向；
- 多租户身份、数据区域和审计；
- Server 限流、背压和可用性。

远程 Transport 的网络认证不替代 MCP Tool Approval：前者回答“能否连接以及以谁的身份连接”，后者回答“当前具体动作是否允许”。

Streamable HTTP 使用一个同时支持 POST 和 GET 的 MCP Endpoint，而不是每个 Tool 一个 REST URL。POST 发送 JSON-RPC 消息并可能返回普通 JSON 或 SSE；GET 可以建立 Server 到 Client 的 SSE 通道。初始化后还要处理 `MCP-Protocol-Version`、可选的 `MCP-Session-Id`、SSE `Last-Event-ID` 恢复和可选的 Session DELETE。

HTTP 连接断开不等于 MCP Cancellation，也不能证明写操作失败。完整的消息、Session 和 OAuth 链路见 [远程 HTTP 与 Authorization](10-remote-http-and-authorization.md)。

## Timeout、取消与进度

至少区分：

- Startup Timeout：Server 初始化必须在多久内完成；
- Request Timeout：单次 list、read、call 最长等待时间；
- Idle Timeout：连接或流多久无活动后回收；
- Agent Turn Deadline：即使 MCP 未超时，整个任务是否仍有预算。

长请求可以报告 Progress，调用方也可以请求取消；但取消消息不保证业务系统已经回滚。Server 必须定义收到取消时停止计算、关闭资源还是返回当前状态，Host 则需要处理“取消与成功同时到达”的竞态。

## 动态状态与恢复

连接恢复后不要假设旧状态仍然成立：

- 重新协商版本和 Capability；
- 重新发现动态 Tool、Resource、Prompt；
- 使旧的 Server-local Handle 失效或显式恢复；
- 对未知终态的写调用先查询外部状态，再决定是否重试；
- 把重连、重新认证和 Catalog 变化写入 Trace。

协议生命周期与 Agent Session 生命周期不是同一个对象。一个 Agent Session 可以跨越多次 MCP 重连，一个共享 MCP 连接也可能服务多个 Turn。

协议本身没有专用的 Shutdown Request。stdio 通常由 Client 关闭输入流并等待或终止子进程；HTTP 通常关闭连接，并可对支持 Session 删除的 Server 发送 DELETE。实现不要虚构一个双方并未协商的 `shutdown` Method。
