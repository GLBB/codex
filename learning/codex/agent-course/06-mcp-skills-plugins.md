# 06 MCP、Skills 与 Plugins：怎样给 Agent 扩展能力

## 先解决“这个能力应该放哪”

团队想让 Agent 查询工单、执行代码审查流程，并把整套能力分发给其他同事。三个需求看似
都叫“扩展”，实际上属于不同层：

- MCP 提供可调用的外部能力。
- Skill 教 Agent 按什么流程做事。
- Plugin 把一组能力打包、安装和治理。

可以用“厨房”类比：MCP 是外接厨具，Skill 是菜谱，Plugin 是包含厨具、菜谱和配置的
整套厨房模块。内置工具则是房屋结构的一部分，由 core 强控制。

## MCP：把外部系统变成标准工具

MCP client 与 server 先建立连接和能力协商，然后 client 获取 tools/resources/prompts，
模型通过 Agent runtime 发起 tool call：

```text
Agent Model
  -> MCP tool schema
  -> ToolRouter
  -> MCP client connection
  -> external server
  -> structured result
  -> Agent Model
```

MCP 解决“怎样发现和调用外部能力”，不替 Agent 决定何时调用，也不替运行时做权限治理。
外部 server 声明某工具是只读，只能作为风险判断的一个信号，不能自动获得信任。

### Tools、Resources、Prompts 不要混用

| MCP 能力 | 适合做什么 | 例子 |
| --- | --- | --- |
| Tool | 执行动作或查询 | 创建工单、搜索数据库 |
| Resource | 读取可寻址内容 | 配置文件、知识条目 |
| Prompt | 提供复用提示模板 | 工单总结模板 |

工具有输入、输出和潜在副作用；resource listing 只是列内容资源。后面学习 Apps 时，不能
用 resource listing 冒充工具发现。

#### Resource 是内容规范，不是 Tool 做不到的新能力

Resource 是 MCP 为“可寻址、可读取的内容”定义的数据模型和协议。它用 URI 标识对象，
client 通过 `resources/list` 发现对象，通过 `resources/read` 读取正文：

```text
resources/list
  -> wiki://company/expense-policy
  -> wiki://company/security-policy

resources/read("wiki://company/expense-policy")
  -> 报销制度正文
```

server 也可以定义一个 `read_document(document_id)` Tool，并返回完全相同的正文。区别不在
返回内容，而在接口契约：Resource 把文档声明成有稳定身份的内容对象；Tool 把读取声明成
一次自定义函数调用。可以把 Resource 看成名词，把 Tool 看成动词：

| 场景 | 更自然的能力 |
| --- | --- |
| 按已知 URI 读取一篇文档 | Resource |
| 按关键词、日期和作者搜索文档 | Tool |
| 修改或删除文档 | Tool |
| 搜索后返回匹配文档的 URI，再读取正文 | Tool + Resource |

某些 host 会把 `resources/read` 再包装成模型可调用的 `read_mcp_resource` 工具。这只是
模型侧的操作入口，不会改变底层对象仍是 Resource：前者是“怎么取”，后者是“取什么”。

`resources/list` 也不应返回所有正文，它通常只返回 URI、名称、描述和 MIME type 等元
数据，正文由 `resources/read` 按需获取。列表本身仍可能过大，因此大规模数据源应组合
使用以下设计：

1. 使用 cursor 分页，限制单次 `resources/list` 的响应大小。
2. URI 有规律时暴露 Resource Template，例如 `jira://ticket/{ticket_id}`，不要枚举
   一百万张工单。
3. 用户不知道准确 URI 时，先用 `search_tickets` 一类 Tool 缩小范围，再读取返回的
   Resource URI。

分页只限制单次响应；如果 client 翻完并聚合所有页面，总量仍可能失控。因此 client 还要
对收集数量和注入模型的内容设置硬上限。

### Elicitation 为什么特殊

外部工具可能缺少信息，需要向用户询问或要求登录。MCP elicitation 会暂停正常工具流程，
把问题交给客户端，再把人的回答送回 server。它涉及身份、超时和 turn 生命周期，不能
当成普通字符串结果。

普通调用始终是 client 请求 server；elicitation 则是工具执行到一半时，server 反向请求
client 取得人的输入：

```text
client -> server: tools/call book_hotel
client <- server: 请选择房型（elicitation，原调用仍在等待）
client -> user:   展示表单或登录 URL
client <- user:   接受、拒绝或取消
client -> server: 返回 elicitation response
client <- server: 返回最终 tool result
```

如果 server 只返回字符串“请问用户需要哪种房型”，原 Tool Call 已经结束，后续只能依赖
模型转述问题并重新拼接流程。Elicitation 则在协议层保留未完成调用，并明确回答属于哪个
server 和 request。runtime 因此必须单独处理并发请求关联、结构化表单或 URL、审批策略、
取消与超时，以及 turn 结束后的挂起请求清理。

## Skill：给模型一套可复用的工作方法

Skill 的核心是 `SKILL.md`，它通常说明触发条件、工作步骤、注意事项，以及何时读取附属
参考、运行脚本或复用资产。

```text
repo-review/
  SKILL.md
  references/checklist.md
  scripts/collect_diff.sh
  assets/report-template.md
```

