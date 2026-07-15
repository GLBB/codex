# MCP 架构、生命周期与传输

## 两层协议

MCP 可以分成两层：

| 层 | 负责内容 |
| --- | --- |
| 数据层（Data Layer） | JSON-RPC 消息、生命周期、能力声明、协议原语、通知和错误 |
| 传输层（Transport Layer） | 建立连接、消息分帧、进程或网络传输、HTTP 认证 |

Server 支持 `tools/list` 属于数据层；它通过 stdio 还是 Streamable HTTP 提供服务属于传输层。不能根据传输方式推断业务能力或安全等级。

## JSON-RPC 消息

MCP 数据层基于 JSON-RPC 2.0，包含三种基本消息：

- 请求（Request）：带 `id`，接收方必须返回响应或错误；
- 响应（Response）：使用相同 `id` 与请求配对；
- 通知（Notification）：没有 `id`，也不等待响应。

```json
{
  "jsonrpc": "2.0",
  "id": 2,
  "method": "tools/list",
  "params": {}
}
```

JSON-RPC `id` 只用于关联一条 MCP 连接上的请求和响应，不等于模型服务返回的 Tool `call_id`。Host 在两套协议之间转换时，需要分别维护这两个标识。

## 初始化与能力协商

典型生命周期是：

```text
传输连接已建立
    ↓
Client → initialize
    protocolVersion + clientInfo + clientCapabilities
    ↓
Server → 初始化结果
    protocolVersion + serverInfo + serverCapabilities
    ↓
Client → notifications/initialized
    ↓
正常通信
    ↓
关闭 / 断开连接 / 清理资源
```

初始化阶段完成三件事：协商协议版本、交换客户端和服务端的实现信息，以及声明各自支持的可选能力。双方只能使用已经协商的能力；“规范中有定义”并不表示当前连接支持。

Server 的初始化结果还可以包含 `instructions`，用于说明跨 Tool 的通用工作流程、约束和使用建议。Host 应保留这些说明的 Server 来源，并像对待 Tool 描述一样将其视为外部内容；它不能覆盖系统指令、开发者指令、用户指令或组织策略。

能力声明还可以表明 Server 是否支持列表变更通知，例如 `tools.listChanged`。收到 `notifications/tools/list_changed` 后，Host 应重新获取工具列表，并再次应用过滤、命名和安全策略，而不能假设缓存永久有效。

## stdio

stdio 传输常用于本地 Server：Host 启动子进程，并通过标准输入输出交换协议消息。

关键工程点：

- 命令、参数、工作目录和环境变量由谁配置；
- stdout 必须只输出符合协议分帧要求的消息，诊断日志应写入 stderr；
- 子进程继承哪些文件、网络和凭据权限；
- 启动超时、退出码、崩溃和进程树怎样清理；
- 多个会话是否共享同一个 Server 进程和状态。

“本地”只描述部署位置，不代表可信。安装包、启动命令和环境变量都属于供应链与执行边界。

## Streamable HTTP

Streamable HTTP 适合远程 Server。Client 使用 HTTP POST 发送消息，Server 可以通过服务器发送事件（SSE）提供流式响应。实现时还需要处理：

- TLS、Origin 和目标 URL 校验；
- Bearer Token、OAuth 和权限范围；
- 连接中断、重连和请求去重；
- 代理、企业网络和重定向；
- 多租户身份、数据区域和审计；
- Server 限流、背压和可用性。

远程传输使用的网络认证不能替代 MCP Tool 审批：前者回答“能否连接以及以谁的身份连接”，后者回答“是否允许执行当前这项具体操作”。

Streamable HTTP 使用一个同时支持 POST 和 GET 的 MCP 端点，而不是为每个 Tool 分别提供 REST URL。POST 用于发送 JSON-RPC 消息，并可能返回普通 JSON 或 SSE；GET 可以建立从 Server 到 Client 的 SSE 通道。初始化后还要处理 `MCP-Protocol-Version`、可选的 `MCP-Session-Id`、通过 SSE `Last-Event-ID` 恢复消息，以及通过 DELETE 结束会话。

HTTP 连接断开不等于 MCP 取消请求，也不能证明写操作失败。完整的消息、会话和 OAuth 链路见 [远程 HTTP 与授权](10-remote-http-and-authorization.md)。

## 超时、取消与进度

至少区分：

- 启动超时（Startup Timeout）：Server 初始化必须在多长时间内完成；
- 请求超时（Request Timeout）：单次 list、read、call 最长可以等待多久；
- 空闲超时（Idle Timeout）：连接或数据流多长时间无活动后回收；
- Agent 轮次期限：即使 MCP 请求尚未超时，整个任务是否仍有时间预算。

长请求可以报告进度，调用方也可以请求取消；但取消消息不能保证业务系统已经回滚。Server 必须明确收到取消请求后是停止计算、关闭资源还是返回当前状态，Host 则需要处理“取消和成功几乎同时到达”的竞态情况。

## 动态状态与恢复

连接恢复后不要假设旧状态仍然成立：

- 重新协商版本和能力；
- 重新发现动态 Tool、Resource、Prompt；
- 使旧的 Server 端本地句柄失效，或显式恢复它们；
- 对结果状态未知的写调用，先查询外部状态，再决定是否重试；
- 在追踪记录中保存重连、重新认证和能力目录变化等事件。

协议连接的生命周期与 Agent 会话的生命周期并不相同。一个 Agent 会话可以跨越多次 MCP 重连，一条共享的 MCP 连接也可能服务多个轮次。

协议本身没有专用的关闭请求。使用 stdio 时，Client 通常先关闭输入流，再等待或终止子进程；使用 HTTP 时，Client 通常关闭连接，并可向支持删除会话的 Server 发送 DELETE。实现中不要自行增加双方并未协商的 `shutdown` 方法。
