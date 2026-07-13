# Tool 与行动系统学习地图

## 目标

Tool 系统把模型生成的候选动作转换成真实世界中的受控操作。学习这部分时，不要把 Tool 简化成一个可调用函数；完整系统至少包含接口契约、目录规划、安全策略、执行运行时、结果回写和能力分类。

本文档组展开 [Agent 知识框架](../agent_knowledge_framework) 中的 Tool 与行动系统：

```text
Model-visible Contract
        ↓
Provider Protocol / Tool Call
        ↓
Catalog / Exposure Planning
        ↓
Agent Tool Loop / Routing
        ↓
Policy / Approval / Sandbox
        ↓
Runtime / External System
        ↓
Output / Observation / Context
```

本组只研究 MCP Tool 如何进入 Tool Catalog、Policy 和 Runtime。MCP 还包含 Resources、Prompts、Sampling、Elicitation、Transport 和 Authorization，完整内容见 [MCP 学习地图](../mcp/README.md)。

## 推荐学习顺序

1. [Tool Contract](01-tool-contract.md)：模型如何认识并表达一次工具调用。
2. [Model Provider API 与 Tool 协议](08-provider-api-protocol.md)：工具合约如何进入请求，以及调用、流式事件和结果如何在 API 上闭环。
3. [Tool Catalog 与规划](02-tool-catalog-and-planning.md)：工具从哪里来、哪些工具对模型可见。
4. [Policy 与生命周期](03-policy-and-lifecycle.md)：执行前后如何审批、隔离、拦截和审计。
5. [Tool Runtime](04-tool-runtime.md)：调用怎样被解析、调度、取消并回写结果。
6. [能力类型](05-capability-types.md)：文件、进程、浏览器、外部服务和 Agent 控制能力的差异。
7. [主要 Tool 的关键设计](07-major-tool-designs.md)：对照 Shell、Patch、MCP、Tool Search 和控制类工具的状态与安全边界。
8. [Agent Tool Loop、可靠性与评估](09-agent-loop-reliability-and-evaluation.md)：模型如何连续决策，以及系统怎样限制预算、恢复故障并验证质量。
9. [Codex 源码阅读路线](06-codex-source-reading.md)：完成概念学习后，沿一条工具调用主链阅读当前实现。

初学者按上述顺序阅读；只做架构设计时重点阅读 01、02、03、04、08、09；已有 Agent 基础并准备跟源码时，可以先读 README、08，再进入 06。

## 术语速查

| 术语 | 本文含义 |
| --- | --- |
| Tool Contract / Definition / Spec | 工具对模型和协议暴露的名称、描述、输入、输出与调用形态；具体实现中三者边界可能不同 |
| Catalog | 候选工具及其来源、状态和 Metadata 的集合 |
| Model-visible Specs | 本轮真正发送给模型、允许模型选择的工具定义 |
| Registry | Host 能够按名称路由到的本地执行器集合 |
| Handler / Executor | 接收归一化调用并完成具体业务动作的实现 |
| Tool Call / Invocation | 模型或嵌套 Runtime 发起的一次工具调用 |
| Tool Output / Observation | 执行结果及其写回模型上下文的表示 |
| Provider / Model Service | 接收模型请求并返回 Tool Call 或执行 Hosted Tool 的服务 |
| Host / Runtime | 组装请求、实施策略并执行本地工具的 Agent 系统 |
| Exposure | 工具是 Direct、Deferred、Model-only 还是 Hidden |
| Approval | 是否同意当前具体动作；不等同于 Sandbox |
| Hosted Tool | Provider 实现和执行、Host 按请求声明的工具 |
| MCP Server | 通过 MCP 暴露 Tools、Resources、Prompts 等能力的协议端点；完整 MCP 不只是 Tool |
| App / Connector | App 是用户可管理的产品级集成；Connector 是其外部服务连接层或历史兼容名称 |

## 源码验证基线

本文档面向当前仓库中的 Codex 实现，通用原则与 Codex 实现会分别表述。源码路径最近以 `openai/codex` 上游基线 `c888e8e75a`（2026-07-12）核对。后续源码演进可能改变类型名、文件位置或 Provider 能力，跟读时应以当前分支实现为准。

## 五层模型

### Contract

Contract 是模型可见的接口。它回答：工具叫什么、适合做什么、输入如何编码、输出具有什么语义。概念上，它与 Instructions、对话历史共同构成模型上下文；在线路协议中通常是独立的 `tools` 字段，而不是拼接进自然语言 Prompt。

### Catalog

Catalog 是当前会话中可用工具的集合。它回答：工具来自 Core、Hosted、MCP、Extension 还是 Dynamic Source；当前模型、配置、权限和环境是否支持它；它应直接暴露还是延迟发现。

### Policy

Policy 决定一个合法调用是否允许执行。Schema 合法不代表动作安全。审批、文件权限、网络策略、身份凭据、Hook 和外部信任都属于这一层。

### Runtime

Runtime 把 Tool Call 转成真实操作，负责参数反序列化、语义验证、并发、超时、取消、进程管理、输出截断和错误分类。

### Observation

执行结果必须与原始 `call_id` 配对，并以模型协议能够理解的形式写回上下文。缺失、重复或无限大的 Tool Output 都会破坏 Agent Loop。

## 三个不要混淆的维度

| 维度 | 示例 | 回答的问题 |
| --- | --- | --- |
| 调用形态 | Function、Freeform、Hosted | 模型如何表达调用？ |
| 工具来源 | Core、MCP、Extension、Dynamic | 谁提供定义和执行器？ |
| 业务能力 | File、Shell、Browser、Database | 工具实际能做什么？ |

`MCP Tool` 是来源和协议分类，`read_file` 是业务能力分类，`Function Tool` 是调用形态。三者可以同时描述同一个工具。

## 学习完成标准

完成本组文档后，应能解释：

1. 为什么 Tool Spec 和 Tool Runtime 需要绑定，但不能混为一谈。
2. 为什么注册进 Runtime 的工具不一定对模型可见。
3. 为什么参数通过 JSON Schema 校验后仍需要语义和权限检查。
4. 为什么审批和 Sandbox 是不同的控制机制。
5. 为什么并发安全不能由模型自行决定。
6. 可恢复工具错误为什么应写回模型，而不是直接终止 Agent。
7. 如何保证 Tool Call 与 Tool Output 成对、有界且可审计。
8. 模型如何根据 Observation 决定继续调用还是结束，以及怎样避免无限 Tool Loop。
9. Tool Call 在超时、响应丢失和进程崩溃后如何安全恢复。
10. 如何通过 Contract Test、Integration Test、Adversarial Eval 和运行指标验证 Tool 系统。
