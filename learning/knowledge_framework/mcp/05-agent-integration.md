# MCP 与 Agent、Tool 系统集成

## 两套协议之间的桥

模型通常不直接发送 MCP JSON-RPC。Host 先把 MCP Tool 转换成 Model Provider 能理解的 Tool Spec，再把模型产生的 Tool Call 路由回 MCP Server：

```text
MCP Server
    │ tools/list
    ▼
MCP Client / Connection Manager
    │ Filter + Normalize + Metadata
    ▼
Agent Tool Catalog
    │ Provider Tool Spec
    ▼
Model Provider API
    │ function_call(name, arguments, call_id)
    ▼
Agent Tool Router / Policy
    │ tools/call(original_name, arguments)
    ▼
MCP Server
    │ CallToolResult
    ▼
Output Governance
    │ function_call_output(call_id, observation)
    ▼
下一轮 Model Input
```

Provider Tool Calling 和 MCP 分别位于桥的两端：前者解决模型决策编码，后者解决外部能力发现与调用。

## Discovery 到 Catalog

`tools/list` 返回的不是最终模型可见列表。Host 还需要：

1. 验证 Server 是否已连接并完成 Capability 协商；
2. 应用 Server 和 Tool 的 Enable、Allowlist、Denylist；
3. 限制 Definition 数量、Schema 深度和总 Token；
4. 规范化名称并处理跨 Server 冲突；
5. 保留原始 Server / Tool 身份供 Runtime 路由；
6. 决定 Direct、Deferred 或 Hidden Exposure；
7. 将 Annotation 作为 Policy 和 Scheduler 的候选输入。

因此“在 MCP Server 注册”不等于“本轮对模型可见”。

## 名称与身份

至少需要保存三类标识：

| 标识 | 用途 |
| --- | --- |
| Server ID | 选择连接、认证和 Server 级 Policy |
| Original Tool Name | 构造 MCP `tools/call` |
| Model-visible Name / Namespace | 满足 Provider 命名规则并避免冲突 |

只保存清洗后的名称会失去协议路由身份；只向模型暴露原始名称则可能违反 Provider 字符集或长度限制。

## 调用与 Policy

模型返回合法 JSON 参数后，Host 仍应进行：

- Schema 和语义验证；
- Tool 是否仍然 Enabled 的检查；
- Annotation、Server 信任和用户配置综合审批；
- Credential Scope 与租户检查；
- 并发门、Timeout、Cancellation 和速率限制；
- Start、Progress、Finish、Abort 事件记录。

`readOnlyHint=true` 可以帮助判断只读调用是否共享并发门，但 Host 不应仅凭它授予数据访问权限。`idempotentHint=true` 也不能自动证明未知终态的调用可无限重试。

## Result 到 Observation

MCP Result 与 Provider Tool Output 的结构不一定一致。桥接层需要：

- 保留文本、结构化内容和媒体的语义；
- 对 Provider 不支持的内容选择附件、摘要或拒绝；
- 区分协议 Error、Tool 业务 Error 和成功结果；
- 截断、脱敏并标记外部内容不可信；
- 用模型 Tool `call_id` 配对回写；
- 防止重复结果或孤立结果破坏 History。

模型看到 Observation 后才能决定继续调用、修正参数或结束。MCP Server 不负责 Agent 的完成判定。

## Resources 和 Prompts 如何接入 Context

Resources 不一定变成模型 Tool。Host 可以提供用户选择器、应用检索、显式的 `list/read resource` Tool，或在可靠规则下直接注入 Context。无论采用哪条路径，都需要 Provenance、权限、新鲜度和 Token 上限。

Prompts 应作为有来源的模板进入 Host 的 Prompt 组装流程。Server 返回的 Message 不应自动覆盖 System、Developer、用户明确指令或组织 Policy。

## Elicitation 与 Agent 状态机

MCP Elicitation 会把一次普通工具调用扩展成等待用户的状态：

```text
Running Tool
    ↓ elicitation/create
Wait for User
    ├── Accept → Resume Tool
    ├── Decline → Return Declined
    ├── Cancel → Abort Tool
    └── Turn Cancel / Disconnect → Release Pending Request
```

Host 必须将 Elicitation Request 与 Server、MCP Request ID、Agent Session、Turn 和用户响应准确关联。

## Context 与预算

大量 MCP Tool Schema 会占用模型上下文并降低缓存命中率。常用控制包括：

- 仅连接当前任务所需 Server；
- 过滤不需要的 Tool；
- 延迟发现或 Tool Search；
- 给 Definition、Result、Resource 设置独立硬上限；
- 对稳定 Catalog 使用版本化缓存；
- Catalog 变化时使相关缓存失效。

优化目标不是“暴露最多能力”，而是在可理解、可授权和可验证的前提下提供最小充分能力面。
