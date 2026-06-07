# Agent 开发系列教程

这是一套可以按顺序学习的 Agent 开发教程。它不是主题索引，也不是面试题库，而是一条练习主线：每一课都有目标、前置条件、按步骤阅读源码、动手任务、验收标准和复盘问题。

学习方式建议：

1. 先读本课目标和产出。
2. 按步骤打开源码，不要跳读到所有相关文件。
3. 做本课的小练习，把观察结果写进自己的笔记。
4. 用验收标准检查自己是否真的理解。
5. 再进入下一课。

配套资料：

- 覆盖校验：[Agent 常见追问覆盖矩阵](interview-coverage-matrix.md)
- 主题地图：[Agent 开发主题学习指南](../agent-topic-guide.md)
- 一条 Query 的完整链路：[Codex Query 处理流程](../query-processing-flow.md)
- 源码总览：[Codex 生产级 Coding Agent 学习总览](../production-coding-agent-overview.md)
- 外部精读：[Building effective agents 中文精读版](../../articles/building-effective-agents.zh.md)
- 外部精读：[A practical guide to building agents 中文精读版](../../articles/a-practical-guide-to-building-agents.zh.md)

## 课程目录

| 课次 | 教程 | 你会完成什么 |
| --- | --- | --- |
| 0 | [跑起来：建立源码、日志和学习工作台](00-run-and-observe.md) | 能运行 Codex，知道从哪里看日志、事件和持久化记录 |
| 1 | [Agent Loop：从一条 query 看闭环](01-agent-loop.md) | 能画出 model -> tool -> observation -> model 的闭环 |
| 2 | [Session / Thread / Turn：把一次对话拆成状态机](02-session-thread-turn.md) | 能解释 thread、session、turn、item 的边界 |
| 3 | [Tool System：从工具声明到执行结果](03-tool-system.md) | 能追踪一个工具从 schema 到 handler 到 result 的路径 |
| 4 | [Context、Memory 与 RAG：模型到底看到了什么](04-context-memory-rag.md) | 能区分上下文注入、历史压缩、长期记忆和检索引用 |
| 5 | [Sandbox 与 Permission：让 Agent 安全地行动](05-sandbox-permission.md) | 能说明审批、沙箱、网络和命令策略如何组合 |
| 6 | [MCP、Skills 与 Plugins：扩展 Agent 能力](06-mcp-skills-plugins.md) | 能解释外部工具协议、技能说明和插件打包的边界 |
| 7 | [Multi-Agent、Guardian 与 Eval：走向生产系统](07-production-agent-patterns.md) | 能设计子 agent、审查 agent、日志追踪和回放评估 |
| 8 | [RAG 深挖：从能检索到能排查](08-rag-deep-dive.md) | 能回答 Chunk、Embedding、Hybrid Search、Rerank、Query Rewrite 和 RAG Eval |
| 9 | [Agent 设计范式：把 ReAct、Planning、Reflection 讲清楚](09-agent-patterns-interview.md) | 能比较 Workflow、ReAct、Plan-and-Execute、Reflection 和手搓 Agent |
| 10 | [生产级 AI 系统设计：网关、稳定性、成本和排障](10-production-ai-system-design.md) | 能设计模型网关、限流熔断降级、成本统计、trace 和 eval 闭环 |
| 11 | [学习覆盖自测：确认教程覆盖常见追问](11-learning-coverage-checklist.md) | 能用项目证据解释 20 个 Agent 高频追问 |
| 12 | [Multi-Agent 编排：任务拆分、通信、隔离和回收](12-multi-agent-orchestration.md) | 能设计父子 agent 生命周期、上下文隔离、通信、失败恢复和成本控制 |

## 最终项目

完成 13 课后，做一个 `mini-codex-agent`。它不需要复刻 Codex，但要具备这些能力：

- 接收用户 query，构建模型输入，循环处理工具调用。
- 有 thread/session/turn 三层状态。
- 至少支持 `read_file`、`list_files`、`shell_dry_run` 三个工具。
- 每个工具有 schema、handler、结构化结果和错误结果。
- 有上下文预算和历史压缩策略。
- 有一个简单的记忆/RAG 模块，回答时能展示引用来源。
- 有命令审批和沙箱策略模拟。
- 能接入一个 MCP server 或模拟 MCP tool registry。
- 能加载一个 `SKILL.md` 风格的技能说明。
- 能设计一个 planner/coder/tester/reviewer 的多 agent 编排实验。
- 有日志、trace 文件和 4 个回放测试样例。
- 能解释 [Agent 常见追问覆盖矩阵](interview-coverage-matrix.md) 里的高频追问，并把理解落到项目证据。

最终验收不是代码量，而是你能用自己的话解释：为什么每一层存在，失败时怎么定位，如何把一个教学 agent 演进成生产 agent。
