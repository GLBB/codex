# RAG：数据摄取、解析、切分、索引与隔离

## 1. RAG 不只是“向量库 + Prompt”

Retrieval-Augmented Generation 的完整读链路开始于查询，但它能否可靠工作，取决于更早的数据管线：

```text
Source
  ↓ connect / crawl / upload
Raw Object + ACL + Version
  ↓ parse / normalize
Logical Document
  ↓ semantic chunking
Chunk + metadata + provenance
  ↓ lexical / vector / graph indexing
Tenant- and permission-aware index
```

解析错误、切分错误或权限丢失，无法靠更强的模型在最后一步补救。

## 2. 数据摄取

摄取层需要保存的不只是正文：

- Source ID、原始 URI、租户和拥有者；
- 原始版本、更新时间、内容哈希；
- 文档类型、语言、标题和层级；
- ACL、分享范围和敏感性标签；
- 删除、移动和权限变化事件；
- Parser 版本和摄取状态。

采用增量同步时，要能区分“正文没变但权限变了”与“正文更新”。只用内容哈希决定是否重建索引，会漏掉 ACL 变化。

## 3. 解析与规范化

不同来源需要保留不同结构：

| 来源 | 应保留的结构 |
| --- | --- |
| Markdown / Wiki | 标题层级、列表、代码块、链接 |
| PDF | 页码、段落、表格、图片说明、阅读顺序 |
| 源码 | 文件、符号、注释、调用或引用关系 |
| Issue / Chat | 作者、时间、Thread、Reply 关系 |
| Spreadsheet | Sheet、表头、单元格区域、公式语义 |

纯粹抽取成一大段文本，会让后续 Citation 无法指回原位置，也会把表格列或代码作用域切乱。

## 4. Chunking：不是固定字符切片

Chunk 是检索和 Context 装配的基本单位。理想 Chunk 要同时满足：语义相对完整、足够小、可独立定位、与相邻结构有关联。

```text
差的切分
“删除用户数据前必须……” | “……获得二次确认。”

较好的切分
标题：数据删除
正文：删除用户数据前必须获得二次确认。
路径：安全手册 > 数据操作 > 数据删除
```

常见策略包括：

- 按标题、段落和列表等文档结构切分；
- 按函数、类型和模块等源码结构切分；
- 对长区块设置 Token 上限，并保留少量重叠；
- 给 Chunk 附带父标题、邻接 ID 和原文 Span；
- 对表格、图片和代码使用专门 Parser。

重叠太少会断语义，太多会让召回结果重复并浪费 Context。

## 5. 索引并非只有 Embedding

| 索引 | 擅长 | 弱点 |
| --- | --- | --- |
| 词法 / BM25 | 精确术语、错误码、ID、符号名 | 同义表达较弱 |
| 向量 | 语义相近、自然语言改写 | 精确标识和新词可能不稳 |
| 结构 / Graph | 层级、链接、调用、实体关系 | 建设和更新成本高 |
| Metadata | 租户、时间、类型、Scope、ACL 过滤 | 依赖摄取质量 |

生产系统常采用 Hybrid Retrieval：词法与向量产生候选，Metadata 先过滤或伴随过滤，再交给 Reranker。

## 6. 权限与租户隔离

正确顺序是：

```text
Caller Identity + Tenant + Current ACL
                    ↓
            构造允许检索的候选空间
                    ↓
              Retrieve / Rank
                    ↓
                Context Pack
```

错误顺序是先跨租户检索，再指望模型“不说出”无权内容。敏感内容一旦进入候选、日志、缓存或模型 Context，泄漏已经发生。

需要同时约束：

- 索引写入时的 Tenant / ACL Metadata；
- 查询时的调用者身份和实时权限；
- Cache Key 包含租户、身份或权限版本；
- Reranker、评估日志和 Debug Trace 不跨边界；
- 权限撤销和源文档删除能传播到派生索引。

## 7. 版本、新鲜度与删除

每个 Chunk 应能回答：来自哪个版本、何时摄取、原文是否仍存在、权限是否仍有效。

对易变知识，可以在结果中携带 `source_updated_at` 与 `indexed_at`，并设置查询时限。对于价格、在线状态和当前政策等事实，静态 RAG 索引可能不够新，应改用实时 API 或直接访问权威来源。

删除采用 Tombstone 或变更流时，要保证旧向量、词法索引、缓存和离线评估样本最终一致地清理。

## 8. 与 Codex 的关系

Codex 仓库并没有提供一个可代表所有企业知识库的通用 RAG Pipeline，因此不要硬找一个“RAG 模块”来对应全部概念。可以用三个邻近实现帮助理解：

- `codex-rs/core-skills/src/loader/` 展示多来源资源发现、Metadata 读取和有界加载。
- `codex-rs/thread-store/src/local/search_threads.rs` 展示对持久化 Thread 进行受限搜索的入口。
- MCP Resources 与 Apps / Connectors 展示外部资源如何通过明确协议进入 Agent，而不是默认把整个数据源塞进 Context。

这些实现只能作为职责对照，不能替代 RAG 系统所需的 Parser、Chunker、Embedding Index、ACL Filter 和删除传播设计。

## 9. 设计检查

- 原始对象、Logical Document 和 Chunk 是否可相互追溯？
- Parser 是否保留标题、页码、代码符号、表格等结构？
- Chunk 大小是否以模型 Token 和语义边界共同约束？
- 词法、向量与 Metadata 是否按查询类型组合？
- ACL 是否在候选内容进入模型之前强制执行？
- Cache、日志、Reranker 和评估数据是否也遵守租户隔离？
- 更新、权限撤销和删除是否传播到所有派生索引？

[上一篇：Memory](04-memory.md) · [返回学习地图](README.md) · [下一篇：RAG 召回、证据与评估](06-rag-retrieval-grounding-and-evaluation.md)
