# MCP 开发、测试与运维

## 从 Primitive 选择开始

设计 Server 时先问“谁控制它、是否有副作用、是否需要寻址和缓存”，再决定 Primitive：

| 需求 | 建议设计 |
| --- | --- |
| 查询或改变业务系统 | Tool |
| 可寻址、可引用的数据 | Resource |
| 用户主动选择的领域模板 | Prompt |
| 缺少字段或需要用户确认 | Elicitation |
| Server 需要 Host 模型能力 | Sampling |

不要把所有能力都做成 Tool。读取数据库 Schema 更适合 Resource，执行查询更适合 Tool，指导用户完成分析的模板更适合 Prompt。

## Tool Contract 设计

高质量 Tool 应满足：

- 名称稳定、具体且在 Server Namespace 内唯一；
- Description 说明适用条件、边界和主要副作用；
- Input Schema 收紧类型、必填项、Enum、长度和额外属性；
- Output 使用有界结构，必要时声明 `outputSchema`；
- Annotation 与实现一致，矛盾时宁可保守；
- 写操作支持业务幂等键、预条件或可查询的操作 ID；
- 错误区分参数、认证、限流、暂时失败和业务拒绝。

不要在 Description、Schema Default 或错误消息中放 Credential，也不要依赖模型自行补全租户和权限边界。

## Transport 选择

| 条件 | stdio | Streamable HTTP |
| --- | --- | --- |
| 部署 | 与 Host 同机子进程 | 独立远程服务 |
| 身份 | 进程与本地环境 | OAuth、Bearer、TLS、租户 |
| 扩缩容 | 通常按 Client 启动 | 可服务多个 Client |
| 主要风险 | 供应链、本地文件和环境变量 | 网络、认证、多租户和可用性 |
| 运维重点 | 进程退出、stderr、升级 | 负载、限流、重连、Token 轮换 |

Transport 是部署决策，不应改变 Primitive 的业务语义。

## 测试分层

| 测试 | 验证重点 |
| --- | --- |
| Schema / Contract Test | Definition、分页、Result 与协议 Schema 一致 |
| Lifecycle Test | initialize、Capability、通知、关闭和版本不兼容 |
| Transport Test | framing、重连、stderr、HTTP、SSE 和认证 |
| Host Integration Test | Catalog、名称、Approval、调用与 Observation 闭环 |
| External Integration Test | OAuth、Scope、限流、最终一致性和真实副作用 |
| Adversarial Test | Tool Poisoning、Prompt Injection、巨型 Schema、外传 |
| Recovery Test | Timeout、取消、崩溃、重复请求和未知终态 |

测试客户端或 MCP Inspector 能验证协议行为，但不能替代真实 Host 的 Tool Catalog、Prompt 优先级、Policy 和 UI 测试。

## 从原始协议过渡到 SDK 与 Inspector

手写 JSON-RPC 适合观察协议主链，但生产 Server 和 Client 应优先使用维护活跃、支持目标协议版本的 SDK。SDK 能减少 Schema 类型、消息关联、Capability、Transport 和升级兼容中的重复错误，但不会自动解决业务授权、幂等、输出上限和 Prompt Injection。

推荐开发循环：

```text
SDK 实现 Server
    ↓
MCP Inspector 检查连接与 Capability
    ↓
分别测试 Tools / Resources / Prompts / Notifications
    ↓
真实 Host 验证 Catalog、Approval 和 Context
    ↓
对接真实外部系统验证身份、Scope 和副作用
```

使用 Inspector 时至少检查：

1. 初始化协商出的版本和 Capability 是否符合预期；
2. Tool Schema、Annotation、结构化结果和业务错误能否正确展示；
3. Resource MIME Type、内容大小、Template 和订阅是否正确；
4. Prompt 参数和生成的 Message 是否保留来源；
5. List Changed、Progress、Logging 等 Notification 是否可观察；
6. 非法参数、并发调用、断线和 Server 重启后的行为。

Inspector 证明 Server 的协议面可以工作，不证明某个 Agent Host 会把所有能力暴露给模型，也不证明 Approval、认证或外部副作用安全。

工具用法以官方 [MCP Inspector](https://modelcontextprotocol.io/docs/tools/inspector) 为准；选择 SDK 时检查官方 [SDK 列表](https://modelcontextprotocol.io/docs/sdk) 的语言、协议版本和维护等级，不要只按包名相似度安装第三方实现。

## 必测场景

1. Server 返回零个、很多个、分页和动态变化的 Tool。
2. 两个 Server 的 Tool 名称冲突或清洗后相同。
3. Annotation 缺失、错误和互相矛盾。
4. Tool 返回巨型文本、无效结构、媒体和 Embedded Resource。
5. 调用超时后外部系统实际成功，Host 不应盲目重试。
6. Elicitation 被 Accept、Decline、Cancel、Timeout 和 Turn Cancel。
7. OAuth 过期、Scope 不足、用户切换和租户错配。
8. Server 在 Tool Result 或 Resource 中注入恶意指令。
9. Sampling 尝试超出 Token、Tool 或嵌套深度预算。
10. Server 崩溃重连后 Catalog 和旧 Handle 失效。

## 可观测性

至少记录：

- Server ID、Transport、版本和 Capability；
- connect、initialize、list、call、read 的延迟与结果；
- Catalog 数量、缓存命中和变化次数；
- Tool 调用成功、业务失败、协议失败、超时、取消和拒绝；
- Approval 请求与决策，但不记录敏感参数；
- Elicitation / Sampling 的等待时长、预算和终态；
- Result 原始大小、截断量和模型侧 Token；
- 外部操作 ID、幂等键和审计关联 ID。

Metric Label 不应直接包含用户输入、URI 全文、Token 或高基数参数。

## 版本与兼容

- 初始化时协商协议版本，不按 Server 名称猜测；
- 未协商 Capability 的方法不要调用；
- 对未知字段保持兼容，对未知业务语义保持保守；
- Draft 和实验性 Tasks 使用显式 Feature Gate；
- Definition 变化应触发缓存失效和安全复审；
- SDK 升级后重新跑 Host Integration 和 Adversarial Test。

## 综合练习：数据库 MCP Server

设计一个教学 Server：

```text
Resource  db://schemas/{schema}
          提供数据库 Schema

Prompt    analyze_table
          提供用户主动选择的分析模板

Tool      query_read_only
          执行受限参数化查询

Elicitation
          缺少数据范围时询问用户

Sampling  可选
          请求 Host 模型解释查询计划
```

然后沿执行链、数据链和信任链分别回答：谁选择数据、谁授权查询、Credential 在哪里、结果如何截断、恶意单元格文本如何隔离、Timeout 后怎样确认查询状态。能回答这些问题，才算真正理解 MCP 集成，而不只是会启动一个 Server。

完成设计后，先用 Inspector 分别调用 Resource、Prompt 和 Tool，再接入真实 Host。最后为缺少数据范围的调用增加 Elicitation：分别验证 Accept、Decline、Cancel、Timeout 和连接断开，确认 Pending Request 都有明确终态。
