# Agent 常见追问覆盖矩阵

这张矩阵把网络上常见 Agent 面试追问归类到本系列课程。它不是题库，也不是背答案材料；用途是检查教程是否覆盖了真实面试中常被追问的工程能力。

参考来源：

- [JavaGuide AI 应用开发面试指南](https://javaguide.cn/ai/interview-questions/ai-interview-guide.html)
- [小林面试笔记：Agent / RAG / 工具调用专题](https://www.xiaolinnote.com/ai/)
- [Kamacoder Agent 面试题汇总](https://notes.kamacoder.com/interview/llm/agent_interview.html)
- [Rubduck AI Interview Question Bank](https://rubduck.ai/questions)

## 高频考点总览

| 高频面试方向 | 常见问法 | 课程覆盖 | 覆盖状态 |
| --- | --- | --- | --- |
| Agent 基础 | Agent 和 Chatbot / Workflow 区别是什么？什么任务适合 Agent？ | [09](09-agent-patterns-interview.md) | 已覆盖 |
| Agent Loop / ReAct | ReAct 怎么实现？一次 turn 为什么会多次模型请求？ | [01](01-agent-loop.md)、[09](09-agent-patterns-interview.md) | 已覆盖 |
| Planning / Reflection | Plan-and-Execute、Reflection 和 ReAct 怎么选？ | [09](09-agent-patterns-interview.md) | 已覆盖 |
| Session / 状态 | Thread、Session、Turn 怎么设计？如何 resume？ | [02](02-session-thread-turn.md) | 已覆盖 |
| Tool / Function Calling | 工具 schema 怎么设计？工具失败怎么处理？ | [03](03-tool-system.md) | 已覆盖 |
| MCP | MCP 和 Function Calling 区别？MCP Server 怎么做安全治理？ | [06](06-mcp-skills-plugins.md)、[10](10-production-ai-system-design.md) | 已覆盖 |
| Context Engineering | Prompt Engineering 和 Context Engineering 区别？上下文爆了怎么办？ | [04](04-context-memory-rag.md)、[10](10-production-ai-system-design.md) | 已覆盖 |
| Memory | 长短期记忆怎么设计？RAG 是记忆吗？记忆如何防污染？ | [04](04-context-memory-rag.md)、[08](08-rag-deep-dive.md) | 已覆盖 |
| RAG 基础 | RAG 解决什么问题？和微调怎么选？ | [04](04-context-memory-rag.md)、[08](08-rag-deep-dive.md) | 已覆盖 |
| RAG 工程排查 | 召回率低怎么排查？Chunk、Embedding、Rerank 怎么选？ | [08](08-rag-deep-dive.md) | 已覆盖 |
| RAG 进阶 | Hybrid Search、Query Rewrite、GraphRAG、Self-RAG 是什么？ | [08](08-rag-deep-dive.md) | 已覆盖 |
| 安全与权限 | 工具调用怎么做权限控制？为什么不能只靠用户确认？ | [05](05-sandbox-permission.md)、[07](07-production-agent-patterns.md) | 已覆盖 |
| Multi-Agent | 什么时候用多 Agent？怎么通信、路由和协作？ | [07](07-production-agent-patterns.md)、[09](09-agent-patterns-interview.md)、[12](12-multi-agent-orchestration.md) | 已覆盖 |
| Eval / Observability | 怎么评估 Agent？trace 回放怎么做？ | [07](07-production-agent-patterns.md)、[10](10-production-ai-system-design.md) | 已覆盖 |
| 生产系统设计 | 如何设计生产级 Agent 平台？模型网关怎么做？ | [10](10-production-ai-system-design.md) | 已覆盖 |
| 成本与延迟 | 如何降低 token 成本、工具延迟和失败重试成本？ | [10](10-production-ai-system-design.md) | 已覆盖 |
| 结构化输出 | JSON/Structured output 失败怎么办？ | [10](10-production-ai-system-design.md) | 已覆盖 |
| 学习验收 | 如何确认自己不是只会背概念，而是能解释工程取舍？ | [11](11-learning-coverage-checklist.md) | 已覆盖 |

## 覆盖自测模板

学习时不要只背定义。每个追问都按这个结构自测：

```text
1. 定义：先把概念边界说清楚。
2. 取舍：说明什么时候适合、什么时候不适合。
3. 工程实现：讲模块、数据流、失败处理和安全边界。
4. 排查：讲线上出了问题怎么定位。
5. 项目证据：落到 mini-codex-agent 或 Codex 源码里的具体设计。
```

例子：自测“Agent Memory 怎么设计？”

```text
定义：Memory 不是单纯 RAG，它包含短期上下文、会话状态、长期用户偏好和任务事实。
取舍：短期状态留在 context，长期事实进入外部存储，需要可删除、可过期、可引用。
实现：写入要经过抽取、过滤、去重和防污染；读取要按 query 检索并限制 top-k 和 token。
排查：如果回答旧信息，检查记忆更新、召回排序、引用来源和上下文注入顺序。
证据：Codex memories/read 负责引用读取，memories/write 分阶段提取并有 guard。
```

## 覆盖自测顺序

1. 先完成 [00](00-run-and-observe.md) 到 [07](07-production-agent-patterns.md)，建立工程主线。
2. 再完成 [08](08-rag-deep-dive.md) 到 [10](10-production-ai-system-design.md)，补面试高频深挖题。
3. 再完成 [12](12-multi-agent-orchestration.md)，把 Multi-Agent 从概念扩展到生命周期和状态边界。
4. 最后用 [11](11-learning-coverage-checklist.md) 做自测，把每个追问都绑定到一个项目证据。
