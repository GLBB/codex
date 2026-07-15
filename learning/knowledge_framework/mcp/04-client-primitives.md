# MCP 客户端原语与辅助能力

## 为什么称为客户端原语

Tool、Resource 和 Prompt 由 Server 提供，并由 Client 发起使用；Sampling、Elicitation 和 Roots 则由 Client 向 Server 声明，Server 可以反向发起请求。这意味着 Host 不仅要能调用 Server API，还必须能够接收和处理 MCP 请求。

## Sampling：请求 Host 调用模型

Server 可以发送 `sampling/createMessage`，请求 Client 使用 Host 管理的模型生成内容。这样，Server 不必直接持有模型 API Key，而 Host 仍能控制模型选择、预算、上下文和权限。

```text
MCP Server
    │ sampling/createMessage
    ▼
MCP Client / Host 策略
    │ 模型服务请求
    ▼
模型
    │ 生成结果
    ▼
MCP Client ── 响应 ──────> MCP Server
```

在 `2025-11-25` 规范中，Sampling 可以携带 Tool 定义和 `toolChoice`，但 Client 必须先声明 `sampling.tools` 能力。嵌套的工具调用循环会带来额外的预算、审批和递归问题：Server 请求 Sampling，并不意味着它可以绕过 Host 的工具使用策略。

Host 至少要限制可用模型、最大 Token 数、上下文来源、可用工具范围、嵌套深度、总成本和结果可见范围。

## Elicitation：请求用户输入

Server 可以通过 `elicitation/create` 请求 Client 向用户收集信息。结果通常分为接受、拒绝和取消三种状态，不能把它们都简化成空字符串。

`2025-11-25` 的 Elicitation 能力可以分别声明表单（Form）和 URL 两种模式：表单模式使用受限 Schema 收集结构化字段；URL 模式让用户在受信任的外部页面完成授权或其他敏感交互。Client 只能使用初始化时声明支持的模式，并应校验 URL、来源（Origin）、响应关联和超时。

Elicitation 可用于补充缺失字段或跳转到授权页面，但不能成为窃取凭据的通道。Host 应展示 Server 身份、请求原因、字段类型和数据去向，限制密码、Token 等敏感字段，并允许用户拒绝提供信息。

```text
Server 请求 → Host 策略 → 用户界面 → 用户决定 → Server 响应
                          │
                          └── 当前轮次可能进入等待状态
```

Agent 轮次取消、会话关闭或连接断开时，待处理的 Elicitation 必须结束，并记录明确的最终状态。

一次表单式 Elicitation 的关联关系可以表示为：

```text
tools/call 请求 id=20
    ↓ Server 处理到缺少字段
elicitation/create 请求 id=server-7
    ↓ Host 展示表单并等待用户
接受（Accept）/ 拒绝（Decline）/ 取消（Cancel）
    ↓ 响应 server-7
Server 恢复 tools/call
    ↓ 对 id=20 的最终响应
```

外层 Tool 请求 ID 和内层 Elicitation 请求 ID 必须分别保存。用户选择 Decline 表示拒绝提供信息，选择 Cancel 表示取消交互；两者都不能伪装成字段为空的 Accept。

## Roots：Workspace 提示

Roots 允许 Client 向 Server 提供可操作的根 URI 列表，常用于文件系统工作区。Roots 只是上下文和边界提示，Server 不能把它当成不可绕过的沙箱；Server 进程实际能访问哪些内容，仍由操作系统权限、容器和 Host 的执行策略决定。

Roots 发生变化时，支持相应能力的 Client 可以通知 Server。Host 应避免向 Server 提供无关目录、用户名或敏感路径。

## Logging、Completion 与通知

- 日志（Logging）：Server 向 Client 发送分级日志；Host 应截断和脱敏，避免默认把日志注入模型。
- 补全（Completion）：为 Prompt 参数或 Resource URI 提供补全建议；建议仍需验证，不能直接视为已经获得授权的值。
- 进度（Progress）：长请求报告执行进度；进度消息不代表最终成功。
- 取消（Cancellation）：请求对方停止工作；确认取消不代表外部副作用已经回滚。
- 列表变更（List Changed）：通知能力目录发生变化；Host 重新获取列表后仍要再次应用过滤和安全策略。

## Ping 与分页

双方都可以发送 `ping` 请求，检查对端是否仍能处理协议消息。Ping 只能证明协议端点能够响应，不能证明外部 API、凭据、某个 Tool 或业务数据库处于正常状态。生产环境中的健康检查应分别记录传输层、MCP 协议层和下游依赖的状态。

`resources/list`、`resources/templates/list`、`prompts/list` 和 `tools/list` 等列表操作可以分页。MCP 使用不透明 Cursor，而不是页码：

```text
list() → items + nextCursor
list(cursor=nextCursor) → items + nextCursor?
```

Client 不应解析游标、假设固定页大小，也不应在不同 Server、身份或能力目录版本之间复用游标。Host 还应限制最大页数、最大条目数，以及能力定义占用的最大 Token 数，防止“合法分页”演变成无界的上下文注入。

## Tasks：实验性的持久执行机制

`2025-11-25` 引入了实验性的 Tasks，用于封装耗时请求，并支持状态查询、稍后获取结果和取消操作。它主要解决“单个 JSON-RPC 请求必须一直保持连接”的限制。

Tasks 不能与 Agent 的 Goal、Task 对象混为一谈：

| 对象 | 作用域 |
| --- | --- |
| Agent Task | 产品中的目标、状态、计划、结果和生命周期 |
| MCP Task | 一个 MCP 请求的持久执行包装 |
| 模型服务响应 | 一次模型服务请求的响应及其状态 |

由于 Tasks 仍是实验性能力，教程和实现应进行版本检测与能力协商，不要把它作为所有 Server 的基础依赖。

## 反向请求的统一处理

对 Sampling 和 Elicitation，Host 都应回答：

1. 哪个 Server 发起请求，当前连接身份是什么？
2. 请求会消耗什么模型、用户数据或外部权限？
3. 是否允许自动处理，还是必须展示给用户？
4. 待处理请求如何与会话、轮次和 JSON-RPC `id` 关联？
5. 超时、取消或断开连接后，如何结束等待？
6. 请求和结果怎样进入 Trace，但不泄露敏感内容？
