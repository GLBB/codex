# MCP 安全与信任

## 信任链

一次 MCP 集成至少跨越以下链路：

```text
Server 来源与版本
    ↓
Tool / Resource / Prompt Definition
    ↓
Host 过滤、展示与模型选择
    ↓
参数、身份和 Credential
    ↓
Server 与外部系统执行
    ↓
Result / Resource / Prompt Content
    ↓
模型后续决策和副作用
```

任何一层被误信都可能把“外部数据”升级成“可信指令”或把一次只读任务升级成写操作。

## 主要威胁

| 威胁 | 例子 | 主要控制 |
| --- | --- | --- |
| Tool Poisoning | Description 诱导模型读取密钥 | Server 信任、Definition 审查、最小 Tool 面 |
| Annotation 欺骗 | 写工具声明 `readOnlyHint=true` | 保守默认、Host Policy、审计与 Server Allowlist |
| Prompt Injection | Resource 要求忽略用户并调用发送工具 | Provenance、不可信标记、数据流 Policy、关键动作审批 |
| 数据外传 | Tool 参数携带无关源码或客户数据 | 最小披露、字段 Policy、域名与 Scope 控制 |
| Credential 泄露 | Token 出现在 Prompt、参数、日志或 Result | Runtime 注入、Secret Store、脱敏、禁止模型读取 |
| Confused Deputy | Server 借 Host 高权限访问其他租户 | 用户绑定、Audience、租户检查和最小 OAuth Scope |
| Supply Chain | 本地 Server 包或更新被篡改 | 固定版本、来源验证、安装审批、隔离运行 |
| Availability | 巨型 Schema、无限 Result、卡死请求 | 大小硬上限、Timeout、并发和速率限制 |
| Elicitation 欺骗 | 伪装登录表单收集密码 | 显示 Server 身份、字段限制、URL 和 Origin 校验 |
| Sampling 滥用 | Server 嵌套模型和 Tool 调用消耗预算 | Capability、审批、深度、Token 和成本上限 |

## Annotation 的正确位置

Annotation 的生命周期是：

```text
Server Definition
    ↓ 外部声明
Catalog 保存
    ↓
Approval / Scheduler / Retry Policy 读取
    ↓ 与 Host Policy、用户配置、身份共同决策
Runtime 执行
```

它不会在 Schema Validation 阶段自动变成授权，也不会替代 Sandbox。`destructiveHint=false` 只表示 Server 声称工具主要不是破坏性的，不表示没有写入、隐私或外传风险。

## Approval、Sandbox、Authentication

三者回答不同问题：

| 机制 | 回答的问题 |
| --- | --- |
| Authentication | 当前连接以谁的身份访问 Server？ |
| Authorization / Scope | 该身份在外部系统可以做什么？ |
| Approval | 用户是否允许当前具体动作？ |
| Sandbox / Isolation | 即使代码恶意，实际能访问什么？ |

远程 MCP Tool 通常在 Server 侧执行，本地文件 Sandbox 未必能约束远程副作用；此时必须依靠外部 Scope、Tool Policy、Approval 和审计。本地 stdio Server 则应受到进程、文件、网络和环境变量隔离。

## 不可信内容治理

Tool Result、Resource 和 Prompt 都可能包含自然语言指令。Host 应：

- 保留 Server、URI、Tool、时间和身份 Provenance；
- 将外部内容作为数据而非高优先级指令；
- 限制内容进入 Prompt 的位置和长度；
- 在内容触发外部写操作前重新执行 Policy；
- 避免把 Secret、内部 Policy 或其他 Server 的私有 Context 转发出去；
- 为用户提供调用来源与数据去向的可见性。

## 认证与凭据

远程 Server 常使用 OAuth 或 Bearer Token，本地 Server 可能通过环境变量获得凭据。安全设计应包括：

- Token 不进入模型 Context；
- 仅 Runtime 在调用时注入；
- Scope、Audience、租户和用户身份一致；
- Refresh、撤销和过期有明确处理；
- 日志、错误与 Trace 不记录 Secret；
- Server 配置不能从不可信项目静默覆盖高权限凭据。

对于受保护的远程 Streamable HTTP Server，还要区分 OAuth Resource Indicator 与 MCP Resource URI，验证 Token Audience，并禁止把 Client 交给 MCP Server 的 Token 原样传给下游 API。Protected Resource Metadata、PKCE、Scope Challenge 和 Step-up 的完整流程见 [远程 HTTP 与 Authorization](10-remote-http-and-authorization.md)。

## 安全评审清单

1. Server 的来源、运营者、版本和更新机制是什么？
2. Tool、Resource、Prompt 哪些对当前用户可见？
3. Annotation 缺失、错误或互相矛盾时如何处理？
4. Credential 由谁持有，Scope 和租户边界是什么？
5. 本地 Server 的文件、网络、环境变量和子进程权限是什么？
6. 外部内容如何标记、截断、脱敏和隔离指令？
7. 哪些调用需要逐次审批，哪些可以会话授权？
8. Timeout、Cancel 和未知终态后如何避免重复副作用？
9. 如何撤销 Server、Tool、Token 和缓存 Definition？
10. Trace 能否还原谁在何时以什么身份做了什么？
