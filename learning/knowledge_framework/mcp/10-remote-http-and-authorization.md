# MCP 远程 HTTP 与 Authorization

## 本章解决什么问题

stdio 案例能展示 MCP Data Layer，却不能回答远程 Server 的连接、会话、断线恢复和用户授权怎样工作。远程 MCP 通常使用 Streamable HTTP；HTTP 负责传输和认证，MCP JSON-RPC 继续负责初始化、发现、调用和反向请求。

```text
Agent Host
    │ HTTPS + OAuth / Bearer
    ▼
single MCP endpoint
    │ POST / GET / DELETE + optional SSE
    ▼
MCP Server
    │ downstream credential
    ▼
Business API
```

不要把三种身份混在一起：MCP Client 访问 MCP Server 的 Token、MCP Server 访问下游 API 的 Token，以及 MCP HTTP Session ID 是三个不同对象。

## 单一 MCP Endpoint

Streamable HTTP Server 提供一个 MCP Endpoint，例如：

```text
https://mcp.example.com/mcp
```

它不是每个 Tool 一个 REST URL。Client 向同一个 Endpoint 发送 JSON-RPC 消息：

| HTTP 方法 | 主要用途 |
| --- | --- |
| POST | 发送 JSON-RPC Request、Response 或 Notification |
| GET | 可选地建立 Server 到 Client 的 SSE 通道，或恢复中断的 Stream |
| DELETE | 可选地显式结束有状态 MCP Session |

Client 发送 POST 时应同时接受普通 JSON 和 SSE：

```http
POST /mcp HTTP/1.1
Accept: application/json, text/event-stream
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

若 POST 携带 Request，Server 可以返回单个 `application/json` Response，也可以返回 `text/event-stream`，在同一个 Stream 中发送进度、反向请求和最终 Response。若 POST 携带 Notification 或 Response，成功接收通常用 HTTP `202 Accepted` 表示；它仍不产生 MCP Response。

HTTP Status 和 JSON-RPC Error 属于不同层：HTTP 401 表示需要认证，HTTP 403 表示权限不足，JSON-RPC Error 表示一条 MCP Request 的协议处理失败，Tool Result 的 `isError` 表示业务调用失败。

## 一次远程连接主链

```text
Client                                        Server
  │ POST initialize                              │
  ├─────────────────────────────────────────────>│
  │ InitializeResult + optional MCP-Session-Id   │
  │<─────────────────────────────────────────────┤
  │ POST notifications/initialized               │
  ├─────────────────────────────────────────────>│
  │ POST tools/list                              │
  ├─────────────────────────────────────────────>│
  │ tools + nextCursor                           │
  │<─────────────────────────────────────────────┤
  │ POST tools/call                              │
  ├─────────────────────────────────────────────>│
  │ application/json or SSE ... final response  │
  │<─────────────────────────────────────────────┤
  │ DELETE session                               │
  └─────────────────────────────────────────────>│
```

初始化后的 HTTP Request 应携带协商得到的协议版本：

```http
MCP-Protocol-Version: 2025-11-25
```

Server 可以在 Initialize Response 中返回 `MCP-Session-Id`。一旦返回，Client 后续请求必须携带同一个 Header。Session ID 用于关联协议状态，不是 Authentication：Server 仍需验证每个受保护 HTTP Request 的 Access Token。

## Session、断线与恢复

有状态 Server 可以使用 `MCP-Session-Id`，但 Client 不应假设 Session 永久存在：

- 缺少必需 Session ID 时，Server 可以返回 HTTP 400；
- Session 过期时，Server 对旧 ID 返回 HTTP 404；
- Client 收到该 404 后，应重新发送不带 Session ID 的 `initialize`；
- Client 不再需要 Session 时，可以发送带 Session ID 的 DELETE；
- Server 不支持主动删除时，可以返回 HTTP 405。

SSE 断开也不等于 Tool 已取消或失败。若 Server 给 SSE Event 设置唯一 `id`，Client 可以在 GET 中发送 `Last-Event-ID`，请求从断点恢复。重放是消息传输恢复，不是重新执行业务操作。

```text
HTTP disconnect
    ├── 不等于 MCP Cancellation
    ├── 不证明业务操作失败
    └── 可用 Last-Event-ID 请求消息重投递
```

如果写调用在断开前已被外部系统接受，Client 不应直接重试。应先使用幂等键或操作 ID 查询终态。

## Transport 安全基线

远程生产 Endpoint 应使用 HTTPS。本地 HTTP Server 也不是天然安全的：恶意网页可能利用 DNS Rebinding 访问监听在本机的服务。

Streamable HTTP Server 至少应：

- 验证传入的 `Origin`，无效时拒绝请求；
- 本地开发默认只绑定 Loopback，而不是 `0.0.0.0`；
- 对所有受保护连接实施 Authentication；
- 限制 Request、Response、SSE Event 和并发 Stream 的大小与数量；
- 使用不可预测的 Session ID，并避免把它作为用户身份；
- 校验代理、重定向、TLS 和最终目标 Origin。

## Authorization 的参与者

MCP Authorization 面向 HTTP Transport，并且是可选能力。受保护的远程 MCP 中：

| OAuth 角色 | MCP 中的对象 |
| --- | --- |
| Resource Owner | 授权访问数据或动作的用户 |
| OAuth Client | MCP Client / Agent Host |
| Resource Server | 受保护的 MCP Server |
| Authorization Server | 登录、同意并签发 Token 的服务 |

stdio Server 通常不使用这套 HTTP OAuth 流程，而是从受控环境或凭据存储获得 Credential。把 Bearer Token 放进 stdio JSON-RPC 参数会增加泄露风险。

## 从 401 到授权完成

典型发现和授权链是：

```text
Client → MCP Endpoint
    ↓ HTTP 401 + WWW-Authenticate
