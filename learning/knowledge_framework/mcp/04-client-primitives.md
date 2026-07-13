# MCP Client Primitives 与辅助能力

## 为什么称为 Client Primitive

Tools、Resources、Prompts 由 Server 提供，Client 发起使用；Sampling、Elicitation 和 Roots 则由 Client 向 Server 声明，Server 可以反向请求。方向变化意味着 Host 必须能够接收 MCP Request，而不只是调用 Server API。

## Sampling：请求 Host 调用模型

Server 可以发送 `sampling/createMessage`，请求 Client 使用 Host 管理的模型生成内容。这样 Server 不必直接持有模型 API Key，Host 仍控制模型选择、预算、上下文和权限。

```text
MCP Server
    │ sampling/createMessage
    ▼
MCP Client / Host Policy
    │ provider request
    ▼
Model
    │ generated result
    ▼
MCP Client ── response ──> MCP Server
```

在 `2025-11-25` 规范中，Sampling 可以携带 Tool 定义和 `toolChoice`，但 Client 必须先声明 `sampling.tools` Capability。嵌套 Tool Loop 会引入新的预算、审批和递归问题：Server 请求 Sampling，不代表它可以绕过 Host 的 Tool Policy。

Host 至少要限制：模型范围、最大 Token、上下文来源、Tool 面、嵌套深度、总成本和结果可见性。

## Elicitation：请求用户输入

Server 可以通过 `elicitation/create` 请求 Client 向用户收集信息。结果通常区分 Accept、Decline 和 Cancel；不能把三者折叠成空字符串。

Elicitation 可用于补充缺失字段或跳转到授权页面，但不应成为窃取凭据的通道。Host 应展示 Server 身份、请求原因、字段类型和数据去向，限制密码、Token 等敏感字段，并让用户能够拒绝。

```text
Server Request → Host Policy → User UI → User Decision → Server Response
                          │
                          └── Turn 可能进入 Wait 状态
```

Agent Turn 取消、Session 关闭或连接断开时，Pending Elicitation 必须解除并写入明确终态。

## Roots：Workspace 提示

Roots 允许 Client 向 Server 提供可操作的根 URI 列表，常用于文件系统工作区。Roots 是上下文与边界提示，不应被 Server 当成不可绕过的 Sandbox：Server 进程真正能访问什么仍由操作系统权限、容器和 Host 执行策略决定。

Roots 变化时，支持相应 Capability 的 Client 可以通知 Server。Host 应避免暴露无关目录、用户名或敏感路径。

## Logging、Completion 与通知

- Logging：Server 向 Client 发送分级日志；Host 应截断、脱敏并避免把日志默认注入模型。
- Completion：为 Prompt 参数或 Resource URI 提供补全建议；建议仍需验证，不能直接视为授权值。
- Progress：长请求报告进度；进度不是最终成功结果。
- Cancellation：请求停止工作；取消确认不等于外部副作用已回滚。
- List Changed：通知 Capability Catalog 变化；Host 重新发现后仍要重新治理。

## Tasks：实验性耐久请求

`2025-11-25` 引入实验性 Tasks，用于包装耗时请求，支持状态查询、延迟结果获取和取消。它试图解决“单个 JSON-RPC 请求必须一直保持连接”的限制。

Tasks 不能与 Agent 的 Goal、Task 对象混为一谈：

| 对象 | 作用域 |
| --- | --- |
| Agent Task | 产品中的目标、状态、计划、结果和生命周期 |
| MCP Task | 一个 MCP 请求的耐久执行包装 |
| Provider Response | 一次模型服务请求或响应状态 |

由于 Tasks 仍是实验性能力，教程和实现应进行版本检测与 Capability 协商，不要把它作为所有 Server 的基础依赖。

## 反向请求的统一治理

对 Sampling 和 Elicitation，Host 都应回答：

1. 哪个 Server 发起请求，当前连接身份是什么？
2. 请求会消耗什么模型、用户数据或外部权限？
3. 是否允许自动处理，还是必须展示给用户？
4. Pending Request 如何与 Session、Turn 和 JSON-RPC `id` 关联？
5. Timeout、Cancel、Disconnect 后如何解除等待？
6. 请求和结果怎样进入 Trace，但不泄露敏感内容？
