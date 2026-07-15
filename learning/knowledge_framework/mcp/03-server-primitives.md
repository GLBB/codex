# MCP Server Primitives

## 三类核心 Primitive

Server 可以向 Client 暴露：

| Primitive | 表达内容 | 常见控制者 |
| --- | --- | --- |
| Tool | 可执行动作 | Model / Agent 选择，Host 执行 Policy |
| Resource | 可读取上下文 | Host 应用选择和注入 |
| Prompt | 可复用交互模板 | 用户或产品界面选择 |

“常见控制者”描述推荐交互模型，不是协议强制 UI。Host 可以为 Resource 提供搜索工具，也可以将某些 Prompt 转成命令，但仍要保留来源与信任级别。

## 不要把 Primitive 机械映射成 CRUD

MCP 定义的是能力交换方式，不是 REST 风格的 CRUD 规范。Server 可以把新增、修改和删除设计成 Tool，但“查询”并不必须设计成 Resource：只读 Tool 同样可以执行按条件搜索、聚合、计算或从外部系统获取数据。

```text
Tools
    customer_create
    customer_update
    customer_delete
    customer_search       # 查询也可以是 Tool

Resources
    customer://123
    customer://123/orders
    schema://customers
```

选择时应判断交互语义，而不是判断它属于 CRUD 的哪个字母：

- 需要传入参数执行动作、查询或计算时，优先考虑 Tool；
- 数据有稳定 URI，适合读取、引用、缓存或订阅时，优先考虑 Resource；
- 同一业务对象可以同时提供 Tool 和 Resource，例如用 `customer_search` 找到客户，再读取 `customer://123`；
- `readOnlyHint=true` 的 Tool 仍然是 Tool，不会因此变成 Resource。

因此，Resource 不是 MCP 中所有“查”的统一入口。它表达的是可寻址上下文，而不是 CRUD Read 的协议别名。

## Tools：动作

Client 使用 `tools/list` 发现 Tool，使用 `tools/call` 调用 Tool。Definition 通常包含：

- `name`：Server Namespace 内的协议身份；
- `title` / `description`：面向用户和模型的说明；
- `inputSchema`：参数 JSON Schema；
- `outputSchema`：可选的结构化结果约束；
- `annotations`：只读、破坏性、幂等、开放世界等提示；
- `_meta`：双方约定的扩展 Metadata。

```json
{
  "name": "customers_get",
  "description": "Read one customer by id",
  "inputSchema": {
    "type": "object",
    "properties": { "id": { "type": "string" } },
    "required": ["id"],
    "additionalProperties": false
  },
  "annotations": {
    "readOnlyHint": true,
    "destructiveHint": false,
    "openWorldHint": false
  }
}
```

Schema 校验只说明输入形状合法。客户是否属于当前租户、调用者是否有权限、Server 是否真的只读，仍需语义验证和 Policy。

### Result

Tool Result 可以包含文本、图像、音频、Resource Link 或嵌入的 Resource，也可以通过 `structuredContent` 返回符合 `outputSchema` 的对象。Host 仍要：

- 限制单项和总输出大小；
- 验证 MIME Type 和结构化结果；
- 标记外部来源与不可信内容；
- 保留错误、取消与业务成功的区别；
- 转换成 Provider 能接受的 Observation。

声明了 `outputSchema` 时，Server 应让 `structuredContent` 符合该 Schema；为兼容只处理 Content Block 的 Client，可以同时返回文本表示。`isError=true` 表示 Tool 已被协议正常调用但业务执行失败，不应伪装成 JSON-RPC Error。

### Annotation

`readOnlyHint`、`destructiveHint`、`idempotentHint` 和 `openWorldHint` 是 Server 自述。它们可以帮助 Catalog、Approval、并发和 Retry Policy，但不是安全证明。缺失或相互矛盾时，Host 应使用保守默认值。

## Resources：上下文

Resource 用 URI 标识可读数据，例如文件、数据库 Schema、知识库页面或 API 响应：

```text
resources/list → 发现具体 Resource
resources/templates/list → 发现 URI Template
resources/read → 读取内容
resources/subscribe → 订阅变化（若协商支持）
```

Resource Definition 可包含名称、标题、描述、URI、MIME Type、大小和 Annotation。Resource Template 用 URI Template 表达一族动态资源，例如：

```text
db://schemas/{schema}/tables/{table}
```

`resources/read` 可以返回文本或二进制 Blob。URI 和声明的 MIME Type 都是外部 Metadata，Host 仍应检查内容大小、实际类型和安全性。支持订阅的 Client 可以使用 `resources/subscribe`，但变化通知只提示内容可能更新，Client 需要重新读取才能获得新快照。

Resource 不应无条件全部注入模型。Host 应按用户选择、检索结果或 Agent 需要读取，并实施权限过滤、Freshness、去重、Token 预算和引用追踪。

## Prompts：模板

Prompt 是 Server 提供的可复用消息模板：

```text
prompts/list → 发现模板和参数
prompts/get  → 传入参数并得到消息内容
```

Prompt Result 可以包含多条带 Role 的 Message，每条 Message 再携带文本、图像、音频或嵌入 Resource 等内容。Host 应把它接入自己的 Prompt 组装流程，而不是把整个 Result 当成一段最高优先级字符串：

```text
prompts/get(name, arguments)
    ↓
Prompt Result: description + messages[]
    ↓
Host 校验参数、来源、Role、内容类型和大小
    ↓
在既有 System / Developer / User 层级下组装 Context
```

适合表达领域工作流入口、Few-shot 示例和工具使用建议。它不适合绕过 Host 的系统指令或安全规则。

来自第三方 Server 的 Prompt 应保留 Provenance。Host 需要决定：

- 谁可以选择它；
- 参数怎样验证和转义；
- 返回消息放在哪个指令层级；
- 是否允许模板引用外部 Resource；
- 内容多大、多久刷新、如何审计。

## 动态列表

Tool、Resource 和 Prompt 列表可以变化。支持 `listChanged` 的 Server 能发送对应 Notification。Host 收到通知后应重新获取列表，再执行 Allowlist、名称冲突、Schema 上限和风险过滤；不能让 Server 通过热更新绕开初始治理。

## 如何选择 Primitive

| 需求 | 优先选择 |
| --- | --- |
| 产生副作用或执行查询 | Tool |
| 提供可寻址、可缓存、可引用的数据 | Resource |
| 提供用户主动选择的交互模板 | Prompt |
| 缺少 Tool 参数，需要询问用户 | Elicitation |
| Server 需要 Host 的模型完成子任务 | Sampling |

不要为了“让模型能看到”就把所有数据包装成 Tool。Primitive 选择决定控制者、缓存方式、Policy 和 Context 成本。
