# 08 RAG 深挖：从能检索到能排查

## 本课目标

很多 Agent 面试会从 RAG 开始深挖，因为 RAG 同时考数据处理、检索、排序、上下文、评测和线上排障。本课目标是让你能回答：

- RAG 和微调怎么选？
- 召回率低怎么排查？
- Chunk、Embedding、Hybrid Search、Rerank、Query Rewrite 分别解决什么问题？
- RAG 和 Agent Memory 有什么关系？

## Step 1：画出 RAG 主链路

先画基础链路：

```text
documents
  -> parse / clean
  -> chunk
  -> embedding
  -> index
  -> retrieve
  -> rerank
  -> context packing
  -> generation with citations
  -> evaluation
```

面试时不要只说“向量库 + 大模型”。至少要能讲清每一段可能失败在哪里。

## Step 2：拆 Chunk 策略

常见追问：

- Chunk 太大和太小分别有什么问题？
- 语义被切断怎么办？
- 代码、表格、Markdown、PDF 要不要用同一种切法？

答题要点：

- 小 chunk 召回精确，但上下文缺失。
- 大 chunk 上下文完整，但噪声和 token 成本高。
- 真实系统要按文档结构切，例如标题、段落、代码块、表格、章节。
- 可以保留 metadata：文档 ID、标题路径、页码、更新时间、权限标签。

动手任务：给本仓库 `learning/` 下的 Markdown 设计 chunk 规则，写出伪代码：

```text
split_by_heading(markdown):
  keep heading path
  keep code blocks intact
  max_chunk_tokens = 600
  overlap_tokens = 80
```

## Step 3：拆 Embedding、Hybrid Search 和 Rerank

常见追问：

- Embedding 模型怎么选？
- 为什么只用向量检索不够？
- BM25、Hybrid Search、Rerank 分别解决什么？

答题要点：

- Embedding 适合语义相似，但对精确实体、代码符号、错误码、短 query 可能不稳定。
- BM25 适合关键词、专有名词、错误码和精确匹配。
- Hybrid Search 把语义召回和关键词召回合并，提高召回覆盖。
- Rerank 在候选集上做精排，通常更慢但更准。

排查路径：

```text
答案错
  -> 检查引用是否相关
  -> 若无相关引用：查 retrieve recall
  -> 若有相关引用但排序靠后：查 rerank
  -> 若引用相关但回答错：查 context packing / prompt / generation
```

## Step 4：拆 Query Rewrite 和多跳检索

常见追问：

- Query Rewrite 为什么有用？
- 多跳问题怎么做？
- Self-RAG / Corrective RAG / Agentic RAG 大概是什么？

答题要点：

- Query Rewrite 把口语化问题改写成可检索表达。
- 多跳检索要把复杂问题拆成多个子问题，并把中间证据带到下一跳。
- Self-RAG / Corrective RAG 的核心是让模型检查检索是否足够，不够就改写或再次检索。
- Agentic RAG 让 Agent 决定何时查、查什么、是否继续查，但要控制循环和成本。

动手任务：为下面 query 写出拆解：

```text
Codex 的 MCP 工具调用失败时，权限和日志分别在哪里处理？
```

要求输出：

```text
subquery 1: Codex MCP tool call entry point
subquery 2: MCP approval / permission handling
subquery 3: tool dispatch trace / logging
```

## Step 5：区分 RAG、Memory 和 Context

面试高频问法：

```text
RAG 是 Agent 记忆的一部分吗？
```

建议回答：

- RAG 是一种“按当前 query 检索外部知识”的机制。
- Memory 是 Agent 跨 turn / thread 维护状态和偏好的系统。
- Memory 可以用 RAG 技术实现读取，但还需要写入、更新、删除、过期、防污染和权限控制。
- Context 是本次模型请求实际看到的内容，RAG 和 Memory 的结果都只是 context 的候选输入。

Codex 对照：

- `codex-rs/memories/read/src/lib.rs`
- `codex-rs/memories/read/src/citations.rs`
- `codex-rs/memories/write/src/phase1.rs`
- `codex-rs/memories/write/src/phase2.rs`
- `codex-rs/memories/write/src/guard.rs`
- `codex-rs/core/src/context_manager/history.rs`

## Step 6：设计 RAG 评测

不要只评最终答案。至少拆成四类指标：

| 维度 | 看什么 |
| --- | --- |
| Recall | 相关证据有没有被召回 |
| Ranking | 相关证据是否排在前面 |
| Grounding | 回答是否基于引用 |
| Faithfulness | 有没有编造引用外的信息 |

动手任务：写 5 条 golden questions，每条包含：

```text
question:
expected_sources:
expected_answer_points:
failure_modes:
```

## Codex 对照源码

- `codex-rs/memories/README.md`
- `codex-rs/memories/read/src/lib.rs`
- `codex-rs/memories/read/src/citations.rs`
- `codex-rs/memories/write/src/guard.rs`
- `codex-rs/core/src/context_manager/history.rs`
- `codex-rs/core/src/tasks/compact.rs`

## 推荐资料

- [JavaGuide AI 应用开发面试指南](https://javaguide.cn/ai/interview-questions/ai-interview-guide.html)
- [小林面试笔记：RAG 面试专题](https://www.xiaolinnote.com/ai/)
- [OpenAI File Search / Tools](https://platform.openai.com/docs/guides/tools)
- [LlamaIndex Agents](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/)

## 验收标准

你完成本课时，应该能回答：

- RAG 低召回如何按链路排查？
- Chunk、Embedding、Hybrid Search、Rerank、Query Rewrite 各自解决什么问题？
- RAG、Memory、Context 的边界是什么？
- 如何设计一个可复现的 RAG eval？

