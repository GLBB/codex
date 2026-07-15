# MCP 服务端原语

## 三类核心原语

Server 可以向 Client 提供：

| 原语 | 表达内容 | 通常由谁选择或控制 |
| --- | --- | --- |
| Tool | 可执行动作 | 模型或 Agent 选择，Host 执行策略检查 |
| Resource | 可读取上下文 | Host 应用选择和注入 |
| Prompt | 可复用交互模板 | 用户或产品界面选择 |

“通常由谁选择或控制”描述的是推荐交互方式，并非协议强制规定的界面。Host 可以为 Resource 提供搜索工具，也可以把某些 Prompt 转换成命令，但仍要保留其来源和信任级别。

## 不要把原语机械映射成 CRUD

MCP 定义的是能力交换方式，而不是 REST 风格的 CRUD 规范。Server 可以把新增、修改和删除设计成 Tool，但“查询”并不一定要设计成 Resource：只读 Tool 同样可以执行条件搜索、聚合、计算，或从外部系统获取数据。

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

因此，Resource 不是 MCP 中所有“查”的统一入口。它表达的是可寻址上下文，而不是 CRUD 中“读取”操作的协议别名。

## Tool：动作

Client 使用 `tools/list` 发现 Tool，使用 `tools/call` 调用 Tool。Tool 定义通常包含：

- `name`：Tool 在 Server 命名空间中的协议标识；
- `title` / `description`：面向用户和模型的说明；
- `inputSchema`：参数 JSON Schema；
- `outputSchema`：可选的结构化结果约束；
- `annotations`：只读、破坏性、幂等、是否与外部世界交互等提示；
- `_meta`：双方约定的扩展元数据。

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

Schema 校验只能说明输入结构合法。客户是否属于当前租户、调用者是否有权限、Server 是否确实只执行读取操作，仍需进行语义验证和策略检查。

### 调用结果

Tool 调用结果可以包含文本、图像、音频、Resource 链接或嵌入的 Resource，也可以通过 `structuredContent` 返回符合 `outputSchema` 的对象。Host 仍需：

- 限制单项和总输出大小；
- 验证 MIME 类型和结构化结果；
- 标记外部来源与不可信内容；
- 保留错误、取消与业务成功的区别；
- 将结果转换成模型服务能够接收的工具结果。

声明了 `outputSchema` 时，Server 应确保 `structuredContent` 符合该 Schema。为了兼容只能处理内容块（Content Block）的 Client，可以同时返回文本形式。`isError=true` 表示协议已经正常调用 Tool，但业务执行失败；这种情况不应伪装成 JSON-RPC 错误。

### 注解

`readOnlyHint`、`destructiveHint`、`idempotentHint` 和 `openWorldHint` 是 Server 对自身行为的说明。其中，`openWorldHint` 表示 Tool 是否可能与 Server 控制范围之外的外部系统或实体交互。它们可以为工具目录、审批、并发控制和重试策略提供参考，但不能作为安全证明。注解缺失或相互矛盾时，Host 应采用保守的默认值。

## Resource：上下文

Resource 用 URI 标识可读数据，例如文件、数据库 Schema、知识库页面或 API 响应：

### Resource、URI 与 URL

可以先把 Resource 理解成“数据”，但更准确的说法是“由 URI 标识、可供读取的内容或数据视图”：

```text
Resource = URI 标识 + 元数据 + 可读取内容
```

以下层次不要混淆：

| 层次 | 例子 | 含义 |
| --- | --- | --- |
| Resource URI | `customer://123` | Resource 的唯一标识 |
| Resource 定义 | URI、名称、描述、MIME 类型、大小、注解 | Client 发现和展示 Resource 所需的元数据 |
| Resource Contents | JSON 文本、Markdown、图片或其他二进制内容 | Client 读取 Resource 后获得的内容 |
| 后端数据源 | 数据库记录、文件、知识库或外部 API | Server 生成 Resource Contents 时使用的真实数据来源 |

Resource 使用的是 URI，不要求使用 HTTP URL。URL 是 URI 的一种常见形式；`customer://`、`schema://` 则是 Server 定义的自定义 URI Scheme：

```text
https://example.com/customers/123  # 可由网络位置直接获取的 Resource
file:///project/README.md          # 文件式 Resource
customer://123                    # 自定义业务 Resource
schema://customers                # 自定义 Schema Resource
```

对于 `customer://123` 这类自定义 URI，Client 通常不会把它当成网络地址直接访问，而是通过 MCP 请求让 Server 解释并读取：

```json
{
  "method": "resources/read",
  "params": {
    "uri": "customer://123"
  }
}
```

Server 可以把这个 URI 映射到数据库查询、文件读取或外部 API 调用，再将结果作为 Resource Contents 返回。使用 `https://` 时，应确保 Client 能够直接获取该内容；如果内容仍必须由 MCP Server 读取和授权，通常更适合使用自定义 URI Scheme。

