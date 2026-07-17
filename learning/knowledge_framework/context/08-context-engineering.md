# Context Engineering：来源、选择、冲突、压缩、缓存与预算

## 1. 从 Prompt Engineering 到 Context Engineering

Prompt Engineering 关注“怎样表达要求”；Context Engineering 关注“本次推理到底应该获得哪些信息，以及如何在容量和信任约束下装配”。

```text
Candidate Context
    ↓ classify provenance / authority / freshness
Security and scope filter
    ↓
Relevance and utility selection
    ↓ deduplicate / resolve conflicts
Compression and representation choice
    ↓ budget allocation / hard caps
Model-visible Context
```

核心目标不是塞得最多，而是在有限窗口内最大化决策所需的信息，并把错误与越权信息挡在边界外。

## 2. 标称 Context Window 不等于有效 Context

Provider 标注模型支持 128K、200K 或更大 Context，只说明请求在协议和容量上可以被接收，不保证模型能对所有位置、所有任务稳定使用。Context 质量必须体现具体模型特性：

| 模型特性 | 对 Context 的影响 | 设计响应 |
| --- | --- | --- |
| 位置敏感性 | 开头、结尾和中间的信息利用率可能不同 | 做位置扰动评估，不把关键证据随机埋入长文本 |
| 干扰项敏感性 | 增加无关内容后准确率可能下降 | Retrieval、去重、Rerank 和来源配额 |
| 精确匹配能力 | UUID、错误码、符号名的查找能力不同 | 词法检索或 Tool Search，不只依赖模型浏览 |
| 多跳整合能力 | 多份证据相距很远时可能漏掉关系 | 把相关证据聚组，保留关系与父级结构 |
| 指令遵循与角色支持 | 不同角色和边界标记的效果不同 | 用 Provider 支持的结构，不靠文本伪造角色 |
| Modality | 图片、音频或大 Tool Output 的计费与利用不同 | 转写、局部裁剪、结构化摘要和单项上限 |
| 输出与 Reasoning 预算 | 输入占满窗口会挤压输出或后续 Tool Loop | 预留生成、工具和恢复空间 |

### “中间召回率低”是什么

“Lost in the Middle”研究在多文档问答和 Key-Value Retrieval 中观察到：改变相关证据在长输入中的位置，会显著改变一些模型的表现，常见现象是开头和结尾较好、中间较弱。它说明**可容纳长度不等于可稳定利用长度**。

严格说，这里更适合称为 **In-context Utilization / 定位准确率下降**，不是 RAG Retriever 的 Recall。前者是“证据已经在 Prompt 中，模型有没有用到”；后者是“证据有没有被检索进 Prompt”。两项指标必须分开测量。

但它不是所有模型、所有版本、所有任务都固定遵守的自然定律。模型架构、训练长度、任务格式、查询位置、干扰项难度和新版本训练都会改变结果。因此 Context 系统不应写死“中间一定失败”，而应维护每个 Model Profile 的经验和评估数据。

### 怎样让模型特性进入 Context 策略

1. 高权威基础指令保持稳定、清楚，当前问题在调用位置再次明确。
2. 先用 Retrieval / Search 减少无关内容，再把相关证据按主题和关系聚组。
3. 每个证据带短标题、Source ID、时间和 Citation，避免形成无结构文本墙。
4. 需要全局理解时分阶段读取：先建立地图，再展开目标区域，最后汇总跨区域关系。
5. 对关键事实使用结构化提取或 Tool 验证，不只依赖模型从长文本自由回忆。
6. 不要为了位置偏置机械复制同一证据；重复会占预算、造成冲突并破坏缓存。

### 应怎样评估

同一任务至少改变以下变量：

- 总输入长度和干扰项数量；
- 关键证据位于开头、中间、结尾或多个分散位置；
- 单证据、两跳和多跳问题；
- 原始全量、RAG Top K、Rerank、摘要和 Hybrid Context；
- 不同 Model、版本、Reasoning Effort 与 Prompt Template。

分别记录 Retrieval Recall、证据已进入 Context 后的利用率、最终任务正确率、Citation 正确率、延迟和成本。只做“窗口内藏一根针”测试，不能代表代码修改、长文综合和多轮 Agent 任务的真实有效窗口。

