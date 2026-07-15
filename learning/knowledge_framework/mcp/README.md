# MCP 学习地图

## 目标

模型上下文协议（Model Context Protocol，MCP）是 AI 应用与外部能力提供方之间的互操作协议。它不仅能接入 Tool，还能交换 Resource 和 Prompt，并允许 Server 向 Host 发起 Sampling 或 Elicitation 请求。

```text
MCP = 参与角色 + 生命周期 + 能力协商
    + 服务端原语 + 客户端原语
    + 传输 + 授权 + 运行时治理
```

MCP 只规定参与方如何交换上下文和操作请求，并不规定 Agent 循环、提示词优先级、审批策略、沙箱或完成条件如何实现。因此：

```text
MCP Tool ∈ Tool System
完整 MCP ⊃ MCP Tool
```

本教程展开 [Agent 知识框架](../agent_knowledge_framework) 中的“Tool 与行动系统”“上下文与知识系统”“人机协作”“安全与治理”和“扩展与互操作”。Tool 运行时的通用设计仍以 [Tool 与行动系统学习地图](../tool/README.md) 为准。

## 前置知识与范围

开始前最好了解 JSON、HTTP 和函数调用的基本概念。教程会直接展示 JSON-RPC、JSON Schema、OAuth 和 Agent 工具调用循环，但不要求读者事先实现过这些协议。完全没有 Agent 背景时，可以先理解“模型提出工具调用，Host 执行后把结果交回模型”这一最小循环。

本教程主要覆盖 MCP 核心协议、Agent 宿主应用集成、Codex 当前实现和工程治理。以下主题只说明其适用范围和与核心协议的关系，不展开具体实现：

- MCP Apps 等交互界面扩展；
- 企业托管认证、客户端凭据（Client Credentials）等授权扩展；
- MCP Registry 的发布、审核和聚合；
- 每种语言 SDK 的 API 细节；
- SEP 草案和尚未进入稳定基线的提案。

这些扩展独立演进，不能因为某项能力出现在官方生态中，就假设当前 Host 已经实现。学习新能力时，应继续区分核心规范、扩展、产品支持矩阵和具体源码。

## 总体结构

```text
                         MCP Host
                    Agent / AI 应用
                              │
             ┌────────────────┴────────────────┐
             │                                 │
        MCP Client A                      MCP Client B
             │                                 │
          stdio 传输                  Streamable HTTP
             │                                 │
        MCP Server A                     MCP Server B
   Tools / Resources / Prompts      Tools / Resources / Prompts

Server ── Sampling / Elicitation / Logging ──> Client / Host
```

Host 是承载 Agent、模型连接、运行策略和用户界面的宿主应用。Host 通常为每个 Server 创建一个 Client；Client 维护协议连接，Server 提供外部数据或操作。不要把 Host、Client 和 Server 简化成三个必须独立部署的进程。

## 推荐学习顺序

1. [定位与心智模型](01-position-and-mental-model.md)：MCP 解决什么问题，与 Function Calling、Plugin、App 有什么区别。
2. [架构、生命周期与传输](02-architecture-lifecycle-and-transport.md)：Host、Client、Server 如何建连、协商能力并交换 JSON-RPC 消息。
3. [服务端原语](03-server-primitives.md)：Tool、Resource 和 Prompt 分别表达操作、上下文和模板。
4. [客户端原语](04-client-primitives.md)：Sampling、Elicitation、Roots、Logging、Completion 和 Tasks 的调用方向。
5. [Agent 与 Tool 系统集成](05-agent-integration.md)：MCP 如何连接模型服务的工具调用、上下文和 Agent 循环。
6. [安全与信任](06-security-and-trust.md)：Server、能力定义、凭据、调用结果和后续操作如何形成信任链。
7. [Codex 集成与源码阅读](07-codex-integration-and-source-reading.md)：区分 MCP 标准能力与当前 Codex 实现。
8. [开发、测试与运维](08-development-testing-and-operations.md)：设计 Server、验证协议并观察生产行为。
9. [MCP 与 CLI](09-mcp-and-cli.md)：区分两种集成边界，理解为什么有些能力会从 MCP 改为 CLI，以及怎样选型和迁移。
10. [远程 HTTP 与授权](10-remote-http-and-authorization.md)：理解单一 HTTP 端点、会话、SSE 恢复、OAuth 发现、PKCE、受众校验和权限范围升级。
11. [可运行案例：任务板 MCP Server](../cases/mcp-task-board/README.md)：亲手观察初始化、能力发现、Resource 读取、Tool 调用、业务失败和状态变化。
12. [可运行案例：可切换模型服务的 Agent 集成 MCP](../cases/agent-mcp-demo/README.md)：使用 OpenRouter 或 MiMo，观察 Host 如何把 MCP Tool 转成模型函数工具，并在 Agent 循环中适配两套调用协议。

初学者可先阅读 01、02、03，再运行任务板案例，然后带着观察到的问题阅读 04、05 和 06；理解 05 的主要适配流程后，运行可切换模型服务的 Agent 案例；准备接入远程 Server 时阅读 10；需要在 MCP 和 CLI 之间选型时，在 05 和 06 之后阅读 09；准备阅读 Codex 源码时先完成 01、02、03、05，再进入 07。

## 按目标选择路线

### 30 分钟建立心智模型

阅读 01、02、03 和 05 的流程图，然后运行任务板案例。目标是能解释 Host、Client、Server、Tool 定义、模型工具调用和 MCP 请求 ID 为什么不是同一个对象。

