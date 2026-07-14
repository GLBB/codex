# MCP 与 CLI：集成边界与选型

## 先明确比较对象

“CLI 与 MCP”至少可能指两个不同问题：

1. 用户通过 CLI、TUI 或 IDE 使用一个 Agent；
2. Agent 通过通用 Shell Tool 调用外部 CLI，或通过 MCP Client 调用 MCP Server。

第一个问题比较的是产品入口，第二个问题比较的是外部能力集成边界。本章讨论第二个问题。Codex 本身可以是 CLI 产品，同时作为 MCP Host 调用外部 MCP Server；两者并不冲突。

还要区分“由命令启动”和“通过 CLI 集成”。本地 stdio MCP Server 通常由 Host 执行一条带 `command` 和 `args` 的命令启动，但启动后双方交换的是 MCP JSON-RPC 消息。它仍是 MCP 集成，不是 Agent 自己拼接业务命令、读取 stdout 的 CLI 集成。

```text
CLI 集成
Model → Shell Tool → external-cli subcommand → stdout / stderr

MCP 集成
Model → Host Tool Router → MCP Client → MCP Server → structured result
```

## 两者解决的问题不同

CLI 是面向人、脚本和进程组合的命令界面。它通常提供子命令、Flag、退出码、stdout 和 stderr，也可以选择输出 JSON 或 JSONL。Agent 经由 Shell Tool 使用 CLI 时，Host 主要治理的是进程和命令执行；命令内部有哪些业务动作，未必具有独立的 Tool 身份。

MCP 是 Host 与外部能力提供方之间的互操作协议。它定义初始化、Capability Negotiation、Tool 与 Resource 发现、结构化调用、通知、取消以及 Server 到 Client 的请求。Agent 通常不会直接生成 MCP JSON-RPC，而是由 Host 把 MCP Tool 转换为模型可见的 Tool，再将调用路由给 Server。

因此，CLI 的核心优势是复用和简洁，MCP 的核心优势是标准化的发现、交换和治理。二者都不负责替代业务 API、Agent Loop 或真正的操作系统安全边界。

## 对比维度

| 维度 | Agent 调用 CLI | Agent 调用 MCP |
| --- | --- | --- |
| 初始接入 | 已有稳定 CLI 时成本低 | 需要 MCP Server、Client 兼容和生命周期处理 |
| 能力发现 | 依赖 Skill、文档、`--help` 或自定义发现命令 | 原生支持 Tool、Resource 和 Prompt 列表及变化通知 |
| 参数 | Shell 参数或 stdin；结构和转义由调用方处理 | JSON Schema 描述的结构化参数 |
| 结果 | stdout、stderr、退出码；可约定 JSON / JSONL | Tool Result、Structured Content、Resource Link 等协议结构 |
| 模型上下文 | 可只在需要时加载某个命令的说明 | 直接暴露大量 Tool Definition 时可能占用较多上下文 |
| Host Policy | 常以整条命令、可执行文件和 Sandbox 为边界 | 可按 Server、Tool、Annotation、配置和参数实施治理 |
| 交互 | stdin/stdout 约定，非交互运行时容易失效 | Elicitation 等能力具有明确的请求、关联和终态 |
| 复用 | 人、脚本和 CI 容易直接使用 | 不同 MCP Host 可以复用同一个 Server |
| 调试 | 终端中容易复现单条命令 | 能观察结构化生命周期，但需要协议日志或 Inspector |
| 主要风险 | Shell 注入、参数转义、文本解析、Credential 出现在命令或日志 | Tool Poisoning、Definition 膨胀、远程副作用、Capability 和授权错误 |

表中的优劣依赖实现。CLI 如果提供稳定的 JSON 输出、严格的参数验证和可靠退出码，可以成为很好的 Agent 接口；MCP Server 如果暴露巨型 Catalog、返回无界文本或依赖不可信 Description，也不会自动变得可靠。

## 为什么有些集成从 MCP 改为 CLI

### 1. 复用已有的成熟产品面

业务系统已经拥有稳定 CLI 时，认证、分页、重试、配置和错误处理可能都已实现。让 Skill 指导 Agent 调用现有命令，通常比维护另一套 MCP Adapter 更轻。人也能在终端复现相同调用，有利于本地调试和自动化。

### 2. 减少静态 Tool Catalog

一个大型 MCP Server 可能暴露几十或几百个 Tool。若 Host 把这些 Definition 全部放入每轮模型上下文，会增加 Token、降低缓存命中率，并扩大模型的选择空间。CLI 可以把能力组织成子命令，由 Skill 只在任务需要时提供相关用法。

这不是 CLI 独有的胜利。MCP Host 也可以使用 Allowlist、延迟发现、分页、Tool Search 或按任务构建 Catalog。真正的问题是“能力是否按需暴露”，而不是“是否使用 MCP”。

### 3. 调用主要是本地、确定和一次性的

格式化文件、运行构建、查询本地状态等操作通常已经天然适合进程模型。若不需要远程多租户、动态发现、Resource、Elicitation 或长连接通知，引入完整协议层的收益可能有限。

### 4. 降低集成和版本维护成本

MCP 集成需要处理协议版本、Capability、连接状态、超时、取消、Catalog 变化和 Host 兼容性。能力范围较小且只服务一个受控 Agent 时，CLI 的维护面可能更合理。

