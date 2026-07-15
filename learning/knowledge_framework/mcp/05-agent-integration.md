# MCP 与 Agent、Tool 系统集成

## 为什么通常只配置 Server 就能接入

“Agent 无需修改，只配置 MCP Server 的 URL”成立的前提是 Agent 宿主应用已经实现了通用 MCP Client 和 Tool 适配层。无需修改的是每个业务系统对应的 Agent 代码；连接、发现、转换、路由和策略检查并不是凭 URL 自动产生的，而是 Host 预先实现的通用基础设施。

对于远程 Streamable HTTP Server，URL 只标识协议端点，不负责描述全部业务接口。连接后，Host 通过标准 MCP 生命周期动态获得能力：

```text
配置 Server URL、认证和策略
    ↓
建立传输连接
    ↓
initialize：协商协议版本和能力
    ↓
tools/list：获取名称、描述、输入 Schema 和注解
    ↓
过滤并转换为模型可见的工具目录
    ↓
模型选择 Tool，Host 路由为 tools/call
    ↓
将结果转换后写入下一轮模型输入
```

因此，Host 不需要预先依赖 CRM、数据库或代码托管平台的专用 SDK。MCP Server 负责把统一的 `tools/call` 映射到自己的数据库、REST API 或其他业务实现；Host 根据 `tools/list` 返回的工具定义动态完成适配。stdio Server 使用启动命令而不是 URL，但发现和调用过程相同。

“只配置 URL”也不等于一定可用。至少还要满足：

- Server 与 Host 支持兼容的 MCP 版本和能力；
- 认证凭据、租户权限范围和网络访问有效；
- Tool 的描述和 Schema 足以让模型正确选择和构造参数；
- Host 的启用状态、允许列表、审批和输出限制允许本轮提供并执行该工具；
- 能力目录变化后，Host 能通过通知或重连重新发现能力。

模型通常不知道 URL，也不会直接发送 MCP JSON-RPC。它看到的是 Host 转换后的 Tool 定义；协议连接和调用路由都由 Host 完成。

Server 还可以在初始化结果中提供全局 `instructions`。Host 可以把它作为 Server 级使用建议，供 Tool 规划时参考，但必须保留来源、限制大小，并确保其优先级不能高于 Host 策略或用户的明确要求。

## 两套协议之间的适配层

模型通常不会直接发送 MCP JSON-RPC。Host 先把 MCP Tool 转换成模型服务能够理解的工具定义，再把模型产生的工具调用转发给 MCP Server：

```text
MCP Server
    │ tools/list
    ▼
MCP Client / 连接管理器
    │ 过滤 + 名称规范化 + 元数据
    ▼
Agent 工具目录
    │ 模型服务工具定义
    ▼
模型服务 API
    │ function_call(name, arguments, call_id)
    ▼
Agent 工具路由 / 策略
    │ tools/call(original_name, arguments)
    ▼
MCP Server
    │ CallToolResult
    ▼
输出检查与处理
    │ function_call_output(call_id, observation)
    ▼
下一轮模型输入
```

模型服务的工具调用协议和 MCP 分别位于适配层的两端：前者负责表达模型选择了哪个工具，后者负责发现和调用外部能力。

## 从能力发现到工具目录

`tools/list` 返回的不是最终模型可见列表。Host 还需要：

1. 验证 Server 是否已连接并完成能力协商；
2. 应用 Server 和 Tool 的启用状态、允许列表和禁用列表；
3. 限制能力定义数量、Schema 深度和总 Token 数；
4. 规范化名称并处理跨 Server 冲突；
5. 保留原始 Server 和 Tool 标识，供运行时路由；
6. 决定直接提供、延迟提供还是隐藏该工具；
7. 将注解作为策略和调度器的参考信息。

因此“在 MCP Server 注册”不等于“本轮对模型可见”。

## 名称与身份

至少需要保存三类标识：

| 标识 | 用途 |
| --- | --- |
| Server ID | 选择连接、认证和 Server 级策略 |
| 原始 Tool 名称 | 构造 MCP `tools/call` |
| 模型可见名称和命名空间 | 满足模型服务的命名规则并避免冲突 |

只保存规范化后的名称会丢失协议路由所需的原始标识；只向模型提供原始名称，则可能违反模型服务对字符集或长度的限制。

## 调用与策略

模型返回合法 JSON 参数后，Host 仍应进行：

- Schema 和语义验证；
- 检查 Tool 是否仍处于启用状态；
- 结合注解、Server 信任级别和用户配置进行审批；
- 检查凭据的权限范围和租户；
- 实施并发控制、超时、取消和速率限制；
- 记录开始、进度、完成和中止事件。

`readOnlyHint=true` 可以帮助判断只读调用能否共享并发额度，但 Host 不能仅凭这一注解授予数据访问权限。`idempotentHint=true` 也不能证明在结果状态未知时可以无限重试调用。

## 从调用结果到模型输入

MCP 调用结果与模型服务要求的工具输出结构不一定一致。适配层需要：

- 保留文本、结构化内容和媒体的语义；
- 对模型服务不支持的内容选择转为附件、生成摘要或拒绝处理；
- 区分协议错误、Tool 业务错误和成功结果；
- 截断、脱敏并标记外部内容不可信；
- 用模型 Tool `call_id` 配对回写；
- 防止重复结果或无法配对的结果破坏会话历史。

模型看到工具结果后，才能决定继续调用、修正参数还是结束任务。MCP Server 不负责判断 Agent 是否已经完成任务。

## Resource 和 Prompt 如何进入上下文

Resource 不一定要转换成模型 Tool。Host 可以提供用户选择器、应用内检索、显式的 `list/read resource` Tool，或在可靠规则下直接将内容加入上下文。无论采用哪种方式，都需要记录来源、检查权限和时效性，并限制 Token 数量。

因此，配置 Server 后，Agent 也不会自动看到 Server 的全部 Resource 内容。模型若要主动访问 Resource，Host 必须明确提供通用的 Resource 列表和读取工具，或者先由 Host 选择内容并加入上下文。

Prompt 应作为带有来源信息的模板进入 Host 的提示词组装流程。Server 返回的消息不能自动覆盖系统指令、开发者指令、用户明确指令或组织策略。

## Elicitation 与 Agent 状态机

MCP Elicitation 会把一次普通工具调用扩展成等待用户的状态：

```text
Tool 正在运行
    ↓ elicitation/create
等待用户
    ├── 接受 → 恢复 Tool
    ├── 拒绝 → 返回拒绝结果
    ├── 取消 → 中止 Tool
    └── 轮次取消 / 连接断开 → 结束待处理请求
```

Host 必须把 Elicitation 请求与 Server、MCP 请求 ID、Agent 会话、当前轮次和用户响应准确关联起来。

## 上下文与预算

大量 MCP Tool Schema 会占用模型上下文并降低缓存命中率。常用控制包括：

- 仅连接当前任务所需 Server；
- 过滤不需要的 Tool；
- 延迟发现，或使用 Tool Search；
- 分别为能力定义、调用结果和 Resource 设置硬性上限；
- 对稳定的能力目录使用带版本的缓存；
- 能力目录变化时，使相关缓存失效。

优化目标不是“向模型提供尽可能多的能力”，而是在能力容易理解、能够授权且结果可以验证的前提下，只提供完成任务所需的最小能力集合。
