# MCP 远程 HTTP 与授权

## 本章解决什么问题

stdio 案例能够展示 MCP 数据层，却不能说明远程 Server 如何建立连接、管理会话、从断线中恢复并完成用户授权。远程 MCP 通常使用 Streamable HTTP：HTTP 负责传输和认证，MCP JSON-RPC 则继续负责初始化、能力发现、调用和反向请求。

```text
Agent 宿主应用
    │ HTTPS + OAuth / Bearer
    ▼
单一 MCP 端点
    │ POST / GET / DELETE + 可选 SSE
    ▼
MCP Server
    │ 下游访问凭据
    ▼
业务 API
```

不要混淆以下三种凭据或标识：MCP Client 访问 MCP Server 使用的 Token、MCP Server 访问下游 API 使用的 Token，以及 MCP HTTP 会话 ID。三者用途不同，不能相互替代。

## 单一 MCP 端点

Streamable HTTP Server 提供一个 MCP 端点，例如：

```text
https://mcp.example.com/mcp
```

它不会为每个 Tool 分别提供一个 REST URL。Client 向同一个端点发送 JSON-RPC 消息：

| HTTP 方法 | 主要用途 |
| --- | --- |
| POST | 发送 JSON-RPC 请求、响应或通知 |
| GET | 可选地建立从 Server 到 Client 的 SSE 通道，或恢复中断的数据流 |
| DELETE | 可选地显式结束有状态 MCP 会话 |

Client 发送 POST 请求时，应声明同时支持普通 JSON 和 SSE：

```http
POST /mcp HTTP/1.1
Accept: application/json, text/event-stream
Content-Type: application/json

{"jsonrpc":"2.0","id":1,"method":"initialize","params":{...}}
```

若 POST 携带请求，Server 可以返回单个 `application/json` 响应，也可以返回 `text/event-stream`，并在同一个数据流中发送进度、反向请求和最终响应。若 POST 携带通知或响应，Server 成功接收后通常返回 HTTP `202 Accepted`；此时仍不会产生 MCP 响应。

HTTP 状态码和 JSON-RPC 错误属于不同层次：HTTP 401 表示需要认证，HTTP 403 表示权限不足，JSON-RPC 错误表示某条 MCP 请求处理失败，而 Tool 调用结果中的 `isError` 表示业务调用失败。

## 一次远程连接的主要流程

```text
Client                                        Server
  │ POST initialize                              │
  ├─────────────────────────────────────────────>│
  │ 初始化结果 + 可选 MCP-Session-Id             │
  │<─────────────────────────────────────────────┤
  │ POST notifications/initialized               │
  ├─────────────────────────────────────────────>│
  │ POST tools/list                              │
  ├─────────────────────────────────────────────>│
  │ tools + nextCursor                           │
  │<─────────────────────────────────────────────┤
  │ POST tools/call                              │
  ├─────────────────────────────────────────────>│
  │ application/json 或 SSE……最终响应           │
  │<─────────────────────────────────────────────┤
  │ DELETE 会话                                  │
  └─────────────────────────────────────────────>│
```

初始化后的 HTTP 请求应携带协商得到的协议版本：

```http
MCP-Protocol-Version: 2025-11-25
```

Server 可以在初始化响应中返回 `MCP-Session-Id`。一旦返回，Client 后续请求必须携带同一个 Header。会话 ID 用于关联协议状态，不能代替身份认证；Server 仍需验证每个受保护 HTTP 请求中的访问令牌。

## 会话、断线与恢复

有状态 Server 可以使用 `MCP-Session-Id`，但 Client 不应假设会话永久存在：

- 缺少必需的会话 ID 时，Server 可以返回 HTTP 400；
- 会话过期时，Server 对旧 ID 返回 HTTP 404；
- Client 收到该 404 后，应重新发送不带会话 ID 的 `initialize`；
- Client 不再需要会话时，可以发送带会话 ID 的 DELETE；
- Server 不支持主动删除时，可以返回 HTTP 405。

SSE 断开也不代表 Tool 已经取消或失败。若 Server 为 SSE 事件设置了唯一的 `id`，Client 可以在 GET 请求中发送 `Last-Event-ID`，请求从断点恢复。重放只用于恢复消息传输，不会重新执行业务操作。

```text
HTTP 连接断开
    ├── 不等于 MCP 取消请求
    ├── 不证明业务操作失败
    └── 可用 Last-Event-ID 请求消息重投递
```

如果写调用在断开前已经被外部系统接受，Client 不应直接重试，而应先使用幂等键或操作 ID 查询最终状态。

## 传输安全基线

生产环境中的远程端点应使用 HTTPS。本地 HTTP Server 也不是天然安全的：恶意网页可能利用 DNS 重绑定攻击访问监听在本机的服务。

Streamable HTTP Server 至少应：

- 验证传入的 `Origin`，无效时拒绝请求；
- 本地开发时默认只绑定回环地址，而不是 `0.0.0.0`；
- 对所有受保护的连接进行身份认证；
- 限制请求、响应、SSE 事件和并发数据流的大小与数量；
- 使用不可预测的会话 ID，并避免把它当成用户身份；
- 校验代理、重定向、TLS 和最终目标的来源（Origin）。

## 授权流程中的参与者

MCP 授权机制面向 HTTP 传输，并且属于可选能力。在受保护的远程 MCP 中：

| OAuth 角色 | MCP 中的角色 |
| --- | --- |
| 资源所有者（Resource Owner） | 授权访问数据或执行操作的用户 |
| OAuth 客户端（OAuth Client） | MCP Client 或 Agent Host |
| 资源服务器（Resource Server） | 受保护的 MCP Server |
| 授权服务器（Authorization Server） | 负责登录、用户同意和签发 Token 的服务 |