这些原因只能说明 CLI 在特定约束下更合适，不能推出 CLI 普遍优于 MCP。一次迁移也可能是产品分发、认证体系、实现成熟度或团队维护能力的变化，而不是协议能力的排序。

## 什么时候优先选择 MCP

当同一能力需要被多个 Host 使用，或者需要动态发现、精细 Tool Policy、结构化多媒体结果、Resource、Prompt、Elicitation、Sampling、进度和取消时，MCP 更接近问题本身。远程 SaaS、多租户身份和长期演进的公共集成也通常更需要稳定的协议边界。

选择 MCP 时仍要控制 Catalog 大小、结果上限和 Credential；不要把“协议结构化”误认为“业务安全”。Annotation 只是 Policy 输入，远程 Server 的真实副作用仍由外部授权、Scope、审批和审计约束。

## 什么时候优先选择 CLI

当已有成熟 CLI、消费者主要是一个本地 Agent、操作容易用一次性进程表达，并且 Skill 能稳定约束命令和解析结构化输出时，CLI 往往更经济。开发工具链、构建系统和本地运维命令通常符合这些条件。

用于 Agent 的 CLI 最好提供：

- 稳定的非交互模式和机器可读 JSON / JSONL 输出；
- 明确且稳定的退出码与错误分类；
- stdin 或环境注入 Credential，避免敏感值出现在命令行；
- 幂等键、Dry Run 或可查询的操作 ID，用于有副作用的命令；
- 输出大小、等待时间和分页上限；
- `--help` 中清楚描述参数、默认值和副作用。

Host 还应对可执行文件、子命令、工作目录、环境变量、网络和文件权限实施约束。只在 Prompt 中告诉模型“小心使用”不构成安全边界。

## 不应直接迁移的能力

从 MCP Tool 改成 CLI 子命令相对直接，但完整 MCP 不只包含 Tool。下列能力如果被压缩成一次普通 Shell 调用，往往会丢失语义：

- Resource 的 URI、订阅、寻址和缓存语义；
- Prompt 的发现和用户选择语义；
- Elicitation 的 Accept、Decline、Cancel 和请求关联；
- Sampling 的模型、Token、Tool 与嵌套预算控制；
- Progress、Cancellation、Logging 和实验性 Task 的生命周期；
- 动态 Catalog 变化及每个 Tool 独立的 Policy 身份。

迁移前应逐项判断这些能力是否未使用、可以由 Host 的其他机制承接，还是会退化为脆弱的文本约定。不能只验证“命令最终执行成功”。

## 选型路径

先确认能力的消费者和部署位置。如果它面向多个 Host、运行在远程服务中，或需要完整 MCP Primitive，优先从 MCP 设计；如果它已经是成熟的本地 CLI，且只需要少量确定性动作，先验证 CLI 是否足够。

接着检查模型可见面。无论选择哪种方式，都只暴露本任务需要的能力：MCP 侧过滤 Catalog，CLI 侧限制可执行文件和子命令。然后检查返回契约、Credential、审批、超时、取消、幂等和审计，最后用真实 Host 测试完整 Observation 闭环。

```text
需要多 Host 互操作、动态发现或完整 MCP Primitive？
├── 是 → 优先 MCP
└── 否
    已有稳定、非交互、机器可读的 CLI？
    ├── 是 → 优先评估 CLI + Skill
    └── 否 → 比较两种公共契约的长期维护成本
```

## 共存通常比二选一更好

业务逻辑可以放在共享库或服务层，上层同时提供 CLI Adapter 和 MCP Adapter。CLI 服务人、脚本、CI 和本地诊断；MCP 服务支持该协议的 Agent Host。两层共享认证核心、参数校验、幂等和结果类型，避免各自复制业务规则。

```text
                 Shared Domain Service
                    /              \
             CLI Adapter        MCP Adapter
          Human / Script / CI    Agent Hosts
```

这种结构也使迁移变成分发面的调整，而不是重写业务能力。是否同时维护两种 Adapter，应由消费者数量和互操作收益决定；小型内部工具不必为了架构对称而增加第二个入口。

## 从 MCP 迁移到 CLI 的检查表

1. 列出原 Server 使用的 Tools、Resources、Prompts 和 Client Primitives，不要只统计 Tool。
2. 为每项能力标明消费者、调用频率、参数和返回结构、最大大小、副作用及授权方式。
3. 说明迁移目标：减少 Catalog、复用现有 CLI、改善分发，还是停止维护 MCP Adapter。
4. 为 CLI 定义机器可读输出、错误分类、超时、取消、分页和版本兼容规则。
5. 映射原有 Tool Approval、Allowlist、Credential、Provenance 和审计能力；记录无法等价映射的部分。
6. 对写操作验证幂等、未知终态和重试行为，对文本结果验证截断与 Prompt Injection 隔离。
7. 使用真实 Agent Host 比较迁移前后的任务成功率、Token、延迟、错误恢复和可观测性。
8. 只有在消费者完成迁移且不再依赖 MCP 特有语义后，才移除 MCP 入口。

判断迁移是否成功，不应只看代码量或单次调用延迟。更重要的是：能力是否仍可发现、调用是否仍可治理、结果是否仍可验证，以及失去的互操作能力是否确实不再需要。
