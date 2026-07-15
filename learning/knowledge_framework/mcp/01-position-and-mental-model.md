# MCP 定位与心智模型

## MCP 解决什么问题

没有 MCP 时，每个 Agent 或 AI 应用都需要分别设计外部能力的发现、调用、认证和结果格式。MCP 统一定义了 Host、Client、Server 等参与角色，以及生命周期、消息格式和协议原语（Primitive），使 Server 能通过同一套协议向不同 Host 提供能力。

MCP 的边界是“交换”，不是“决策”：

- Server 描述自己能够提供的能力；
- Client 与 Server 协商双方支持的功能；
- Host 决定哪些能力可以进入模型上下文或工具目录；
- Agent 或用户决定何时使用能力；
- Host 的策略和运行时决定是否真正执行调用。

MCP 不定义 Agent 如何规划、何时停止，也不保证 Server 的描述可信。

## 三类容易混淆的协议

```text
模型服务的工具调用协议
    模型 ↔ Agent 宿主应用
    表达“模型选择了哪个工具”

MCP
    MCP Client ↔ MCP Server
    发现和调用外部能力

App-server / Agent Protocol
    产品客户端 ↔ Agent 运行时
    管理会话、轮次、审批和事件
```

一次 MCP Tool 调用经常同时经过三类边界，但它们不能相互替代。

## 与常见扩展概念的关系

| 概念 | 核心职责 | 与 MCP 的关系 |
| --- | --- | --- |
| Function Calling | 模型表达结构化调用 | Host 可把 MCP Tool 转换为模型函数工具 |
| REST / GraphQL / 数据库协议 | 访问具体业务系统 | MCP Server 内部可以继续调用这些协议 |
| Plugin | 打包、安装和分发扩展 | Plugin 可以携带 MCP Server 配置 |
| App | 用户可安装、启用和授权的产品级集成 | 可由 Connector 或自定义 MCP Server 提供外部能力 |
| Connector | App 背后的外部服务连接层或历史兼容名称 | 管理服务提供方、认证、用户连接、权限范围和操作映射 |
| Skill | 按需加载工作方法和资源 | Skill 可指导 Agent 使用 MCP，但不等于 MCP Server |
| Hook | 观察或干预生命周期 | 可在 MCP 调用前后实施额外策略 |

“GitHub MCP Tool”可以同时具有多重属性：它通过 MCP 提供，模型以函数调用的形式使用它，实际业务能力是调用外部 API 执行写操作，产品则可能通过 Plugin 或 App 分发。

## App 与 Connector

在当前 OpenAI 产品术语中，ChatGPT 原有的 Connector 已主要改称 App；现有功能没有因为改名而消失，但源码、配置和兼容协议仍可能出现 Connector。做架构分析时应继续区分：

```text
App
    用户看到和管理的完整产品集成
        ↓
Connector / Connection
    外部服务类型、OAuth、用户账号、租户和权限范围
        ↓
MCP Server / 服务适配器
    提供或映射具体 Tool 与数据
```

由 Connector 支持的 App 通过连接器访问产品管理的外部服务；Custom App 可以通过开发者提供的 MCP Server 开放操作。反过来，通过 `config.toml` 直接连接的本地 MCP Server 虽然可以提供 Tool，却未必具有 App 的安装页面、图标、管理员策略和产品级认证流程。

因此，在工具目录中，Tool 的协议定义来自 MCP Server；App 或 Connector 则提供产品身份、认证连接、启停状态和策略上下文。术语变化见 [OpenAI MCP 与 Apps 文档](https://developers.openai.com/api/docs/mcp)，数据流关系见 [Apps 与 Connectors](https://learn.chatgpt.com/docs/enterprise/apps-and-connectors#understand-data-flow-and-security)。

## 参与者不是部署拓扑

Host、Client 和 Server 是协议角色：

- Host 拥有 Agent、模型连接、用户界面和安全策略；
- Client 代表 Host 与一个 Server 对话；
- Server 提供协议原语，并处理来自 Client 的请求。

本地 stdio Server 通常是由 Host 启动的子进程；远程 Streamable HTTP Server 通常独立部署和运行。同一个 Server 实现也可以采用不同的传输方式。

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
Server ── 日志通知 ────────────────> Client
```

因此，MCP Client 不只是发送 HTTP 请求的简单封装层；它还可能接收 Server 发来的请求、执行策略检查、等待用户输入，再把结果返回 Server。

## MCP 不提供的保证

MCP 兼容不等于安全兼容。协议本身不保证：

- Tool 真正只读或幂等；
- Resource 内容不包含提示词注入攻击；
- Prompt 应获得更高指令优先级；
- 调用已得到用户授权；
- Server 只能访问声明的目录；
- 重试不会重复产生副作用；
- Agent 会正确使用结果并完成任务。

这些责任分别由 Server 实现、Host 策略、沙箱、Agent 循环和结果验证承担。

## 分析一个 MCP 集成的五个问题

1. 谁是 Host、Client、Server，执行实际发生在哪里？
2. 双方在初始化时协商了哪些能力？
3. Server 提供的是 Tool、Resource、Prompt，还是由 Server 发起的 Client 原语？
4. 定义、参数、凭据、结果和副作用跨越了哪些信任边界？
5. Host 如何过滤、审批、限时、截断、审计和验证？
