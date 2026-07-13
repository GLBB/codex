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

Hosted Tool 由模型服务端实现和执行，但客户端仍要在每次模型请求中声明是否启用，并传递本轮配置。这里的“本地定义”不是重新实现工具，而是服务端 API 契约的本地请求表示。

```text
模型服务端
    拥有工具实现和正式 API 契约

Codex 本地
    根据 Provider、Model、Feature 和 Policy 决定本轮是否声明
    将 Hosted Tool 类型及 allowed domains、mode、location 等配置写入请求
    接收并记录服务端返回的 Tool Call 事件和结果
```

Hosted Tool 通常没有对应的本地 `ToolExecutor`。它可以出现在模型可见 Tool Specs 中，但不会进入本地 `ToolRegistry → Handler` 执行链。它与本地 Function Tool 的主要差异是执行所有权和控制边界，而不是业务名称。

如果客户端不在请求中声明 Hosted Tool，即使服务端具备该能力，也不应默认认为当前模型 Turn 可以使用。显式声明使工具可用性、隐私、联网范围和成本策略能够按请求变化。

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

### 术语

**Metadata** 是附着在 Tool Definition、Tool Registry Entry 或 Runtime 配置上的结构化描述。它不是工具的业务参数，而是供 Catalog、Policy、Scheduler 和 Runtime 判断“是否暴露、是否审批、怎样执行”的控制信息。

**Capability Metadata** 描述工具具有什么能力或执行特征，例如是否只读、是否支持并发、是否需要认证。它主要回答“工具能做什么、运行时应怎样处理”。

**Risk Metadata** 描述调用可能影响哪些安全属性，例如是否会破坏数据、是否访问外部世界、是否可能接触敏感上下文。它主要回答“调用可能造成什么后果、是否需要额外控制”。

**Hint / Annotation** 表示工具提供方对自身性质的声明，例如 MCP 的 `read_only_hint`。`hint` 可以作为决策输入，但不表示 Host 已经验证声明绝对成立。来自第三方 MCP Server 的 Hint 尤其应被视为外部信任输入。

**Policy** 是 Host 根据 Metadata、用户配置、管理员规则和具体调用参数作出的允许、拒绝或审批决定。Metadata 是事实输入，Policy 才是决策逻辑。

**Runtime Enforcement** 是 Sandbox、网络隔离、只读凭据、Timeout 和并发锁等实际强制机制。它负责让决策真正生效。

### 常见字段

| 术语 | 基本含义 | 主要消费者 | 常见用途 |
| --- | --- | --- | --- |
| `read_only` / `read_only_hint` | 主要业务操作不修改目标数据 | Catalog、Approval、Scheduler | 降低写操作审批、允许安全并发 |
| `destructive` / `destructive_hint` | 可能删除、覆盖或产生难以恢复的修改 | Exposure Policy、Approval | 隐藏高风险工具、强制确认 |
| `open_world` / `open_world_hint` | 会访问本地信任边界之外的网络、服务或数据 | Exposure Policy、Approval、Network Policy | 联网审批、域名限制、防止数据外传 |
| `idempotent` / `idempotent_hint` | 使用同一幂等键或等价输入重复调用时，目标业务状态不继续变化 | Retry Policy | 判断瞬时错误后是否可以有限重试 |
| `supports_parallel_tool_calls` | Handler 和后端允许该工具与其他调用并发执行 | Scheduler、Runtime | 选择共享执行门还是独占执行门 |
| `requires_auth` / Auth Scope | 调用依赖用户或服务身份及其授权范围 | Catalog、Credential Manager、Policy | 登录检查、Scope 检查、凭据注入 |
| External Context / Data Sensitivity | 工具读取或返回第三方、私有或敏感上下文 | Exposure Policy、Output Policy | 数据分级、脱敏、限制进入模型上下文 |
| Timeout / Deadline | 一次执行允许占用的最长时间 | Runtime | 超时取消、进程清理、返回终态 |

Timeout 经常和这些字段一起配置，但更准确地说，它是 **Runtime Control Metadata**，不是模型理解工具能力所必需的 Tool Contract 字段。同一工具在本地、远程和后台执行环境中可以使用不同 Timeout。

### 在生命周期的什么阶段生效

Metadata 不会在一个统一时刻“自动生效”。不同组件在不同阶段读取它：

```text
Definition / Discovery
        ↓ 记录 Hint、认证需求和并发能力
Catalog / Exposure
        ↓ 决定 Enabled / Hidden / Deferred
Model Tool Selection
        ↓ 模型只能选择已暴露工具
PreToolUse / Approval
        ↓ 结合具体参数决定 Allow / Ask / Reject
Runtime Admission
        ↓ 选择并发门、凭据、Sandbox、网络和 Deadline
Execution / Output
        ↓ 强制边界、脱敏、审计和错误分类
Retry / Recovery
        ↓ 结合幂等性、错误类型和重试预算决定是否重试
```

