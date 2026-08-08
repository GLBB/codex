# Agent 开发系列教程

这是一套面向开发者的 Agent 工程课程。它不要求你先熟悉 Codex 源码，也不把文件清单
当成教学内容。每一课都从一个真实问题出发，先建立心智模型，再用完整例子和实验理解
机制，最后才把结论映射回生产级 Codex。

学习方式建议：

1. 先跟随场景做判断，不急着记术语。
2. 用课程里的模型和例子解释“为什么要有这一层”。
3. 完成动手实验，并主动制造一次失败。
4. 用本课验收标准复述机制、取舍和排障方法。
5. 最后打开列出的少量源码入口，验证生产实现如何守住同样的不变量。

课程里的 `core/src/...`、`tools/src/...` 等源码路径均相对于 `codex-rs/`。源码用于验证
理解，不是课程正文的替代品。

配套资料：

- 覆盖校验：[Agent 常见追问覆盖矩阵](interview-coverage-matrix.md)
- 主题地图：[Agent 开发主题学习指南](../agent-topic-guide.md)
- 一条 Query 的完整链路：[Codex Query 处理流程](../query-processing-flow.md)
- 源码总览：[Codex 生产级 Coding Agent 学习总览](../production-coding-agent-overview.md)
- 外部精读：[Building effective agents 中文精读版](../../articles/building-effective-agents.zh.md)
- 外部精读：[A practical guide to building agents 中文精读版](../../articles/a-practical-guide-to-building-agents.zh.md)

## 推荐学习主线：6 周读懂一个 Coding Agent

下面是一条面向本仓库的推荐主线。它不是要求你在六周内读完所有代码，而是每周解决
一类 Agent 工程问题，并留下可观察、可验证的项目证据。可以反复使用同一条简单 query，
例如“查看当前目录并总结 README”，观察系统能力怎样随着课程推进逐层完善。

| 周次 | 学习主题 | 对应课程 | 本周要回答的问题 | 本周产出 |
| --- | --- | --- | --- | --- |
| 第 1 周 | 运行与 Agent Loop | [第 0 课](00-run-and-observe.md)、[第 1 课](01-agent-loop.md) | Agent 为什么会发起工具调用，一次 turn 为什么可能请求模型多次？ | 一张单次 query 的时序图，标出输入、模型请求、工具调用、工具结果和最终输出 |
| 第 2 周 | 状态与工具契约 | [第 2 课](02-session-thread-turn.md)、[第 3 课](03-tool-system.md) | Thread、Session、Turn、Item 怎样避免状态混乱？工具失败怎样成为可恢复的观察？ | 一张状态图，以及一个具有 schema、成功和错误结果的 `read_file` 工具 |
| 第 3 周 | Context、Memory 与检索 | [第 4 课](04-context-memory-rag.md)、[第 8 课](08-rag-deep-dive.md) | 模型本轮到底看到了什么？长期事实怎样被检索、引用和防污染？ | 一份 Context 预算报告，以及一组能定位 chunk、召回、排序和装配错误的 RAG 案例 |
| 第 4 周 | 安全、执行与扩展 | [第 5 课](05-sandbox-permission.md)、[第 15 课](15-shell-process-lifecycle.md)、[第 6 课](06-mcp-skills-plugins.md)、[第 16 课](16-plugin-marketplace-distribution.md)、[第 13 课](13-tool-discovery-apps-connectors.md)、[第 14 课](14-hooks-lifecycle-automation.md) | 命令怎样被获准、持续运行和安全收尾，扩展能力又怎样被分发并按需出现？ | 一个可轮询的长进程、一份 allow/ask/deny 策略、一条 Plugin 搜索安装链、一个 deferred App 工具和三类 hook 回放 |
| 第 5 周 | 生产模式与多 Agent | [第 7 课](07-production-agent-patterns.md)、[第 9 课](09-agent-patterns-interview.md)、[第 12 课](12-multi-agent-orchestration.md) | 什么时候使用 Workflow、单 Agent 或多 Agent？怎样委派、通信、审查和中断？ | 一份架构选择记录，以及 mailbox、follow-up、interrupt 和并发冲突实验 |
| 第 6 周 | 系统设计与综合验收 | [第 10 课](10-production-ai-system-design.md)、[第 11 课](11-learning-coverage-checklist.md) | 系统在限流、断线、拒绝、超限和部分失败时怎样保持可恢复、可观测？ | `mini-codex-agent` 设计与演示，包含协议、环境、权限、trace、评测和至少 10 个回放场景 |

每周结束时，都用下面四个问题复盘，而不是以“读了多少文件”衡量进度：

1. 这层解决了 Agent 的什么真实工程问题？
2. 在一次 query 中，它位于主链路的哪个位置？
3. 它失败时，用户和模型分别会看到什么？
4. 如果自己实现最小版本，必须保留的边界和验收条件是什么？

### 源码应该怎样使用

完成一课的例子和实验后，再用源码回答一个明确问题。比如学完 Agent Loop，只验证“什么
条件触发下一次模型请求”；学完工具系统，只追踪一个 `read_file` 的契约、路由和结果。
沿一次行为纵向查看，不按目录横向扫读。遇到暂时无关的 memories、多 Agent、cloud tasks
或 UI 细节，先记成支线。

每一课都应留下一份自己的笔记，至少包含：使用的 query、经过的关键类型或函数、观察到的事件、尚未理解的支线，以及一个可以验证理解的小实验。这样最终项目中的每个设计选择都有源码和行为证据，而不只是概念复述。

## 课程目录

