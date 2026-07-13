# MCP 定位与心智模型

## MCP 解决什么问题

没有 MCP 时，每个 AI Host 都需要为数据库、代码托管、知识库和 SaaS 分别设计发现、调用、认证和结果格式。MCP 提供统一的参与者、生命周期、消息和 Primitive，使 Server 能以相同协议向不同 Host 暴露能力。

MCP 的边界是“交换”，不是“决策”：

- Server 描述自己提供的能力；
- Client 与 Server 协商双方支持的功能；
- Host 决定哪些能力进入 Context 或 Tool Catalog；
- Agent 或用户决定何时使用能力；
- Host 的 Policy 和 Runtime 决定是否真正执行。

MCP 不定义 Agent 如何规划、何时停止，也不保证 Server 的描述可信。

## 三类容易混淆的协议

```text
Model Provider Tool Calling
    模型 ↔ Agent Host
    表达“模型选择了哪个工具”

MCP
    MCP Client ↔ MCP Server
    发现和调用外部能力

App-server / Agent Protocol
    产品客户端 ↔ Agent Runtime
    管理 Session、Turn、Approval 和事件
```

一次 MCP Tool 调用经常同时经过三类边界，但它们不能相互替代。

## 与常见扩展概念的关系

| 概念 | 核心职责 | 与 MCP 的关系 |
| --- | --- | --- |
| Function Calling | 模型表达结构化调用 | Host 可把 MCP Tool 转成 Function Tool |
| REST / GraphQL / Database Protocol | 访问具体业务系统 | MCP Server 内部可以再调用这些协议 |
| Plugin | 打包、安装和分发扩展 | Plugin 可以携带 MCP Server 配置 |
| App / Connector | 产品化外部服务接入 | 常以 MCP Tools 为执行面，并增加认证和管理 |
| Skill | 按需加载工作方法和资源 | Skill 可指导 Agent 使用 MCP，但不等于 MCP Server |
| Hook | 生命周期观察或干预 | 可在 MCP 调用前后实施额外 Policy |

“GitHub MCP Tool”可以同时具有多个属性：来源是 MCP，模型调用形态是 Function Call，业务能力是外部 API 写操作，产品分发方式可能是 Plugin 或 Connector。

## 参与者不是部署拓扑

Host、Client 和 Server 是协议角色：

- Host 拥有 Agent、模型连接、用户界面和安全策略；
- Client 代表 Host 与一个 Server 对话；
- Server 暴露 Primitives，并处理来自 Client 的请求。

本地 stdio Server 通常是 Host 启动的子进程；远程 Streamable HTTP Server 通常由外部服务运营。同一个 Server 实现也可能以不同 Transport 部署。

## 双向能力

初学者容易只看到 Client 调 Server：

```text
Client ── tools/list / tools/call ──> Server
Client ── resources/read ───────────> Server
Client ── prompts/get ──────────────> Server
```

完整 MCP 还包含 Server 调 Client：

```text
Server ── sampling/createMessage ──> Client / Model
Server ── elicitation/create ──────> Client / User
Server ── logging notification ────> Client
```

因此 MCP Client 不是只发送 HTTP 请求的薄封装，它还可能接收请求、执行 Policy、等待用户，并把结果返回 Server。

## MCP 不提供的保证

MCP 兼容不等于安全兼容。协议本身不保证：

- Tool 真正只读或幂等；
- Resource 内容没有 Prompt Injection；
- Prompt 应获得更高指令优先级；
- 调用已得到用户授权；
- Server 只能访问声明的目录；
- 重试不会重复产生副作用；
- Agent 会正确使用结果并完成任务。

这些责任分别属于 Server 实现、Host Policy、Sandbox、Agent Loop 和 Verification。

## 分析一个 MCP 集成的五个问题

1. 谁是 Host、Client、Server，执行实际发生在哪里？
2. 双方在初始化时协商了哪些 Capability？
3. 暴露的是 Tool、Resource、Prompt，还是反向 Client Primitive？
4. 定义、参数、凭据、结果和副作用跨越了哪些信任边界？
5. Host 如何过滤、审批、限时、截断、审计和验证？