| 阶段 | Metadata 的作用 | 产生的效果 |
| --- | --- | --- |
| Definition / Discovery | Tool、MCP Server 或 Extension 声明能力和风险 | 只形成候选描述，尚未授权执行 |
| Catalog / Exposure | 结合 Provider、Feature、认证和管理员策略过滤工具 | 决定是否进入本轮模型可见 `tools` |
| Model Selection | Description 可以提示使用条件 | 影响模型选择，但不形成安全边界 |
| PreToolUse / Approval | 结合 Metadata 和实际参数评估具体动作 | 允许、询问用户、交给 Guardian 或拒绝 |
| Runtime Admission | 读取并发、认证、网络和执行配置 | 串行或并行、选择凭据与执行环境 |
| Execution / Output | Runtime 实施 Timeout、Sandbox、截断和脱敏 | 真正限制副作用和信息流 |
| Retry / Recovery | 同时检查幂等性、瞬时错误、次数与总 Deadline | 有限重试或把错误回写模型 |

### Codex 中的具体例子

以 MCP Tool 为例：

1. MCP Server 返回 Tool Definition 和 Annotations；
2. App Tool Policy 使用 `destructive_hint`、`open_world_hint` 过滤模型可见工具；
3. 模型产生调用后，Approval Logic 使用 `read_only_hint`、`destructive_hint`、`open_world_hint` 判断是否询问；
4. Runtime 使用 Server 的并发声明或 `read_only_hint` 判断是否获取共享执行门；
5. MCP Connection Manager 实施调用 Timeout，结果处理再进行截断和回写。

相关源码入口：

- Exposure：`codex-rs/core/src/mcp_tool_exposure.rs`；
- Approval：`codex-rs/core/src/mcp_tool_call.rs` 的 `requires_mcp_tool_approval`；
- MCP 并发声明：`codex-rs/core/src/tools/handlers/mcp.rs` 的 `supports_parallel_tool_calls`；
- Runtime 并发门：`codex-rs/core/src/tools/parallel.rs` 的 `handle_tool_call_with_source`。

模型请求中的全局 `parallel_tool_calls` 与单工具的 `supports_parallel_tool_calls` 不同：前者允许模型一次生成多个调用，后者决定 Runtime 是否真的并行执行。即使模型生成了多个调用，不支持并发的工具仍会通过独占执行门串行化。

当前 Codex 不会仅因为 MCP 声明 `idempotent_hint=true` 就对所有失败调用自动重试。幂等声明只有被 Retry Policy 消费时才产生行为。

### 为什么 Metadata 不是安全证明

尤其需要注意：

- `read_only` 不等于绝对无副作用：读取仍可能写审计日志、消耗配额、产生费用，错误实现也可能修改数据；
- `idempotent` 不等于可以无限重试：重复调用仍可能产生日志、费用、限流和外部通知；
- `destructive=false` 不等于没有数据泄露风险：不修改数据的搜索工具仍可能读取并外传敏感信息；
- `supports_parallel_tool_calls=true` 不等于实现没有数据竞争：Host 仍要用锁、隔离和测试保证并发安全；
- `requires_auth=true` 不等于已经获得正确权限：还要检查身份、Token Scope、资源授权和凭据边界；
- Timeout 结束等待不等于撤销副作用：超时前发生的写入或外部请求可能已经完成。

安全设计应采用保守默认值：Metadata 缺失时，不自动假设只读、非破坏、可并发或可重试。Codex 的 MCP 审批和并发路径也采用类似原则——缺少可信声明时倾向审批和串行执行。

### 一个完整示例

假设 CRM MCP Tool 声明：

```text
name = search_customers
read_only_hint = true
destructive_hint = false
open_world_hint = true
supports_parallel_tool_calls = true
requires_auth = true
```

这些字段不会直接产生“安全执行”，而是依次参与：

1. Catalog 检查 Connector 是否启用、用户是否完成认证；
2. Exposure Policy 判断允许模型看到这个外部查询工具；
3. Approval Policy 根据只读、外部访问和当前模式决定是否询问用户；
4. Credential Manager 注入最小 Scope 的 CRM Token；
5. Scheduler 允许它与其他只读查询并发；
6. Network Policy 只允许访问 CRM 域名；
7. Output Policy 对客户信息进行截断和脱敏。

真正阻止访问其他域名的是 Network Policy，真正限制客户权限的是 Token Scope，真正防止无限运行的是 Runtime Timeout；都不是 Metadata 标签本身完成的。

## Contract 设计检查

设计一个新工具时，逐项回答：

1. 名称和描述能否让模型与相似工具区分？
2. 应使用 Function 还是 Freeform？
3. 输入是否存在无界字符串、集合或递归结构？
4. 输出是否明确表达成功、失败、截断和分页？
5. 哪些字段涉及路径、网络、身份或敏感数据？
6. 哪些元数据只是 Hint，必须由 Runtime 再验证？
7. 每个 Metadata 由哪个组件、在哪个生命周期阶段消费？
8. Metadata 缺失或互相矛盾时采用什么保守默认值？