原始研究与后续设计可从 [Lost in the Middle](https://arxiv.org/abs/2307.03172) 开始；使用这些结论时应注明实验模型与日期，而不是直接推断当前所有模型。

## 3. Provenance、Trust 与 Freshness

三个维度回答不同问题：

| 维度 | 问题 | 例子 |
| --- | --- | --- |
| Provenance | 它从哪里来，能否追溯？ | 用户消息、Git 文件、CI API、Memory ID |
| Trust / Authority | 可相信到什么程度，能否发指令？ | Runtime Policy 高权威；网页正文只是数据 |
| Freshness | 它在何时观察，现在是否仍有效？ | 当前 Git status 比昨日摘要更新 |

权威来源也可能过期，不可信来源也可能包含正确事实。系统不能用一个 `trusted: bool` 替代全部判断。

可以为候选条目保留：来源 ID、获取方式、时间、版本、Scope、权限、置信度、敏感性和 Citation。后续选择与回答才能解释为什么使用它。

## 4. 选择与渐进披露

选择时可把价值粗略理解为：

```text
utility = relevance × authority × freshness × actionability
          ÷ token_cost
```

这不是必须实现的数学公式，而是评审思路。当前任务约束、最新错误证据和即将修改的源码通常价值高；十轮前的重复日志价值低。

渐进披露的常见层次：

- 文件树 → 目标文件 → 相关符号 → 邻近实现；
- Skill Metadata → `SKILL.md` → 指定 Reference；
- 搜索结果标题 → Chunk → 原文局部；
- 历史摘要 → 关键旧 Turn → 持久 Artifact；
- Tool Catalog → 延迟 Tool Definition → 实际 Tool Output。

先提供地图，再按决策需求读取细节，可以减少噪声，也更容易维持缓存。

## 5. 冲突处理

冲突不只有指令冲突：

- 两条指令要求不同动作；
- Memory 与当前用户陈述不一致；
- 两份文档描述不同版本；
- 工作区实际状态与历史摘要不一致；
- 多个工具返回互相矛盾的 Observation。

处理顺序：

1. 先按类型分离 Instruction 与 Evidence。
2. 指令冲突按 Authority、Scope、Specificity 和 Recency 判断。
3. 事实冲突优先更权威、更直接、更近时的 Observation。
4. 无法判定时并列保留来源，降低置信度或请求澄清。
5. 高风险动作不能靠模型随意猜一个版本。

不要用“最后出现的文本覆盖前文”统一处理，它会让不可信文档通过位置获得权限。

## 6. 压缩、摘要、截断与缓存

| 技术 | 解决的问题 | 主要损失 / 风险 |
| --- | --- | --- |
| 摘要 | 用较短文本保留长期任务状态 | 细节、否定条件、来源可能丢失 |
| 压缩 | 对历史做受控转换并保持可继续性 | 错误被固化、恢复路径复杂 |
| 截断 | 强制限制单项或尾部大小 | 可能直接裁掉关键错误或结论 |
| Cache | 避免重复计算或重复发送稳定前缀 | Key 错误会跨 Scope 污染，旧内容会过期 |

### 好摘要应保留什么

- 当前目标、成功条件和禁止事项；
- 已确认事实及其来源；
- 已完成动作与外部副作用；
- 当前 Workspace / Artifact 标识；
- 未决问题、失败尝试与下一步；
- 关键路径、ID、版本和时间。

摘要应说明“不确定”和“未验证”，不能把推断压成事实。

### Prompt Cache 复用的是什么

Prompt Cache 复用的是多次模型请求中相同或兼容的输入前缀已经完成的服务端计算，不是把一段语义相近的文字当作同一份 Memory。一次 Agent 请求可以粗略看成：

```text
稳定前缀                                                    易变后缀
模型基础指令 → Tool Definitions → 早期 History → 最近 History → 当前用户消息
└────────────────── 可能复用的 Prefix ──────────────────┘
```

具体命中粒度、最小长度、保留时间和计费方式由 Provider、模型与接口版本决定，不能把某一版本的规则写成通用不变量。但系统设计通常要同时满足两类条件：

1. 请求落在正确的缓存作用域，例如使用稳定且隔离良好的 `prompt_cache_key`。
2. 从请求开头到某个边界的序列化内容与顺序保持一致；仅仅 Key 相同不代表内容一定命中。

模型、基础指令、Tool Definition、消息角色、内容、顺序或图片表示发生变化，都可能让可复用前缀提前结束。即使后部内容相同，只要更靠前的位置变化，后面的相同内容通常也不能继续视作同一连续前缀。因此应把稳定内容放前面，把当前 Turn、时间、动态权限和检索结果等易变内容追加在后面。

### Cache Key 与内容失效是两层问题

Cache Key 的首要职责是划定复用范围并避免错误共享。它至少要考虑 Provider 的契约，以及会形成安全或正确性边界的租户、用户、Session、模型族和指令版本。Key 过宽可能把不同 Scope 的请求送入同一复用域；Key 每轮随机变化则会失去复用机会。

但不要把所有状态版本都机械拼进 Key。权限或 Workspace 变化时，更重要的是把变化作为新的、模型可见的 Context Item 追加到历史，确保模型得到最新状态；是否还要切换 Key，要根据 Provider 的隔离语义和缓存中是否包含不可跨 Scope 复用的内容决定。

可以把两层失效分开评审：

| 层次 | 典型问题 | 设计动作 |
| --- | --- | --- |
| 作用域失效 | 用户、租户、会话或安全边界改变 | 更换或重新派生 Cache Key |
| 前缀失效 | 指令、工具、早期历史或序列化格式改变 | 接受从变化点后重新计算，避免无意义地重写更早内容 |
| 新鲜度更新 | cwd、权限、时间或检索证据改变 | 在旧前缀后追加带版本或时间的新 Observation |
| 历史重写 | Compaction、Rollback、脱敏或规范化改变旧 Item | 建立新的缓存前沿，并验证旧状态没有残留 |

安全不能依赖“缓存大概会失效”。身份与权限过滤仍必须在内容进入模型请求之前完成；删除敏感内容时也要遵循 Provider 的缓存保留契约，并清理系统自己控制的派生缓存。

### Prompt Cache 不等于 Context 压缩

缓存命中的 Token 通常仍属于本次输入，也仍占用模型 Context Window。它可能减少重复前缀的计算成本、延迟或输入计费，但不会让模型获得更大的有效窗口。Compaction、摘要和截断负责容量，Prompt Cache 负责重复计算，两者可以同时发生：

```text
缓存：相同长前缀再次发送得更便宜或更快
压缩：把旧历史改写得更短，从而释放窗口
```

压缩会重写旧历史，因此常常也会改变缓存前缀。不能只比较压缩节省的 Token，还要比较压缩后的非缓存输入、缓存写入、后续多 Turn 的缓存读取和任务质量。

### 怎样提高命中率而不牺牲正确性

- 基础指令和 Tool Definitions 使用确定性顺序与稳定序列化；不要从无序集合生成请求。
- History 默认有序追加，不因本轮状态变化重写较早 Item。
- 把权限、环境和 Workspace 变化渲染成差量，追加在已发送历史之后。
- 只有状态真的变化时才注入更新；避免把每轮生成的时间戳、随机 ID 或等价但格式不同的文本放进稳定前缀。
- Tool Catalog 很大时使用延迟发现，但要保证已加载工具的排序和定义稳定。
- Compaction、Rollback、模型切换和 Tool Schema 变更视为明确的缓存边界，而不是隐蔽地追求旧命中。
- 优先保证指令、权限与新鲜度正确；缓存命中率是优化指标，不是 Context 正确性的约束。

### 怎样观测与诊断

若 Provider 返回细分用量，至少记录每次请求的 `input_tokens`、`cached_input_tokens`、`cache_write_input_tokens`、输出 Token、首 Token 延迟、总延迟、模型、Cache Key 的非敏感标识和 Context 版本。常用派生指标包括：

```text
cache_read_ratio = cached_input_tokens / input_tokens
non_cached_input = max(input_tokens - cached_input_tokens, 0)
```

`cache_write_input_tokens` 的含义和计费应按 Provider 契约解释，不能与 `cached_input_tokens` 混为一谈。排查命中骤降时，应从请求开头依次比较模型、基础指令、工具列表与 Schema、历史 Item 的角色 / 顺序 / 内容和多模态表示，找到第一个差异点；只检查 Cache Key 通常不够。

## 7. Token 预算与硬上限

窗口预算不应只有一个总数，还应有分类预算和单项上限：

```text
Total Context Window
├── 基础指令与安全边界：预留
├── 当前用户任务：优先保留
├── 最近历史与工作状态：弹性
├── Tool Definitions / Skill Metadata：分类上限
├── RAG / Memory / Workspace Evidence：按来源与条目上限
├── Tool Output：单调用截断上限
└── 模型输出与后续 Tool Loop：必须预留
```

硬上限用于防止单个日志、图片、Skill 或检索源吞掉整个窗口；软预算用于在正常情况下优化质量。超过预算时的降级顺序可以是：去重 → 降低低价值来源数量 → 摘要 → 保存 Artifact 并保留引用 → 最后才截断关键内容。

还要限制整个 Agent Loop 的累计 Token、工具次数和压缩次数，否则每个单轮都合法，整体仍可能无限运行。

## 8. Memory Write / Forget Policy 放在闭环末端

Context Engineering 不只负责读。任务完成后，系统要决定哪些结果进入未来 Context：

```text
观察到的信息
  ↓ 是稳定且未来有价值吗？
  ↓ 来源、Scope、置信度和敏感性可说明吗？
  ↓ 用户允许保留吗？
写入候选 → 去重 / 合并 / 设 TTL / 记录 Citation
```

遗忘策略要与写入对称：按用户请求、过期、冲突、来源删除和 Scope 结束触发，并传播到索引与缓存。

## 9. 一个装配算法

```text
1. 固定不可省略的高权威指令与当前用户任务。
2. 获取当前 World State，淘汰过期 Workspace 判断。
3. 从最近 History、工作状态、Memory、RAG、Skills 收集候选。
4. 在进入候选池前执行身份、租户、权限和敏感性过滤。
5. 标注 Provenance、Authority、Freshness、Scope 和 Token Cost。
6. 消解指令冲突；对事实冲突保留来源与不确定性。
7. 去重并按任务阶段选择高 Utility 内容。
8. 使用渐进披露读取必要细节，对旧历史做保真压缩。
9. 应用分类预算、单项硬上限，并预留输出与后续 Loop 空间。
10. 记录最终选择、裁剪和摘要行为，支持调试与评估。
```

## 10. Codex 源码阅读路线

从 `codex-rs/context-fragments/src/fragment.rs` 建立“类型化 Fragment”概念，再读 `codex-rs/core/src/context_manager/history.rs` 的记录、归一化、Token 估算和 World State 更新。这两处构成“内容表示 + 历史装配”主干。

沿 Prompt Cache 路径先看 `codex-rs/core/src/client.rs` 的 `ModelClient::prompt_cache_key` 和请求构造：默认 Key 来自 Session ID，并随请求发出。再读 `codex-rs/core/tests/suite/prompt_caching.rs`，观察测试如何要求 Tool Definitions 稳定、旧输入保持为下一请求的完整前缀，并把设置与环境变化追加到后面。这里验证的是“缓存命中潜力”；真正的缓存存储与命中由 Provider 完成，并不在 `core/src/context/` 中。

接着读 `codex-rs/core/src/context_manager/history.rs` 的 `record_items`、`replace` 和 `update_world_state`，再进入 `context/world_state/mod.rs` 的 `snapshot`、`render_history_diff`。重点观察默认追加、历史重写后清空基线、状态未变化时不重复注入、状态变化时只渲染差量怎样共同保护稳定前缀。不要把 World State Snapshot 误认为 Prompt Cache；它是决定“下一轮需要告诉模型什么”的本地比较状态。

最后沿观测路径阅读 `codex-rs/codex-api/src/sse/responses.rs` 如何把 Provider 用量映射为 `cached_input_tokens` 和 `cache_write_input_tokens`，以及 `codex-rs/protocol/src/protocol.rs` 的 `TokenUsage` 如何区分缓存与非缓存输入。用 `codex-rs/core/tests/suite/prompt_cache_key.rs` 确认 Root / Subagent 的 Thread ID 可以不同，而默认 Prompt Cache Key 仍按共享 Session 作用域组织。

沿容量路径阅读 `codex-rs/core/src/compact_token_budget.rs`、`compact.rs` 和 `context/token_budget_context.rs`，观察总窗口、压缩与模型可见预算提示之间的分工。沿渐进披露路径阅读 `codex-rs/core-skills/src/render.rs` 的 Metadata Budget。

最后用 `codex-rs/core/tests/suite/compact.rs`、`rollout_budget.rs` 和 `skills.rs` 看不变量怎样被测试。阅读到能解释“为什么一个 Fragment 出现、何时更新、怎样被截断或压缩”即可。

## 11. 设计检查

- 每个 Context Entry 是否有来源、Scope、时间和信任语义？
- 选择是否基于当前决策价值，而不是全量拼接？
- 是否按具体 Model / Version 测量位置、长度、干扰项和多跳利用率？
- 冲突是否区分指令冲突与事实冲突？
- 摘要是否保留禁止事项、来源和未验证状态？
- Cache Key 是否与租户、用户、Session 和 Provider 隔离语义一致？
- Key 相同时，是否仍验证模型、指令、工具与历史的实际前缀稳定性？
- 动态状态是否通过追加差量保持新鲜，而不是为了命中继续使用旧状态？
- 是否分别观测缓存读取、缓存写入、非缓存输入、延迟和成本？
- 是否明确缓存 Token 仍占 Context Window，不能替代压缩与截断？
- 是否同时设置总预算、分类预算、单项上限和循环预算？
- Memory 写入与遗忘是否可解释、可更正、可传播？

[上一篇：Skills](07-skills-and-progressive-disclosure.md) · [返回学习地图](README.md) · [下一篇：完整案例与检查清单](09-complete-case-and-checklist.md)
