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