Skill 不是新的可执行权限。它可以教模型调用现有工具，但脚本仍要经过正常工具、permission
和 sandbox 链路。

### 为什么要渐进披露

假设系统安装了 100 个 Skill，每个正文 2,000 tokens。把它们全部放进每次请求会浪费
20 万 tokens，还会让模型在无关说明中迷失。更合理的三层加载是：

1. 首先只暴露有界 catalog：名称、描述和路径。
2. 用户显式点名或任务匹配后，读取对应 `SKILL.md`。
3. 执行到具体步骤时，才读取所需 reference/script/asset。

这就是“渐进披露”：先让模型知道有什么，再按任务付出上下文成本。

### 显式触发与隐式 invocation

用户说“使用 repo-review skill”属于显式触发，系统应准确找到并注入正文。模型执行某个
skill 的 scripts/docs 路径时，运行时还可以记录隐式 invocation，用于 trace 和分析。
隐式记录不应凭关键词随意注入所有正文，且可以被 skill policy 禁止。

Skill 还有 user、repo、system、admin 等 scope；Plugin 携带的 Skill 会带 namespace，
避免不同来源同名时静默覆盖。

## Plugin：分发与治理边界

Plugin 可以打包 Skills、Hooks、Apps、MCP server 声明和界面 metadata。它解决版本、
安装、启用、市场来源和团队分发，不会把内部各组件变成一套万能 runtime。

```text
Plugin installation
  -> validate manifest and source policy
  -> expose bundled Skills through skill loader
  -> expose Hooks through hook registry
  -> expose Apps/MCP through normal catalog
  -> preserve component-specific permission and trace
```

如果 Plugin 安装失败，要区分：manifest 无效应拒绝；一个可选组件暂不可用可以降级并明确
告警；managed policy 禁止的组件不能由 Plugin 绕过。

本课先建立 Plugin 作为组合分发边界的心智模型。它怎样被 Marketplace 搜索、预览、安装、
认证、分享和升级，以及 `listed`、`installed`、`enabled`、`authenticated`、`callable`
为什么不能合成一个状态，放在[第 16 课](16-plugin-marketplace-distribution.md)展开。

## 用“工单助手”做选择

需求：查询和修改 Jira 工单，并按团队模板生成发布检查报告。

- 查询/修改工单需要外部 API，做成 MCP tools。
- “先查关联 PR，再检查测试，最后生成报告”是 Skill。
- 团队希望一键安装工具、Skill、Hooks 和图标，做成 Plugin。
- 如果某能力必须参与所有 shell 安全决策，应进入 core 或受管 Hook，而不是普通 Skill。

设计时不要问“哪个技术更高级”，而要问它提供的是执行接口、工作方法、分发单元，还是
核心不变量。

## 动手实验：设计并模拟一个扩展包

为 `mini-codex-agent` 设计 `repo-quality` Plugin：

```text
repo-quality/
  manifest
  skills/repo-review/SKILL.md
  hooks/pre-tool-use.json
  mcp/review-service
```

完成以下验证：

1. 未触发时，模型只看到 Skill 摘要，不看到完整 checklist。
2. 显式选择 Skill 后，只注入该 `SKILL.md`，正文超限时截断并告警。
3. 需要历史规范时才读取 `references/checklist.md`。
4. MCP tool 返回失败时，错误经过正常 ToolResult 回填模型。
5. Skill 要求运行脚本时，仍触发 shell permission。
6. 禁用 Plugin 后，组件从后续有效 catalog 中消失，但历史事实不被改写。

## 常见误区

- MCP server 已连接，所以所有工具都可信。连接成功只代表协议可用。
- Skill 是宏，可以绕过审批。Skill 只是模型可见工作说明。
- Plugin 是一个大工具。它是分发容器，组件仍走各自 runtime。
- 为省事把所有 Skill 全量注入。上下文成本和选择噪声会迅速失控。
- 用工具关键词自动触发 Skill。显式 mention、任务匹配和隐式记录要分清。

## 理解之后再对照 Codex

MCP 连接、catalog、调用与 elicitation 位于 `codex-mcp/src/connection_manager.rs`、
`tools.rs`、`runtime.rs`、`elicitation.rs`，core 接线见 `core/src/mcp_tool_call.rs`。

Skills 的发现、注入和有类型 fragment 位于 `core-skills/src/loader.rs`、`injection.rs`、
`skill_instructions.rs`；`core/src/skills.rs` 负责集成与 invocation telemetry。当前 Agent
Plugin skill 的模型可见正文有 8,000-byte 硬上限。

Plugin manifest 和基础类型在 `plugin/src`，加载和组合在 `core-plugins/src`；模型可见
Plugin instructions 位于 `core/src/context/plugin_instructions.rs`。动态工具与 Apps 放在
[第 13 课](13-tool-discovery-apps-connectors.md)，Hooks 放在
[第 14 课](14-hooks-lifecycle-automation.md)，Marketplace 分发生命周期放在
[第 16 课](16-plugin-marketplace-distribution.md)。

## 本课验收

你应该能：

1. 为一个新能力判断 MCP、Skill、Plugin 或内置工具哪种形态最合适。
2. 解释渐进披露的三层预算。
3. 说明 Skill 脚本和 MCP tool 为什么仍要经过权限链路。
4. 设计 Plugin 某个组件失败时的拒绝或降级策略。
