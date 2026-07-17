# Skills：按需加载工作方法、知识与资源

## 1. Skill 解决的不是“模型完全不会”

模型可能知道如何做代码评审，但不知道当前组织的检查顺序、脚本位置、输出模板和例外规则。把这些内容全部塞进全局 Prompt，会让每个任务都支付成本。

Skill 把可复用能力打包，并只在适合的任务中逐层加载：

```text
Level 1：常驻 Metadata
name + description + locator
            ↓ 匹配当前任务
Level 2：加载 SKILL.md
完整工作流、边界、资源路由
            ↓ 工作流需要
Level 3：加载相关资源
references / scripts / assets / templates
```

这就是渐进披露：先让 Agent 知道“有什么”，再决定“是否需要”，最后只打开“完成当前任务所必需的部分”。

## 2. Skill 的组成

一个 Skill 通常包含：

- Metadata：名称、描述、触发场景、来源和 Scope；
- 主说明：角色边界、步骤、判断规则、失败处理；
- References：较长的领域知识、规范或 API 说明；
- Scripts：可重复、确定性较强的操作；
- Assets / Templates：输出模板、图片或其他资源；
- 依赖：需要的 Tool、MCP Server、App、Runtime 或凭据。

Skill 是 Context 资源包，不等于 Tool。Skill 可以指导 Agent 调用 Tool，也可以只提供知识；真正的副作用仍由 Tool Runtime 与 Policy 控制。

## 3. Skill 与相邻概念

| 概念 | 主要回答 | 与 Skill 的区别 |
| --- | --- | --- |
| Prompt | 本轮如何指示模型 | Skill 是可复用且按需加载的 Prompt / 资源模块 |
| RAG | 哪些外部证据与问题相关 | Skill 通常提供工作方法；RAG 主要提供事实证据 |
| Memory | 过去应复用什么 | Skill 是维护者发布的方法包，不是自动积累的个人历史 |
| Tool | 能执行什么动作 | Skill 说明怎样做；Tool 实际执行并受权限控制 |
| Plugin | 如何分发一组扩展能力 | Plugin 可包含 Skills、Tools、Apps 等多种组件 |
| Workflow | 代码如何确定性编排步骤 | Skill 可包含判断与说明，执行路径仍可由 Agent 动态决定 |

## 4. 触发与选择

Skill 可以被用户显式点名，也可以由系统根据 Metadata 和当前任务匹配。好的描述必须同时说明“做什么”和“何时使用”，因为 Agent 在加载正文前只能看到 Metadata。

选择时至少考虑：

- 任务语义是否匹配；
- Skill 的 Scope、来源和版本是否适用；
- 所需 Tool 或外部依赖是否可用；
- 多个 Skill 是否冲突或重复；
- 加载成本是否值得；
- 当前用户是否明确要求或禁止某种流程。

不要因为关键词碰巧相同就触发。例如用户讨论“如何创建 Skill 的理论”，未必授权系统在磁盘创建一个 Skill。

## 5. 渐进披露怎样节省 Context

假设有 100 个 Skill，每个主说明 2,000 Token：

```text
错误：100 × 2,000 = 200,000 Token 常驻

正确：
100 个短 Metadata ≈ 有界目录
+ 1 个匹配的 SKILL.md
+ 该工作流点名的 2 个 Reference
```

Metadata 本身也需要预算。Skill 太多时，可以压缩描述、使用路径别名、按 Namespace 分组，或者先通过 Tool Search 发现候选；不能假设“只有正文才占 Context”。

## 6. 读取规则

加载 Skill 时应遵守：

1. 完整读取选中的主说明，避免只看开头就执行。
2. 相对路径基于 Skill 自身位置解析，不基于随机 cwd。
3. 只读取主说明为当前任务路由到的 Reference、Script 或 Asset。
4. 对分页、截断的资源继续读取到所需边界。
5. 记录 Skill 来源和版本，以便解释行为。
6. Script 执行仍通过正常 Tool、Sandbox 和 Approval。

“按需”不等于“主说明也只随机读几段”。主说明承担资源路由和安全边界，选择它之后通常应完整读取。

## 7. 信任、冲突与 Prompt Injection

Skill 内容比普通检索文档更接近指令，但仍受来源与 Authority 限制：

- 系统或管理员 Skill 可以拥有组织定义的权威；
- 用户或仓库 Skill 只在相应 Scope 内生效；
- 第三方 Skill 需要安装、审核或明确授权，不能天然可信；
- Skill 不得赋予自己超出 Runtime Policy 的权限；
- Skill 与当前高优先级指令冲突时，应服从高优先级指令。

Reference 中嵌入的外部网页内容仍是数据。不要因为它由 Skill 打开，就自动把网页里的命令当成 Skill 指令。

## 8. Codex 源码阅读路线

先读 `codex-rs/core-skills/src/model.rs`，认识 `SkillMetadata`、Scope、依赖和策略。再读 `loader.rs` 与 `loader/discovery.rs`，理解不同根目录中的 `SKILL.md` 如何被发现，Metadata 怎样与资源位置绑定。

接着看 `render.rs` 的 `default_skill_metadata_budget` 和 Available Skills 渲染逻辑。重点观察：即使只注入 Metadata，也要受窗口比例、描述截断、路径别名和遗漏报告约束。

然后阅读 `injection.rs`，看显式提及与 Skill Body 注入如何处理。最后回到 `codex-rs/core/src/skills.rs`，理解 Core 怎样复用 `codex-core-skills` 的加载、渲染和调用服务。

可用 `codex-rs/skills/src/assets/samples/skill-creator/SKILL.md` 观察三层加载设计，但不要把示例 Skill 的创作说明当成 Runtime 实现。

## 9. 设计检查

- Metadata 是否足以让 Agent 在不读正文时正确判断触发条件？
- Skill 数量和 Metadata 总量是否有预算？
- 主说明、References、Scripts 和 Assets 是否分层？
- 相对资源是否从 Skill 根安全解析，避免路径逃逸？
- 第三方 Skill 的来源、版本和权限是否可见？
- Skill 是否错误地绕过 Tool Policy 或把外部数据升级成指令？
- 多 Skill 冲突、重复和执行顺序是否有明确处理？

[上一篇：RAG 召回、证据与评估](06-rag-retrieval-grounding-and-evaluation.md) · [返回学习地图](README.md) · [下一篇：Context Engineering](08-context-engineering.md)