### 开发 MCP Server

阅读 02、03、06、08；用任务板案例观察原始消息，再用成熟的 SDK 重写，并使用 Inspector 测试。远程部署前必须继续阅读 10。

### 开发 Agent Host / MCP Client

阅读 02、04、05、06、10，再运行 Agent MCP Demo。重点理解多 Server 能力目录、名称与 ID 映射、结果处理、反向请求、会话恢复和授权流程。

### 阅读 Codex 实现

阅读 01、02、03、05 后进入 07。先沿教程给出的主要调用链理解连接管理器、Tool 定义、处理器和审批流程，再继续阅读传输层和用户界面实现。

### 生产安全评审

阅读 06、08、10，并使用其中的检查表分别审查本地 stdio、远程 HTTP、凭据、外部内容，以及结果状态未知的写操作。

## MCP 在 Agent 知识框架中的位置

| MCP 能力 | Agent 系统中的主要位置 |
| --- | --- |
| Tool | 工具契约、能力目录、策略和运行时 |
| Resource | 上下文来源、选择、预算和来源追踪 |
| Prompt | 提示词模板、用户选择和指令治理 |
| Sampling | 模型运行时、预算和嵌套调用 |
| Elicitation | 人机交互、暂停与恢复 |
| Roots | 工作区上下文和边界提示 |
| 传输与授权 | 扩展互操作、安全和凭据 |
| 进度、取消与 Tasks | 运行时生命周期和可靠性 |

这张表从多个角度描述 MCP，不要求每项能力只归入一个位置。例如，可以同时从协议来源、业务能力、安全边界和运行时四个角度分析一个 MCP Tool。

## 稳定基线与阅读原则

本文以 MCP `2025-11-25` 规范为稳定协议基线；草案内容不作为默认行为。Tasks 在该版本中仍是实验性能力，必须与核心协议分开理解。Codex 章节以当前仓库源码和当前官方配置参考为准；规范定义了某项能力，并不代表 Codex 已经实现或对外提供它。

主要规范入口：

- [MCP Architecture](https://modelcontextprotocol.io/docs/learn/architecture)
- [MCP 2025-11-25 Specification](https://modelcontextprotocol.io/specification/2025-11-25)
- [MCP Schema Reference](https://modelcontextprotocol.io/specification/2025-11-25/schema)
- [MCP Streamable HTTP 传输规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/transports)
- [MCP 授权规范](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP 安全最佳实践](https://modelcontextprotocol.io/docs/tutorials/security/security_best_practices)
- [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector)
- [Codex config.toml Reference](https://learn.chatgpt.com/docs/config-file/config-reference#configtoml)

## 术语速查

| 术语 | 本教程中的含义 |
| --- | --- |
| 宿主应用（Host） | 承载 Agent、模型连接、上下文、运行策略和用户界面的应用 |
| Client | Host 内负责连接某个 MCP Server 并维护协议会话的组件 |
| Server | 通过 MCP 提供能力，并可能连接实际业务系统的服务端 |
| 协议原语（Primitive） | Tool、Resource、Prompt、Sampling、Elicitation 等协议能力类别 |
| 能力声明（Capability） | 初始化时声明支持的可选协议功能及其子能力 |
| 能力定义（Definition） | 对 Tool、Resource 或 Prompt 的名称、参数结构和附加信息的协议描述 |
| 能力目录（Catalog） | Host 经过过滤和策略检查后，实际提供给模型或用户选择的能力集合 |
| 工具结果（Observation） | Tool 调用结果经 Host 转换后回写给模型的内容 |
| 传输方式（Transport） | stdio、Streamable HTTP，或其他保持 MCP 数据层语义的自定义传输 |
| 模型工具调用 | 模型服务用来表示模型选择某个 Tool 的结构化消息 |
| MCP 请求 ID | 在一条 MCP 连接中关联 JSON-RPC 请求与响应的 ID |

## 学习完成标准

完成本教程后，应能解释：

1. 为什么 MCP 不只是“一堆 Tool”。
2. Host、Client、Server 与本地、远程部署是什么关系。
3. 数据层、传输层和授权机制分别负责什么。
4. Tools、Resources、Prompts 的控制者和数据流有何不同。
5. Sampling 与 Elicitation 为什么是 Server 到 Client 的反向请求。
6. 模型服务的函数调用与 MCP `tools/call` 为什么是两套协议。
7. 为什么注解只是策略判断的参考信息，而不是安全证明。
8. 如何区分 MCP 标准、Host 产品能力和当前 Codex 实现。
9. 如何测试动态能力目录、长任务、取消、认证和恶意 Server。
10. 为什么 CLI 不天然优于 MCP，以及怎样根据互操作、上下文成本、治理和交互需求选择集成边界。
11. 一次 MCP 会话如何完成初始化、发现、调用和结果关联，以及 Resource 与 Tool 为什么承担不同职责。
12. Agent Host 如何在模型函数工具和 MCP Tool 之间转换能力定义、调用和结果，并独立判断循环何时结束。
13. 为什么 MCP 原语不能机械映射成 CRUD，以及“只配置 Server URL 即可接入”依赖 Host 中哪些通用能力。
14. Streamable HTTP 如何处理会话、SSE 恢复和协议版本，以及断线为什么不等于取消。
15. 远程 MCP OAuth 中的受保护资源元数据、PKCE、资源指示符、受众和权限范围升级分别解决什么问题。