URI 的路径结构只是 Server 的命名约定。协议不会自动认定 `customer://123/orders` 是 `customer://123` 的子资源，也不会自动提供目录遍历或父子关系。Server 可以自行定义：

```text
customer://123          → 客户 123 的资料视图
customer://123/orders   → 客户 123 的订单集合视图
schema://customers      → customers 对象或数据表的 Schema
```

这些 Resource 不一定与一条数据库记录一一对应，也可以是聚合查询、动态状态快照或经过权限过滤和格式化的内容。需要表达一组带参数的 Resource 时，可以使用 URI 模板，例如 `customer://{customer_id}/orders`。

因此，Resource 可以理解为数据，但不应等同于数据库原始记录或 REST 接口。更合适的心智模型是：**Resource 是由 URI 寻址的可读上下文视图，Server 负责解释 URI 并生成内容。**

### 发现与读取

```text
resources/list → 发现具体 Resource
resources/templates/list → 发现 URI 模板
resources/read → 读取内容
resources/subscribe → 订阅变化（若协商支持）
```

Resource 定义可以包含名称、标题、描述、URI、MIME 类型、大小和注解。Resource 模板使用 URI 模板表示一组动态资源，例如：

```text
db://schemas/{schema}/tables/{table}
```

`resources/read` 可以返回文本或二进制数据。URI 和声明的 MIME 类型都属于外部元数据，Host 仍应检查内容大小、实际类型和安全性。支持订阅的 Client 可以使用 `resources/subscribe`，但变更通知只表示内容可能已经更新，Client 仍需重新读取才能获得最新快照。

不应把所有 Resource 无条件注入模型。Host 应根据用户选择、检索结果或 Agent 的实际需要进行读取，同时实施权限过滤、时效性检查、去重、Token 预算控制和引用追踪。

## Prompt：模板

Prompt 是 Server 提供的可复用消息模板：

```text
prompts/list → 发现模板和参数
prompts/get  → 传入参数并得到消息内容
```

例如，一个面向开发团队的 Server 可以通过 `prompts/list` 提供“代码审查”模板：

```json
{
  "name": "review_code",
  "description": "Review code and return actionable findings",
  "arguments": [
    { "name": "language", "required": true },
    { "name": "code", "required": true },
    { "name": "focus", "required": false }
  ]
}
```

用户在 Host 界面中选择该模板，填入语言、代码和关注点后，Client 请求：

```json
{
  "method": "prompts/get",
  "params": {
    "name": "review_code",
    "arguments": {
      "language": "Rust",
      "code": "fn divide(a: i32, b: i32) -> i32 { a / b }",
      "focus": "reliability"
    }
  }
}
```

Server 将参数展开成可供 Host 组装的消息：

```json
{
  "description": "Review Rust code for reliability",
  "messages": [
    {
      "role": "user",
      "content": {
        "type": "text",
        "text": "Review this Rust code for reliability. Identify concrete problems, explain their impact, and propose minimal fixes.\n\nfn divide(a: i32, b: i32) -> i32 { a / b }"
      }
    }
  ]
}
```

`prompts/get` 到此只是生成消息，不会自己执行代码审查。Host 验证并组装这些消息后，才会把它们交给模型生成审查结果。

Prompt 结果可以包含多条带角色的消息，每条消息可以携带文本、图像、音频或嵌入的 Resource。Host 应把这些消息接入自己的提示词组装流程，而不能把整个结果当成一段具有最高优先级的字符串：

```text
prompts/get(name, arguments)
    ↓
Prompt 结果：description + messages[]
    ↓
Host 校验参数、来源、角色、内容类型和大小
    ↓
按照既有的系统 / 开发者 / 用户指令层级组装上下文
```

Prompt 适合表达领域工作流程入口、少样本示例和工具使用建议，但不能用来绕过 Host 的系统指令或安全规则。

对于第三方 Server 提供的 Prompt，Host 应保留来源信息，并决定：

- 谁可以选择它；
- 参数怎样验证和转义；
- 返回消息放在哪个指令层级；
- 是否允许模板引用外部 Resource；
- 内容多大、多久刷新、如何审计。

## 动态列表

Tool、Resource 和 Prompt 列表都可能变化。支持 `listChanged` 的 Server 可以发送相应通知。Host 收到通知后应重新获取列表，再应用允许列表、名称冲突处理、Schema 上限和风险过滤；不能让 Server 通过热更新绕过初始检查。

## 如何选择协议原语

| 需求 | 优先选择 |
| --- | --- |
| 产生副作用或执行查询 | Tool |
| 提供可寻址、可缓存、可引用的数据 | Resource |
| 提供用户主动选择的交互模板 | Prompt |
| 缺少 Tool 参数，需要询问用户 | Elicitation |
| Server 需要 Host 的模型完成子任务 | Sampling |

不要仅仅为了“让模型能看到”就把所有数据包装成 Tool。原语的选择会影响由谁控制、如何缓存、应用哪些策略，以及占用多少上下文。