| 课次 | 教程 | 你会完成什么 |
| --- | --- | --- |
| 0 | [跑起来：先认识一个 Agent，而不是先读源码](00-run-and-observe.md) | 能从用户、模型、工具和系统四个视角观察一次运行 |
| 1 | [Agent Loop：模型怎样从“会说”变成“会做”](01-agent-loop.md) | 能画出 model → tool → observation → model 的闭环，并解释停止条件 |
| 2 | [Thread、Session、Turn 与 Item：给 Agent 一副不会混乱的骨架](02-session-thread-turn.md) | 能解释创建、继续、取消和恢复时各层状态怎样变化 |
| 3 | [Tool System：把模型的动作建议变成可靠结果](03-tool-system.md) | 能设计工具控制面、执行面、错误、结果投影、并发和取消 |
| 4 | [Context、Memory 与 RAG：模型这一刻到底知道什么](04-context-memory-rag.md) | 能区分上下文、状态、长期记忆和检索证据，并管理预算 |
| 5 | [Permission、Approval 与 Sandbox：把“能做”限制在“该做”之内](05-sandbox-permission.md) | 能说明权限、审批、策略、Guardian 和沙箱怎样组合 |
| 6 | [MCP、Skills 与 Plugins：怎样给 Agent 扩展能力](06-mcp-skills-plugins.md) | 能为外部执行、工作方法和能力分发选择正确扩展边界 |
| 7 | [从 Demo 到生产：委派、审查、可观测与评测](07-production-agent-patterns.md) | 能用 trace、回放和分层评测定位失败，并区分审查角色 |
| 8 | [RAG 深挖：让 Agent 找到证据，而不是只生成答案](08-rag-deep-dive.md) | 能定位 chunk、召回、改写、排序、装配和生成各阶段错误 |
| 9 | [Agent 设计范式：Workflow、ReAct、Planning 与 Reflection](09-agent-patterns-interview.md) | 能按任务开放度、风险和反馈需求选择架构，不套用名词 |
| 10 | [生产级 Agent 系统设计：协议、网关、稳定性、成本与排障](10-production-ai-system-design.md) | 能设计本地/远程执行、背压、恢复、成本归因和可观测闭环 |
| 11 | [学习验收：把“我懂了”变成可验证的项目证据](11-learning-coverage-checklist.md) | 能用 trace、实验和设计取舍完成最终演示；建议最后学习 |
| 12 | [Multi-Agent V2：任务、消息、Turn 与中断](12-multi-agent-orchestration.md) | 能区分消息、任务、等待与中断，并管理历史继承和共享工作区 |
| 13 | [Tool Discovery、Apps 与 Connectors：工具太多时怎样按需出现](13-tool-discovery-apps-connectors.md) | 能区分注册、暴露、发现和执行，并治理 namespace、缓存与权限 |
| 14 | [Hooks：在生命周期中自动化，但不创造后门](14-hooks-lifecycle-automation.md) | 能设计有来源、超时和输出预算的 hooks，并守住权限不变量 |
| 15 | [Shell 与进程生命周期：一次工具调用结束后，命令为什么还在运行](15-shell-process-lifecycle.md) | 能管理 one-shot/interactive 进程、输出、stdin、取消、远程执行和 Session 清理 |
| 16 | [Plugin Marketplace：能力怎样被发现、安装、升级与治理](16-plugin-marketplace-distribution.md) | 能区分市场、Plugin 和有效能力，并治理搜索、策略、安装认证、缓存、分享与升级 |

文件编号沿用课程演进历史。推荐顺序以六周主线为准：第 11 课是综合验收，应在第 12～16
课之后完成。

## 最终项目

完成全部课程后，做一个 `mini-codex-agent`。它不需要复刻 Codex，但要具备这些能力：

- 接收用户 query，构建模型输入，循环处理工具调用。
- 有 thread/session/turn 三层状态。
- 至少支持 `read_file`、`list_files`、`exec_command` 和 `write_stdin`；教学早期可以先用
  `shell_dry_run`，学习第 15 课后再替换为受控的真实或模拟进程 runtime。
- 每个工具有 schema、handler、结构化结果和错误结果。
- 工具支持 direct/deferred exposure，能通过 `tool_search` 按需发现。
- 至少模拟一个 App/Connector 的 namespaced MCP 工具集合。
- 有上下文预算和历史压缩策略。
- 有一个简单的记忆/RAG 模块，回答时能展示引用来源。
- 有命令审批和沙箱策略模拟。
- 有 Session-scoped ProcessManager，能区分快速命令和长进程，轮询有界输出、串行化同一
  terminal 的交互，并在 shutdown 时清理进程。
- 能接入一个 MCP server 或模拟 MCP tool registry。
- 能加载一个 `SKILL.md` 风格的技能说明。
- 能模拟一个 Plugin Marketplace，区分 listed、installed、enabled、authenticated 和
  callable，并回放搜索、预览、策略拒绝、安装认证、升级失败与卸载。
- 支持 `PreToolUse`、`PermissionRequest`、`PostToolUse` 三类 hook，并限制 timeout 和模型可见输出。
- 能设计一个 planner/coder/tester/reviewer 的多 agent 编排实验。
- 区分只投递消息的 `send_message` 和触发新 turn 的 `followup_task`，并能中断卡住的 worker。
- 权限更新只影响明确的 environment 或后续 turn，项目配置受 trust 控制。
- 所有模型可见 fragment、工具结果和 hook 输出都有硬上限。
- 有日志、trace 文件和至少 10 个回放测试样例，覆盖成功、失败、拒绝、超限、工具发现、
  Plugin 分发状态、中断、长进程轮询与 shutdown 清理。
- 能解释 [Agent 常见追问覆盖矩阵](interview-coverage-matrix.md) 里的高频追问，并把理解落到项目证据。

最终验收不是代码量，而是你能用自己的话解释：为什么每一层存在，失败时怎么定位，如何把一个教学 agent 演进成生产 agent。
