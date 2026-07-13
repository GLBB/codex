# Tool Contract

## Contract 的职责

Tool Contract 是模型和执行系统之间的协议边界。模型根据名称、描述和参数定义决定是否调用工具；Runtime 根据同一契约解析输入并生成对应结果。

一个完整 Contract 应考虑：

```text
Identity + Invocation Encoding + Input Contract
         + Output Contract + Capability Metadata
```

## Identity

名称应该稳定、可区分并适合模型选择。Namespace 用于组织来自不同服务器、插件或能力域的同名工具。Description 应说明适用场景和关键限制，而不是重复字段名称。

在 Codex 中，先打开 `codex-rs/tools/src/tool_spec.rs` 看 `ToolSpec`，再打开 `codex-rs/tools/src/responses_api.rs` 看 `ResponsesApiTool`、`ResponsesApiNamespace` 和 `FreeformTool`。到这些类型为止，先不要进入具体 Handler。

## 调用编码

### Function

Function Tool 使用结构化参数，通常由 JSON Schema 描述。适合字段明确、需要类型约束的调用，例如读取资源、启动进程或查询状态。

### Freeform

Freeform Tool 接收一段受 Grammar 或文本规则约束的输入。Codex 的 `apply_patch` 使用这种形式，因为 Patch 文本用 JSON 字符串包装会增加转义和生成难度。对应实现位于 `codex-rs/core/src/tools/handlers/apply_patch_spec.rs`。

### Namespace

Namespace 把多个相关工具放入一个命名空间，降低命名冲突并支持按能力域组织工具。它不是权限边界，不能代替认证或审批。

### Hosted

Hosted Tool 由模型服务端执行，本地 Runtime 可能只发送定义和接收事件。它与本地 Function Tool 的主要差异是执行位置和控制边界，而不是业务名称。

## Input Contract

输入契约至少包含：

- 字段类型、必填项和额外字段策略；
- 枚举、范围、长度和格式；
- Strictness；
- 省略值与显式 `null` 的语义；
- 版本兼容和废弃策略。

Schema 只能证明输入形状基本合法，不能证明路径位于工作区、SQL 查询是只读、URL 域名被允许或当前用户有权限。这些属于 Handler 语义验证和 Policy。

## Output Contract

输出应区分：

- 模型继续推理需要的结果；
- 用户界面需要的展示；
- 日志和审计需要的原始信息；
- 成功、失败、部分成功和截断状态。

在 Codex 中，`codex-rs/tools/src/tool_output.rs` 定义共享输出抽象，`codex-rs/core/src/tools/context.rs` 展示 MCP、Tool Search、Function 和 Exec 输出如何转换成模型协议项。

## Capability 与 Risk Metadata

常见元数据包括只读、破坏性、开放网络、支持并发、外部上下文和所需认证。它们主要帮助 Catalog、Policy 和 Runtime 做决策，不应被视为不可绕过的安全证明。

尤其需要注意：

- `read_only` 是能力声明，不等于实现绝对无副作用；
- `idempotent` 不等于可以无限重试；
- `destructive=false` 不等于没有数据泄露风险；
- Timeout 通常是 Runtime 配置，不是模型接口的固有属性。

## Contract 设计检查

设计一个新工具时，逐项回答：

1. 名称和描述能否让模型与相似工具区分？
2. 应使用 Function 还是 Freeform？
3. 输入是否存在无界字符串、集合或递归结构？
4. 输出是否明确表达成功、失败、截断和分页？
5. 哪些字段涉及路径、网络、身份或敏感数据？
6. 哪些元数据只是 Hint，必须由 Runtime 再验证？
