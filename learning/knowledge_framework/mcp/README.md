# MCP 学习地图

## 目标

Model Context Protocol（MCP）是 AI 应用与外部能力提供方之间的互操作协议。它不仅能接入 Tool，还能交换 Resource、Prompt，并允许 Server 反向请求 Host 进行 Sampling 或 Elicitation。

```text
MCP = Participants + Lifecycle + Capability Negotiation
    + Server Primitives + Client Primitives
    + Transport + Authorization + Runtime Governance
```

MCP 只规定参与方怎样交换上下文和动作请求，不规定 Agent Loop、Prompt 优先级、审批策略、Sandbox 或完成判定怎样实现。因此：

```text
MCP Tool ∈ Tool System
完整 MCP ⊃ MCP Tool
```

本教程展开 [Agent 知识框架](../agent_knowledge_framework) 中的“Tool 与行动系统”“Context 与知识系统”“人机协作”“安全与治理”和“扩展与互操作”。Tool Runtime 的共性设计仍以 [Tool 与行动系统学习地图](../tool/README.md) 为准。

## 前置知识与范围

开始前最好了解 JSON、HTTP 和函数调用的基本概念。教程会直接展示 JSON-RPC、JSON Schema、OAuth 和 Agent Tool Loop，但不要求读者预先实现过这些协议。完全没有 Agent 背景时，可以先理解“模型提出 Tool Call，Host 执行后把结果交回模型”这一最小循环。

本教程主要覆盖 MCP Core Protocol、Agent Host 集成、Codex 当前实现和工程治理。以下主题只建立边界，不逐项教授：

- MCP Apps 等交互 UI Extension；
- 企业托管认证、Client Credentials 等 Authorization Extension；
- MCP Registry 的发布、审核和聚合；
- 每种语言 SDK 的 API 细节；
- Draft SEP 和尚未进入稳定基线的提案。

这些扩展独立演进，不能因为出现在官方生态中就假设当前 Host 已实现。学习新能力时继续区分 Specification、Extension、产品支持矩阵和具体源码。

## 总体结构

```text
                         MCP Host
                    Agent / AI Application
                              │
             ┌────────────────┴────────────────┐
             │                                 │
        MCP Client A                      MCP Client B
             │                                 │
         stdio transport              Streamable HTTP
             │                                 │
        MCP Server A                     MCP Server B
   Tools / Resources / Prompts      Tools / Resources / Prompts

Server ── Sampling / Elicitation / Logging ──> Client / Host
```

Host 是承载 Agent、模型、Policy 和用户界面的应用。Host 通常为每个 Server 创建一个 Client；Client 维护协议连接，Server 提供外部数据或动作。不要把 Host、Client 和 Server 简化成三个必须独立部署的进程。

## 推荐学习顺序

1. [定位与心智模型](01-position-and-mental-model.md)：MCP 解决什么问题，与 Function Calling、Plugin、App 有什么区别。
2. [架构、生命周期与传输](02-architecture-lifecycle-and-transport.md)：Host、Client、Server 如何建连、协商能力并交换 JSON-RPC 消息。
3. [Server Primitives](03-server-primitives.md)：Tools、Resources 和 Prompts 分别表达动作、上下文和模板。
4. [Client Primitives](04-client-primitives.md)：Sampling、Elicitation、Roots、Logging、Completion 和 Tasks 的调用方向。
5. [Agent 与 Tool 系统集成](05-agent-integration.md)：MCP 如何桥接 Model Provider Tool Calling、Context 和 Agent Loop。
6. [安全与信任](06-security-and-trust.md)：Server、Definition、Credential、Result 和后续动作如何形成信任链。
7. [Codex 集成与源码阅读](07-codex-integration-and-source-reading.md)：区分 MCP 标准能力与当前 Codex 实现。
8. [开发、测试与运维](08-development-testing-and-operations.md)：设计 Server、验证协议并观察生产行为。
9. [MCP 与 CLI](09-mcp-and-cli.md)：区分两种集成边界，理解为什么有些能力会从 MCP 改为 CLI，以及怎样选型和迁移。
10. [远程 HTTP 与 Authorization](10-remote-http-and-authorization.md)：理解单一 HTTP Endpoint、Session、SSE 恢复、OAuth Discovery、PKCE、Audience 和 Scope Step-up。
11. [可运行案例：任务板 MCP Server](../cases/mcp-task-board/README.md)：亲手观察初始化、能力发现、Resource 读取、Tool 调用、业务失败和状态变化。
12. [可运行案例：可切换模型 Provider 的 Agent 集成 MCP](../cases/agent-mcp-demo/README.md)：使用 OpenRouter 或 MiMo，观察 Host 如何把 MCP Tool 转成模型 Function Tool，并在 Agent Loop 中桥接两套调用协议。

初学者可先阅读 01、02、03，再运行任务板案例，然后带着观察到的问题阅读 04、05 和 06；理解 05 的桥接主链后运行可切换 Provider 的 Agent 案例；准备接入远程 Server 时阅读 10；需要在 MCP 和 CLI 之间选型时，在 05 和 06 之后阅读 09；准备阅读 Codex 源码时先完成 01、02、03、05，再进入 07。

