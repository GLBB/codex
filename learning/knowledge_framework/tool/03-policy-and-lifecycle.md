# Policy 与生命周期

## Policy 位于哪里

Tool Contract 回答“调用是否符合接口”，Policy 回答“这个主体在当前环境中是否允许执行这个动作”。不要把安全规则只写进 Description，因为模型遵循描述不构成强制边界。

Tool Definition 中的 Capability / Risk Metadata 是 Policy 的输入，不是 Policy 本身。`read_only_hint`、`destructive_hint`、`open_world_hint` 等术语及其生效阶段见 [Tool Contract：Capability 与 Risk Metadata](01-tool-contract.md#capability-与-risk-metadata)。

```text
Valid Tool Call
      ↓
Hook / Rule / Approval
      ↓
Sandbox / Network / Credential Boundary
      ↓
Execution
```

## PreToolUse、PermissionRequest 与 PostToolUse

生命周期 Hook 提供可观察和可干预的控制点：

- `PreToolUse`：执行前记录、阻断或在允许时改写输入；
- `PermissionRequest`：把具体权限请求交给规则、用户或审查器；
- `PostToolUse`：记录结果、附加上下文，或阻止不合适的结果进入模型上下文。

Hook 是扩展机制，不应成为唯一安全边界。Hook 失败、未加载或配置错误时，Sandbox 和权限策略仍应独立生效。

Codex 的统一入口位于 `codex-rs/core/src/tools/registry.rs`。阅读 `dispatch_any_with_terminal_outcome` 时，关注 Pre Hook、Handler、Post Hook 和生命周期通知的顺序。

## Approval 与 Sandbox

两者解决的问题不同：

| 机制 | 核心问题 |
| --- | --- |
| Approval | 用户或策略是否同意执行这个动作？ |
| Sandbox | 动作实际能够访问哪些资源？ |

批准一个命令不意味着必须关闭 Sandbox；在 Sandbox 中运行也不意味着动作无需审批。Codex 将审批解析集中在 `codex-rs/core/src/tools/approvals.rs`，将审批、Sandbox 选择和重试顺序集中在 `codex-rs/core/src/tools/orchestrator.rs`。

## Network Policy

网络控制应至少包含：

- 是否允许联网；
- 允许和拒绝的域名或地址；
- 本地网络、代理和 Unix Socket；
- 重定向后的最终目标；
- 请求中是否包含凭据或敏感数据。

“允许访问互联网”过于宽泛。生产系统应优先表达最小目标集合，并记录实际访问目标。

## Authentication 与外部信任

认证回答“以谁的身份调用”，授权回答“该身份可以做什么”。MCP、Database 和 SaaS 工具还需要考虑：

- Token 来源和 Scope；
- 用户身份还是服务身份；
- 凭据是否暴露给模型或日志；
- 外部返回内容是否可能包含 Prompt Injection；
- 外部服务的留存、合规和可用性边界。

## Threat Model

Tool 系统把不可信的模型输出和外部内容连接到真实副作用，因此安全分析不能只检查参数 Schema。至少要覆盖：

| 威胁 | 典型场景 | 主要控制 |
| --- | --- | --- |
| Prompt Injection | 网页或 MCP Result 指示模型读取密钥并调用发送工具 | 外部内容标记为不可信、最小工具面、数据流 Policy、关键动作审批 |
| Tool Poisoning | 恶意 Server 提供误导 Description、Schema 或 `read_only_hint` | Server 信任、Catalog 过滤、Schema 上限、Host 自有 Policy、保守默认值 |
| Confused Deputy | 低权限用户诱导 Agent 使用高权限服务身份操作资源 | 绑定用户身份、Scope 检查、资源级授权、审计主体 |
| Data Exfiltration | 只读工具取得私有数据后，经 Web/API Tool 发送到外部 | 数据分类、跨工具信息流控制、域名 Allowlist、输出脱敏 |
| SSRF | URL 参数访问云 Metadata、本机服务、内网或 Unix Socket | URL 解析、DNS/IP 校验、重定向复检、网络 Sandbox |
| Command / SQL / Path Injection | 参数被拼接进 Shell、SQL 或文件路径 | 结构化参数、参数化查询、路径规范化、避免字符串拼接 |
| Credential Leakage | Token 出现在 Prompt、命令行、日志或 Tool Output | 运行时注入、环境隔离、日志脱敏、禁止模型读取凭据 |
| Supply Chain | Plugin、Extension、MCP Server 或更新包被篡改 | 来源验证、签名或固定版本、最小权限、安装审批 |
| Approval Fatigue | 频繁宽泛弹窗导致用户机械允许 | 展示具体动作和目标、缩小批准范围、合并同类低风险请求 |
| TOCTOU | 审批后文件、URL、分支或远端资源发生变化 | 审批绑定规范化目标和版本，执行前重新验证 |

防御应形成多层边界：

```text
Minimized Tool Exposure
    → Parameter and Semantic Validation
    → Policy / Approval
    → Sandbox / Network / Credential Boundary
    → Output and Information-flow Control
    → Audit / Detection / Revocation
```

模型拒绝危险指令是有用的第一层，但不能代替上述强制控制。外部 Tool Output 进入模型上下文后仍是不可信数据，不会因为已经经过某个 Tool Handler 就自动变成可信指令。

## 生命周期事件

建议统一表达：

```text
Requested → Started → Progress* → Completed
                    ↘ Failed
                    ↘ Rejected
                    ↘ Aborted
                    ↘ TimedOut
```

事件应携带稳定 Tool Name、`call_id`、来源、时长和结果类别，但日志预览必须有界并避免泄露凭据。

Codex 的开始、结束和中止通知分别分布在 `codex-rs/core/src/tools/lifecycle.rs`、`events.rs` 和 `tool_dispatch_trace.rs`。理解调用顺序后再进入这些文件，避免把遥测事件误认为执行控制本身。

## Policy 设计检查

1. 哪些规则由代码强制，哪些只是模型提示？
2. 审批对象是否展示了命令、路径、网络目标和理由？
3. 批准范围是单次、会话还是持久规则？
4. Sandbox、网络和凭据是否遵循最小权限？
5. 外部 Tool Output 是否被当作不可信数据？
6. 每种终态是否只发出一次，且能够审计来源？
7. 是否分析了跨工具数据流，而不只是单个工具的副作用？
8. Approval 是否绑定了执行时重新验证的具体目标和版本？
9. MCP、Plugin 和 Hosted Tool 的信任根与撤销机制是什么？