stdio Server 通常不使用这套 HTTP OAuth 流程，而是从受控环境或凭据存储中获取凭据。把 Bearer Token 放入 stdio JSON-RPC 参数会增加泄露风险。

## 从 401 到授权完成

典型发现和授权链是：

```text
Client → MCP 端点
    ↓ HTTP 401 + WWW-Authenticate
受保护资源元数据
    ↓ authorization_servers + scopes_supported
授权服务器元数据 / OIDC 发现
    ↓ 授权端点 + Token 端点 + PKCE 支持
客户端注册
    ↓ 预注册 / Client ID 元数据文档 / DCR
用户登录 + 授权同意 + PKCE
    ↓ 授权码
Token 请求
    ↓ 绑定到目标 MCP Server 的访问令牌
Client → 携带 Authorization Header 访问 MCP 端点
```

MCP Server 通过 OAuth 2.0 受保护资源元数据表明它对应哪些授权服务器。Client 优先读取 401 响应的 `WWW-Authenticate` 中的 `resource_metadata`；如果没有，再尝试约定的 `.well-known` 地址。随后，Client 获取授权服务器元数据或 OIDC 发现文档。

客户端注册可以采用预注册、Client ID 元数据文档，或兼容场景中的动态客户端注册。客户端类型和部署方式会影响具体选择，不能假设所有授权服务器都支持同一种注册方式。

授权码流程必须使用 PKCE。Client 还应验证 `state`、精确匹配重定向 URI，并拒绝不支持安全 PKCE 方法的授权服务器。

## 资源指示符与 Token 受众

授权请求和 Token 请求都必须使用 RFC 8707 定义的 `resource` 参数标明目标 MCP Server，例如：

```text
resource=https://mcp.example.com/mcp
```

它不是 MCP Resource URI。这里的资源指示符（Resource Indicator）表示 OAuth Token 的目标受众；`customer://123` 这类 URI 才是 MCP Resource 原语的标识。

```text
OAuth resource=https://mcp.example.com/mcp
    约束访问令牌可以交给哪个 MCP Server

MCP Resource customer://123
    标识 Server 提供的某份可读取内容
```

Client 应把访问令牌放在每个受保护 HTTP 请求的 Header 中：

```http
Authorization: Bearer <access-token>
```

不要把 Token 放入 URL 查询参数、Tool 参数、模型上下文或追踪记录中。MCP Server 必须验证 Token 确实签发给自己，不能接受面向其他服务的 Token。

## 禁止透传 Token

如果 MCP Server 需要调用第三方 API，它同时扮演下游 API 的 OAuth 客户端。访问下游 API 的 Token 应由下游授权服务器单独签发：

```text
MCP Client --token A--> MCP Server --token B--> 第三方 API
```

Server 不能把收到的 Token A 原样转发给第三方 API。透传 Token 会破坏受众、权限范围、审计和租户边界，并可能形成混淆代理问题。

## 权限范围挑战与增量授权

身份有效并不代表当前 Token 已经拥有某个 Tool 所需的全部权限范围：

| 状态 | 含义 | 常见处理 |
| --- | --- | --- |
| HTTP 401 | 缺少 Token、Token 无效或过期 | 发现认证信息并重新登录或刷新 |
| HTTP 403 + `insufficient_scope` | 身份有效但权限范围不足 | 读取挑战信息，执行有限次数的增量授权 |
| Tool `isError=true` | 已进入 MCP Tool，但业务拒绝 | 将业务反馈交给 Host / Agent 处理 |

增量授权不是无限重试。Client 应记录当前 Resource 和操作已经尝试过的权限升级，限制重新授权次数，并在仍无法满足要求时返回明确且不可恢复的授权失败。

## 实现与测试清单

### Client 检查项

1. 是否在初始化后发送正确的协议版本和会话 Header？
2. 是否同时支持 JSON 响应和 SSE 响应？
3. 是否区分断线、取消、超时和业务结果状态未知？
4. 是否安全获取受保护资源元数据和授权服务器元数据？
5. 是否使用 PKCE、`state`、精确 Redirect URI 和 `resource` 参数？
6. 是否防止 OAuth 元数据发现过程访问内网地址或跨来源重定向？
7. 是否限制 401 处理、权限范围升级、重连和重试次数？

### Server 检查项

1. 是否验证来源、TLS、Token 受众、权限范围和租户？
2. 会话 ID 是否随机、可以过期，并且不会被当成身份认证？
3. 是否拒绝 URL 查询参数中的 Token，以及面向其他资源的 Token？
4. 调用下游 API 时是否使用独立 Token，而不是直接透传 Token？
5. SSE 重放是否只重放消息，而不会重复执行业务动作？
6. 401、403、JSON-RPC 错误和 Tool 业务错误是否保持分层？

## 推荐练习

先不要把教学任务板直接部署到公网。可以按以下顺序扩展：

1. 使用成熟 SDK 把任务板切换到本地 Streamable HTTP；
2. 观察 initialize POST、协议版本 Header 和可选的会话 ID；
3. 模拟 SSE 中断，用 `Last-Event-ID` 验证消息恢复；
4. 增加一个固定测试 Token，只验证 HTTP 401/403 分层；
5. 最后接入测试授权服务器，验证元数据发现、PKCE、资源指示符和权限范围升级。

协议细节以 [MCP Streamable HTTP 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)、[MCP 授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization) 和 [MCP 安全最佳实践](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices) 为准。
