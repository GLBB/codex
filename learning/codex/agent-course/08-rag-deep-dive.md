# 08 RAG 深挖：让 Agent 找到证据，而不是只生成答案

## 从一次错误回答开始

用户问“Codex 的 MCP 调用失败后在哪里记录 trace？”，系统检索到一篇介绍 MCP 协议的
文章，却没找到本仓库的实现。模型回答得很流畅，但没有回答问题。

这是典型 RAG 事故。最终生成只是供应链最后一环：

```text
文档 -> 解析 -> Chunk -> 索引 -> 召回 -> 重排 -> Context Packing -> 生成与引用
```

任何一环丢失信息，后面的模型都无法凭空恢复。排障的第一原则是先找证据在哪一环消失。

## Chunk：把文档切成可检索的意义单元

Chunk 太小，可能只召回“permission check”一句而失去所属函数；太大，则把整个模块带入
上下文，相关信号被噪声淹没。

好的切分先尊重结构，再考虑 token：Markdown 按标题层级，代码按类型/函数，表格保留
表头，PDF 保留页码。每个 chunk 带 metadata：

```json
{
  "document_id": "core/tools/mcp.rs",
  "heading_path": ["MCP", "Approval"],
  "symbol": "handle_mcp_tool_call",
  "updated_at": 1785945600,
  "permission_tags": ["repo:codex"],
  "text": "..."
}
```

Overlap 可以减少边界切断，但会产生重复召回。代码场景更适合保留父类型、函数签名和相邻
注释，而不是机械复制前后 100 tokens。

## 召回：语义相似和精确匹配互补

向量 embedding 擅长“含义相近”，却可能漏掉错误码、文件路径和函数名；BM25 擅长词项
匹配，却不理解同义表达。Hybrid Search 同时取两路候选，再融合排名：

```text
query
  ├─ dense retrieval：语义候选
  └─ sparse/BM25：符号与关键词候选
        -> merge/deduplicate
        -> rerank top N
```

Reranker 在较小候选集上做更昂贵的相关性判断。它不能召回第一阶段完全没找到的文档，
所以低 recall 不能靠无限调 rerank 修复。

## Query Rewrite：把人的问题变成检索任务

“它失败后去哪看？”缺少实体，直接检索效果很差。Rewrite 可以结合对话变成：

```text
Codex MCP tool call failure permission handling tool dispatch trace
```

复杂问题还要拆成多跳：

1. MCP tool call 从哪里进入？
2. permission/Guardian 在哪里决定？
3. tool dispatch trace 在哪里记录？

每一跳的证据成为下一跳输入。Agentic RAG 允许模型决定是否继续查，但必须限制跳数、
query 数量和总证据预算，否则很容易变成昂贵的搜索循环。

## Context Packing：找到不等于模型看到了

检索系统可能正确召回 20 个 chunks，但 context builder 只容纳 5 个；也可能把重复片段放
在前面，把真正答案截掉。Packing 要处理：去重、按来源聚合、保留标题路径、分配 token、
标记引用和防止外部内容成为高优先级指令。

一种简单预算：

```text
总 RAG 预算 4000 tokens
  -> 每个来源最多 2 chunks
  -> 单 chunk 最多 800 tokens
  -> 至少保留 3 个不同来源
  -> 引用 metadata 单独计入
```

答案中的引用只能证明“系统指向了某来源”，不能证明来源正确、模型忠实或权限合规。

## 一张排障决策树

```text
回答错误
  -> 预期证据在知识库吗？
       否：ingestion / freshness
       是：候选集中出现吗？
            否：chunk / embedding / BM25 / rewrite / permission filter
            是：排在可打包范围内吗？
                 否：fusion / rerank
                 是：进入最终模型输入吗？
                      否：dedupe / packing / budget
                      是：回答忠实吗？
                           否：prompt / generation / citation validation
```

这比“换更好的 embedding 模型”更有效，因为每个分支都有可观测证据。

## RAG、Memory 与微调怎么选

- 需要更新的外部事实和引用：RAG。
- 跨任务保存用户偏好或已确认事实：Memory，可用检索实现读取。
- 改变稳定行为、格式或领域模式：可能考虑微调。
- 当前 turn 的临时证据：直接 Context，不必写长期 Memory。

同一系统可以同时使用三者。关键是知道信息从哪来、何时更新、能否删除，以及错误会污染
多久。

## 动手实验：为课程本身做一个 RAG

对 `learning/codex/agent-course` 设计最小检索器：

1. 按 Markdown heading 切分，代码块保持完整。
2. 保存文件、heading path 和课程编号。
3. 实现关键词检索，再模拟一组语义候选。
4. 合并去重并限制每课最多两个 chunks。
5. 回答时输出引用文件与 heading。

建立五条 golden questions，每条保存：预期来源、答案要点、允许的替代来源和失败类型。
分别测 retrieval recall@k、ranking、context inclusion、grounding 和 citation correctness。

故意删掉一个标题 metadata、缩小 chunk、关闭 BM25，观察哪些指标先变差。这样你学到的
不是术语，而是不同设计选择怎样改变可测行为。

## 常见误区

- “接了向量库就是 RAG。” 解析、权限、重排、packing 和 eval 同样关键。
- Chunk 越小越精准。缺少上下文会让证据不可解释。
- Rerank 能修复一切。未召回的文档无法重排。
- 引用存在就没有幻觉。引用可能不支持结论。
- RAG 是 Memory。Memory 还需要写入、更新、过期、删除和防污染。

## 理解之后再对照 Codex

Codex 的长期记忆提供一个可观察案例：`memories/read/src/lib.rs` 和 `citations.rs` 处理
读取与引用，`memories/write/src/phase1.rs`、`phase2.rs` 与 `guard.rs` 处理分阶段写入和
过滤；模型实际看到的历史与压缩位于 `core/src/context_manager/history.rs` 和
`core/src/tasks/compact.rs`。

这里不是要把 Codex Memory 当通用 RAG 框架，而是用真实代码验证“检索结果最终只是
有界 context candidate”这一原则。

## 本课验收

你应该能：

1. 沿供应链定位一次错误是 ingestion、retrieval、ranking、packing 还是 generation。
2. 解释 Chunk、Hybrid Search、Rerank 和 Rewrite 各解决什么问题。
3. 设计包含 retrieval 与 generation 分层指标的 RAG eval。
4. 区分 RAG、Memory、Context 和微调的适用边界。
