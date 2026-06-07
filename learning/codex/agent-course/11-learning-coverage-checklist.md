# 11 学习覆盖自测：确认教程覆盖常见追问

## 本课目标

本课不是刷题，也不是背答案，而是用网络上常见 Agent 追问来检查你是否真的学懂了前面课程。目标是：每个问题都能回到工程实现、源码入口和自己的练习产出。

## Step 1：准备项目证据

先准备一个 `mini-codex-agent` 或 Codex 源码阅读证据，至少包含：

- Agent loop 日志。
- Thread / Session / Turn 状态图。
- Tool registry 和 3 个工具 schema。
- RAG / Memory 的引用样例。
- Approval / sandbox 的拒绝样例。
- MCP 或 Skill 的扩展示例。
- Trace / replay / eval 样例。

这些证据不是为了背答案，而是为了让每个概念都能落回“我看过、做过、能解释失败路径”。

## Step 2：核心 Agent 覆盖

| 常见追问 | 你应该能解释 |
| --- | --- |
| Agent 和 Workflow 有什么区别？ | 动态决策、工具反馈、适用场景、风险 |
| ReAct 是什么？ | Reason/Act/Observe、工具结果回填、停止条件 |
| Plan-and-Execute 和 ReAct 怎么选？ | 任务复杂度、计划可审核、动态修正 |
| Reflection 有什么用？有什么风险？ | review、质量检查、成本、不能保证正确 |
| 为什么有时要手搓 Agent？ | 状态、权限、trace、eval、成本控制 |
| 什么时候用 Multi-Agent？ | 上下文隔离、并行探索、角色权限、通信和成本 |

如果这些问题答不出来，回到 [01](01-agent-loop.md)、[09](09-agent-patterns-interview.md) 和 [12](12-multi-agent-orchestration.md)。

## Step 3：工具和 MCP 覆盖

| 常见追问 | 你应该能解释 |
| --- | --- |
| Function Calling 和 MCP 有什么区别？ | 前者是模型调用工具的接口，后者是外部工具/资源协议 |
| 工具 schema 怎么设计？ | 名称、描述、参数、返回、错误、大小上限 |
| 工具调用失败怎么办？ | 结构化错误、回填模型、重试限制、降级 |
| MCP Server 怎么做安全治理？ | tool allowlist、权限、审计、结果大小、防污染 |
| Tool 和 Skill 有什么区别？ | 可执行接口 vs 可复用工作流知识 |

如果这些问题答不出来，回到 [03](03-tool-system.md) 和 [06](06-mcp-skills-plugins.md)。

## Step 4：RAG 和 Memory 覆盖

| 常见追问 | 你应该能解释 |
| --- | --- |
| RAG 解决什么问题？ | 外部知识、降低幻觉、引用来源 |
| RAG 和微调怎么选？ | 知识更新、行为风格、成本、可解释 |
| 召回率低怎么排查？ | chunk、embedding、hybrid、rewrite、rerank |
| RAG 是 Agent Memory 吗？ | RAG 可用于 memory 读取，但 memory 还要写入、删除、防污染 |
| 长任务上下文溢出怎么办？ | sliding window、summary、重要性过滤、external memory |

如果这些问题答不出来，回到 [04](04-context-memory-rag.md) 和 [08](08-rag-deep-dive.md)。

## Step 5：安全、生产和评测覆盖

| 常见追问 | 你应该能解释 |
| --- | --- |
| 工具调用怎么做权限控制？ | approval、sandbox、exec policy、guardian |
| 为什么用户确认不能替代 sandbox？ | 用户不理解全部副作用，sandbox 是硬边界 |
| 如何设计生产级 Agent 平台？ | app server、runtime、gateway、tools、memory、trace、eval |
| Agent 很慢很贵怎么办？ | 请求次数、上下文、工具延迟、RAG、multi-agent、重试 |
| 如何评估 Agent？ | task success、tool accuracy、grounding、safety、replay |

如果这些问题答不出来，回到 [05](05-sandbox-permission.md)、[07](07-production-agent-patterns.md) 和 [10](10-production-ai-system-design.md)。

## Step 6：系统设计复盘模板

学完课程后，任选一个场景，按这个顺序复盘：

```text
1. 需求澄清：用户是谁，任务是什么，成功标准是什么。
2. 总体架构：入口、状态、模型、工具、RAG、权限、日志。
3. 核心链路：一条 query 如何流动。
4. 关键设计：context、tool、memory、eval、安全。
5. 失败处理：模型失败、工具失败、RAG 失败、权限拒绝。
6. 可观测：trace、metrics、replay、golden set。
7. 取舍：成本、延迟、质量、安全。
```

这个模板的目的不是产出标准答案，而是检查你能否把课程中的模块连成一个真实系统。

## Step 7：自测评分

每个追问按 5 分评分：

| 分数 | 标准 |
| --- | --- |
| 1 | 只会背定义 |
| 2 | 能说概念，但没有工程细节 |
| 3 | 能讲模块和流程 |
| 4 | 能讲失败处理和取舍 |
| 5 | 能落到项目证据和源码对照 |

通过标准：

- 20 个追问里至少 16 个达到 4 分。
- Agent Loop、Tool、RAG、Memory、安全、Eval 至少各有 1 道达到 5 分。
- 能完整复盘一个生产级 Agent 平台设计，不超过 10 分钟。

## Codex 对照源码

- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/src/tools`
- `codex-rs/core/src/context_manager`
- `codex-rs/memories`
- `codex-rs/sandboxing`
- `codex-rs/codex-mcp`
- `codex-rs/skills`
- `codex-rs/otel/README.md`
- `codex-rs/rollout-trace/README.md`

## 推荐资料

- [Agent 常见追问覆盖矩阵](interview-coverage-matrix.md)
- [JavaGuide AI 应用开发面试指南](https://javaguide.cn/ai/interview-questions/ai-interview-guide.html)
- [小林面试笔记：Agent / RAG / 工具调用专题](https://www.xiaolinnote.com/ai/)
- [Kamacoder Agent 面试题汇总](https://notes.kamacoder.com/interview/llm/agent_interview.html)

## 验收标准

你完成本课时，应该能做到：

- 不看笔记解释 20 个常见追问背后的工程问题。
- 每个追问能讲出项目证据。
- 能把 Codex 源码里的设计转成清晰的工程表达。
- 能解释你的 `mini-codex-agent` 和生产级 Codex 差在哪里。
