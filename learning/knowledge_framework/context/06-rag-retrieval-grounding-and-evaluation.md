# RAG：召回、过滤、重排、引用与评估

## 1. 从问题到证据包

```text
User Question
    ↓ query understanding / rewrite
Permission + Tenant + Metadata Filter
    ↓
Lexical + Vector + Structured Retrieval
    ↓ merge / deduplicate / diversify
Rerank
    ↓
Evidence Pack + Citation Map
    ↓
Model Answer / Abstain
    ↓
Answer、Citation 与 Retrieval Evaluation
```

RAG 的产物不是“一堆相似文本”，而是一个适合当前问题、权限正确、来源可追溯、有预算上限的证据包。

## 2. Query Understanding

用户问“上次构建为什么挂了”，系统可能要解析：

- “上次”对应哪个项目、分支和时间范围；
- “构建”指本地测试还是 CI Workflow；
- “挂了”可能对应错误码、失败 Job 或日志语义；
- 当前身份可以访问哪些仓库和 CI 记录。

Query Rewrite 可以扩展缩写、生成多个子查询或加入实体约束，但必须保留原始意图。错误地把“为什么失败”改写成“如何修复”，会导致回答越过用户范围。

## 3. Recall、Filter 与 Rerank 分工

- **Recall** 追求别漏掉相关候选，允许一定噪声。
- **Filter** 按 ACL、租户、时间、类型和业务条件排除不合法候选。
- **Rerank** 用更昂贵的模型或特征重新判断与当前问题的相关性。
- **Diversification** 避免 Top K 全是同一段落的重叠副本。

一个典型错误是用向量相似度代替权限过滤；另一个错误是只按相似度取前 K，导致五个结果都来自同一份旧文档。

## 4. Context Pack 需要二次装配

检索到 20 个 Chunk 不等于全部注入。装配时应：

- 合并同一文档的相邻片段；
- 去掉重复和低增益内容；
- 保留标题、日期、作者、版本和位置；
- 对冲突证据并列展示，而不是静默选一边；
- 给每个来源分配大小上限；
- 留出回答、工具结果和当前任务所需预算。

若证据不足，正确结果可以是“无法从当前可访问资料确认”，而不是让模型用参数知识补全一个看似流畅的答案。

## 5. Citation 与 Evidence

Citation 要能从回答中的 Claim 回到具体来源位置：

```text
Claim
  └── Citation ID
        ├── source URI / document ID
        ├── version / observed_at
        ├── page / heading / line / span
        └── supporting chunk
```

只有文末列出几个链接，不代表每个重要 Claim 都被支持。系统需要检查：

- Citation 指向的来源是否真的包含该结论；
- 结论是否比证据表达得更强；
- 引用是否使用了当前可访问版本；
- 多来源冲突是否向用户暴露；
- 用户能否打开或定位原文。

检索文档中的指令仍是数据。Citation 证明“来源写了什么”，不证明“Agent 应服从它”。

## 6. 评估要拆层

### 摄取与解析

- 文档覆盖率、解析成功率、结构保真度；
- 更新延迟、删除传播延迟、ACL 同步正确率。

### Retrieval

- Recall@K：相关证据是否进入候选；
- Precision@K：候选中有多少真正相关；
- MRR / nDCG：正确证据是否排在前面；
- 权限泄漏率与跨租户命中率应为零。

### Grounding 与回答

- Claim 是否有证据支持；
- Citation 是否精确且可访问；
- 答案是否忠于证据、不夸大；
- 证据不足时是否能拒答或提出澄清；
- 最终任务是否完成，而不只是文本相似。

### 运行指标

- 查询延迟、各阶段耗时、Token 成本；
- 空结果率、重写率、Rerank 增益；
- 用户打开引用、纠正回答或继续追问的行为。

## 7. 评估集怎样构造

不要只收集容易的事实问答。至少覆盖：

- 精确 ID、错误码和符号名查询；
- 同义表达与跨文档综合；
- 新旧版本冲突；
- 无答案问题；
- 权限不足与跨租户诱导；
- 文档内提示注入；
- 删除后不可再召回；
- 表格、代码、PDF 等不同结构。

评估样本也要记录所依赖的数据版本和 ACL，否则数据更新后分数不可解释。

## 8. 一个具体例子

问题：“项目 A 依赖升级后 CI 为什么要求改 Bazel 锁文件？”

较好的过程：

1. 先按租户和 repo=A 过滤。
2. 词法召回 `MODULE.bazel.lock`、`Cargo.lock`，向量召回“依赖变更流程”。
3. Reranker 把当前仓库 `AGENTS.md` 与相关构建脚本排在旧 Issue 前面。
4. Context Pack 保留规则原文位置、当前 Commit 和失败日志。
5. 回答分别引用“仓库规则”和“本次失败证据”，并注明旧 Issue 只作背景。