Protected Resource Metadata
    ↓ authorization_servers + scopes_supported
Authorization Server Metadata / OIDC Discovery
    ↓ authorization endpoint + token endpoint + PKCE support
Client Registration
    ↓ pre-registration / Client ID Metadata Document / DCR
User Login + Consent + PKCE
    ↓ authorization code
Token Request
    ↓ access token bound to MCP Server resource
Client → MCP Endpoint with Authorization header
```

MCP Server 通过 OAuth 2.0 Protected Resource Metadata 表明它对应哪些 Authorization Server。Client 优先读取 401 的 `WWW-Authenticate` 中的 `resource_metadata`；若没有，再尝试约定的 Well-Known 地址。随后 Client 获取 Authorization Server Metadata 或 OIDC Discovery Document。

Client Registration 可以来自预注册、Client ID Metadata Document，或兼容场景中的 Dynamic Client Registration。客户端类型和部署方式会影响选择，不能假设所有 Authorization Server 都支持同一种注册方法。

Authorization Code Flow 必须使用 PKCE。Client 还应验证 `state`、精确匹配 Redirect URI，并拒绝不支持安全 PKCE 方法的 Authorization Server。

## Resource Indicator 与 Token Audience

授权请求和 Token 请求都必须使用 RFC 8707 `resource` 参数标明目标 MCP Server，例如：

```text
resource=https://mcp.example.com/mcp
```

它不是 MCP Resource URI。这里的 Resource Indicator 指 OAuth Token 的目标受众；`customer://123` 一类 URI 才是 MCP Resource Primitive 的身份。

```text
OAuth resource=https://mcp.example.com/mcp
    约束 Access Token 可以交给哪个 MCP Server

MCP Resource customer://123
    标识 Server 暴露的某份可读取内容
```

Client 应把 Access Token 放在每个受保护 HTTP Request 的 Header 中：

```http
Authorization: Bearer <access-token>
```

不要把 Token 放入 URL Query、Tool 参数、模型 Context 或 Trace。MCP Server 必须验证 Token 确实签发给自己，不能接受面向其他服务的 Token。

## 禁止 Token Passthrough

如果 MCP Server 需要调用第三方 API，它同时扮演下游 API 的 OAuth Client。访问下游 API 的 Token 应由下游 Authorization Server 单独签发：

```text
MCP Client --token A--> MCP Server --token B--> Third-party API
```

Server 不能把收到的 Token A 原样转发给第三方 API。Token Passthrough 会破坏 Audience、Scope、审计和租户边界，并可能形成 Confused Deputy。

## Scope Challenge 与 Step-up

身份有效不代表当前 Token 拥有某个 Tool 所需的全部 Scope：

| 状态 | 含义 | 常见处理 |
| --- | --- | --- |
| HTTP 401 | 缺少 Token、Token 无效或过期 | 发现认证信息并重新登录或刷新 |
| HTTP 403 + `insufficient_scope` | 身份有效但 Scope 不足 | 读取 Challenge，执行有限次数的 Step-up |
| Tool `isError=true` | 已进入 MCP Tool，但业务拒绝 | 将业务反馈交给 Host / Agent 处理 |

Step-up 不是无限重试。Client 应记录当前 Resource 和操作已经尝试过的 Scope 升级，限制重新授权次数，并在无法满足时返回明确的永久授权失败。

## 实现与测试清单

### Client

1. 是否在初始化后发送正确的 Protocol Version 和 Session Header？
2. 是否同时支持 JSON Response 和 SSE Response？
3. 是否把断线、取消、超时和未知业务终态分开？
4. 是否安全获取 Protected Resource Metadata 和 Authorization Server Metadata？
5. 是否使用 PKCE、`state`、精确 Redirect URI 和 `resource` 参数？
6. 是否防止 OAuth Metadata Discovery 访问内网地址或跨 Origin 重定向？
7. 是否限制 401、Scope Step-up、重连和重试次数？

### Server

1. 是否验证 Origin、TLS、Token Audience、Scope 和租户？
2. Session ID 是否随机、可过期，并且不被当作 Authentication？
3. 是否拒绝 Query Token 和面向其他 Resource 的 Token？
4. 调用下游 API 时是否使用独立 Token，而不是 Token Passthrough？
5. SSE 重放是否只重放消息，而不会重复执行业务动作？
6. 401、403、JSON-RPC Error 和 Tool Business Error 是否保持分层？

## 推荐练习

先不要把教学任务板直接部署到公网。可以按以下顺序扩展：

1. 使用成熟 SDK 把任务板切换到本地 Streamable HTTP；
2. 观察 initialize POST、Protocol Version Header 和可选 Session ID；
3. 模拟 SSE 中断，用 `Last-Event-ID` 验证消息恢复；
4. 增加一个固定测试 Token，只验证 HTTP 401/403 分层；
5. 最后接入测试 Authorization Server，验证 Metadata Discovery、PKCE、Resource Indicator 和 Scope Step-up。

协议细节以 [MCP Streamable HTTP Transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) 和 [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) 为准。