## 按目标选择路线

### 30 分钟建立心智模型

阅读 01、02、03 和 05 的流程图，然后运行任务板案例。目标是能解释 Host、Client、Server、Tool Definition、模型 Tool Call 和 MCP Request ID 为什么不是同一个对象。

### 开发 MCP Server

阅读 02、03、06、08；用任务板案例观察原始消息，再用成熟 SDK 重写并使用 Inspector 测试。远程部署前必须继续阅读 10。

### 开发 Agent Host / MCP Client

阅读 02、04、05、06、10，再运行 Agent MCP Demo。重点实现多 Server Catalog、名称与 ID 映射、结果治理、反向 Request、Session 恢复和 Authorization。

### 阅读 Codex 实现

阅读 01、02、03、05 后进入 07。先沿教程给出的主链理解 Connection Manager、Tool Spec、Handler 和 Approval，再下钻 Transport 和 UI。

### 生产安全评审

阅读 06、08、10，并使用其中的检查表分别审查本地 stdio、远程 HTTP、Credential、外部内容和未知终态写操作。

## MCP 在 Agent 知识框架中的位置

| MCP 能力 | Agent 系统中的主要位置 |
| --- | --- |
| Tools | Tool Contract、Catalog、Policy、Runtime |
| Resources | Context Source、选择、预算与 Provenance |
| Prompts | Prompt Template、用户选择与指令治理 |
| Sampling | Model Runtime、预算与嵌套调用 |
| Elicitation | Human–Agent Interaction、暂停与恢复 |
| Roots | Workspace Context 与边界提示 |
| Transport / Authorization | 扩展互操作、安全和凭据 |
| Progress / Cancellation / Tasks | Runtime 生命周期与可靠性 |

这是一张多视角地图，不要求每项能力只出现一次。MCP Tool 可以同时从协议来源、业务能力、安全边界和 Runtime 四个角度分析。

## 稳定基线与阅读原则

本文以 MCP `2025-11-25` 规范为稳定协议基线；Draft 内容不作为默认行为。Tasks 在该版本中仍是实验性能力，必须与核心协议分开理解。Codex 章节以当前仓库源码和当前官方配置参考为准；协议定义了某项能力，不代表 Codex 已经实现或暴露它。

主要规范入口：

- [MCP Architecture](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP 2025-11-25 Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Schema Reference](https://modelcontextprotocol.io/specification/2025-11-25/schema)
- [MCP Streamable HTTP Transport](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP Authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP Security Best Practices](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [Codex config.toml Reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)

## 术语速查

| 术语 | 本教程中的含义 |
| --- | --- |
| Host | 承载 Agent、模型连接、Context、Policy 和用户界面的应用 |
| Client | Host 内代表一个 MCP Server 维护协议连接的组件 |
| Server | 通过 MCP 暴露能力，并可能连接实际业务系统的提供方 |
| Primitive | Tool、Resource、Prompt、Sampling、Elicitation 等协议能力类别 |
| Capability | 初始化时声明的可选协议支持及子能力 |
| Definition | Tool、Resource 或 Prompt 对名称、Schema 和 Metadata 的协议描述 |
| Catalog | Host 治理后实际可供模型或用户选择的能力集合 |
| Observation | Tool Result 经 Host 转换后回写给模型的结果 |
| Transport | stdio、Streamable HTTP 或保持 MCP Data Layer 的自定义传输 |
| Provider Tool Call | 模型 Provider 表达模型选择某个 Tool 的结构化消息 |
| MCP Request ID | 一条 MCP 连接中关联 JSON-RPC Request 与 Response 的 ID |

## 学习完成标准

完成本教程后，应能解释：

1. 为什么 MCP 不只是“一堆 Tool”。
2. Host、Client、Server 与本地、远程部署是什么关系。
3. Data Layer、Transport Layer 和 Authorization 分别负责什么。
4. Tools、Resources、Prompts 的控制者和数据流有何不同。
5. Sampling 与 Elicitation 为什么是 Server 到 Client 的反向请求。
6. Provider Function Calling 与 MCP `tools/call` 为什么是两套协议。
7. Annotation 为什么只是 Policy 输入，而不是安全证明。
8. 如何区分 MCP 标准、Host 产品能力和当前 Codex 实现。
9. 如何测试动态 Catalog、长任务、取消、认证和恶意 Server。
10. 为什么 CLI 不天然优于 MCP，以及怎样根据互操作、上下文成本、治理和交互需求选择集成边界。
11. 一次 MCP 会话如何完成初始化、发现、调用和结果关联，以及 Resource 与 Tool 为什么承担不同职责。
12. Agent Host 如何在模型 Function Tool 和 MCP Tool 之间转换 Definition、Call 与 Result，并独立完成循环终止判断。
13. 为什么 MCP Primitive 不能机械映射成 CRUD，以及“只配置 Server URL 即可接入”依赖 Host 中哪些通用能力。
14. Streamable HTTP 如何处理 Session、SSE 恢复和 Protocol Version，以及断线为什么不等于取消。
15. 远程 MCP OAuth 中 Protected Resource Metadata、PKCE、Resource Indicator、Audience 和 Scope Step-up 分别解决什么问题。