如果只使用向量相似度，系统可能返回另一个仓库的 Bazel 文档；语义相近，却在 Scope 和权限上错误。

## 9. 模型上下文很大，RAG 是否还有用

先区分两个瓶颈：

```text
RAG Recall Bottleneck
知识空间里有正确证据，但 Retriever 没选出来

Long-context Utilization Bottleneck
正确证据已经放进 Context，但模型没有稳定定位、组合或使用
```

扩大 Context Window 主要缓解“选出的材料放不下”，不会自动解决知识发现、权限、新鲜度、引用和读取成本。反过来，RAG 可以减少干扰项，却可能因为召回错误漏掉关键证据。

### 哪些场景可以优先 Long Context

- 资料集合小、边界明确，整体能以合理成本放入窗口；
- 任务需要理解全局结构、长距离关系或未知位置的多处细节；
- 单次分析中漏掉任意局部的代价高，而没有可靠 Retriever；
- 来源和权限简单，不需要跨租户索引与持续增量更新；
- 例如审阅一份合同、理解一个小型代码模块、比较少量完整文档。

### 哪些场景仍应优先 RAG

- Corpus 远大于窗口，或持续新增、修改和删除；
- 每次问题只需要其中一小部分，查询量大且成本敏感；
- 需要 Tenant / ACL 过滤、实时 Freshness 和删除传播；
- 回答必须提供可定位 Citation 和证据审计；
- 需要用精确 ID、时间、实体关系或 Metadata 过滤；
- 例如企业知识库、全组织代码搜索、工单与实时运营数据。

### 常见选择

| 条件 | Long Context | RAG | Hybrid |
| --- | --- | --- | --- |
| 小而固定的资料集 | 优先 | 可选 | 通常不必复杂化 |
| 超大或动态 Corpus | 不适合作为唯一方案 | 优先 | 优先 |
| 全局结构理解 | 强 | Chunk 可能割裂关系 | 先召回文档，再放入较完整上下文 |
| 精确权限与删除 | 仍需外部治理 | 强项 | 强项 |
| Citation / Provenance | 需额外建立映射 | 天然适合保留来源 | 最实用 |
| Retriever 可能漏关键证据 | 可降低漏召回 | 风险较高 | 扩大候选、加载邻接内容或回退全读 |
| 干扰项很多 | 模型利用率可能下降 | 可先去噪 | Rerank 后交给长上下文推理 |

实践中的 Hybrid 常是：RAG 先按身份和查询选出文档，Long Context 再读取较完整的 Top Document、相邻 Chunk 或相关代码模块进行多跳推理。还可以在低置信度、证据冲突或召回为空时扩大查询，必要时回退到全量读取一个有界集合。

所以，大窗口不是 RAG 的替代品，而是改变 RAG 的切分粒度与 Context Pack 策略：窗口越大，越有条件从“孤立小 Chunk”升级为“相关文档 + 邻接结构”；Retriever 仍负责从更大的知识空间进行选择和治理。

研究中对 Long Context 与 RAG 的相对结果会随模型、任务、Corpus 和成本假设变化，不应固化成单一胜负结论。可对照 [Lost in the Middle](https://arxiv.org/abs/2307.03172) 和 [Retrieval Augmented Generation or Long-Context LLMs?](https://arxiv.org/abs/2407.16833) 的实验设计。

## 10. Codex 对照阅读

Memory Citation 可从 `codex-rs/protocol/src/memory_citation.rs` 入手，观察持久知识进入回答时如何保留引用身份。Tool Output 的截断与 Context 归一化可看 `codex-rs/core/src/context_manager/history.rs`，它能帮助理解为什么检索结果也必须有界。

外部知识检索可对照 MCP Resources、Apps 和 Web 工具的结果回写路径；重点观察结果怎样带来源进入 History，而不是把某个工具当成完整 RAG。Codex 的仓库实现主要提供 Agent Context 消费侧，企业 RAG 的索引与 ACL 仍需由资源提供方实现。

## 11. 设计检查

- Query Rewrite 是否保留原任务范围？
- ACL、Tenant、时间和类型过滤发生在什么阶段？
- Rerank 后是否去重并保证来源多样性？
- 每个重要 Claim 能否回到具体证据 Span？
- 冲突、过期和无答案场景是否明确处理？
- 是否分别评估解析、召回、Grounding、答案和安全？
- 是否分别测量 Retriever Recall 与模型拿到证据后的利用率？
- Long Context、RAG 或 Hybrid 的选择是否考虑 Corpus、权限、Freshness、Citation、成本和任务结构？
- 评估数据是否固定版本、身份和权限条件？

[上一篇：RAG 摄取与索引](05-rag-ingestion-indexing-and-isolation.md) · [返回学习地图](README.md) · [下一篇：Skills](07-skills-and-progressive-disclosure.md)
