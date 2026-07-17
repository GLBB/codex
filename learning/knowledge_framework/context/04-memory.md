# Memory：工作记忆、情景记忆、语义记忆与经验

## 1. Memory 不是“把所有聊天都存下来”

真正的 Memory 系统要回答两个问题：未来什么场景值得再次使用这条信息，以及何时应该修正或忘记它。

```text
Session 事件 / Tool Observation / 用户明确陈述
                       ↓
                 Memory 候选提取
                       ↓
      价值、作用域、来源、置信度、敏感性检查
                       ↓
             写入 / 合并 / 拒绝 / 删除
                       ↓
          未来任务按需召回并再次验证
```

完整 History 是 Memory 的来源之一，却不是 Memory 本身。

## 2. 四类 Memory

### 工作记忆

工作记忆服务当前任务，生命周期通常是一个 Turn 或 Session。

适合保存：当前目标、计划、已验证事实、未解决问题、正在使用的路径与 ID。它往往存在于结构化 Task State、最近 History 或压缩摘要中，不必进入长期数据库。

### 情景记忆

情景记忆记录“曾经发生过什么”：

```text
2026-07-17，在 repo A 的 branch B 上，
用户要求只诊断构建失败；确认原因是锁文件漂移，未修改文件。
```

它保留事件、时间和上下文，适合恢复旧任务、追踪决策依据或发现重复故障。它不是永恒事实；另一个分支或更新后的仓库可能已经不同。

### 语义记忆

语义记忆是从事件中提炼出的相对稳定事实：

```text
repo A 修改 Cargo 依赖后需要更新 MODULE.bazel.lock。
```

它应带来源和适用范围。若事实来自仓库规则，最好保存可重新读取的来源位置，而不是只存一句脱离版本的结论。

### 用户偏好与程序性经验

用户偏好描述“这个用户通常希望怎样协作”，例如偏好中文说明、不要自动推送。程序性经验描述“某类工作怎样做更有效”，例如先运行项目级测试再运行完整测试。

两者都不能覆盖当前明确指令、组织 Policy 或仓库规则。“用户上次让直接提交”不是本次也允许提交的永久授权。

## 3. 四类 Memory 的对照

| 类型 | 典型问题 | 生命周期 | 主要召回键 | 主要风险 |
| --- | --- | --- | --- | --- |
| 工作记忆 | 现在做到哪一步？ | Turn / Session | 当前 Task | 状态丢失、无限膨胀 |
| 情景记忆 | 上次发生了什么？ | 跨 Session | 时间、项目、事件 | 把旧情景当当前事实 |
| 语义记忆 | 已知哪些稳定事实？ | 跨 Session | 实体、主题、Scope | 过期、错误提炼 |
| 偏好 / 程序性 | 通常怎样协作或执行？ | 用户或组织级 | 用户、任务类型 | 越权、过度泛化 |

这是认知分类，不要求存储层一定建立四张表。一个 Memory 可以同时包含事件来源与提炼事实，但读取时要知道自己使用的是哪种语义。

## 4. Memory Write Policy

写入前依次判断：

1. **Future value**：未来是否可能减少重复工作或改善体验？
2. **Explicitness**：这是用户明确陈述，还是模型推断？
3. **Scope**：仅当前项目、某类任务、某个用户，还是组织级？
4. **Stability**：多快会过期，能否在使用前重新验证？
5. **Sensitivity**：是否包含秘密、个人信息或不应长期保存的数据？
6. **Conflict**：是否与已有 Memory 或当前权威来源冲突？

建议保存的不是裸文本，而是：

```text
MemoryRecord
├── claim / procedure / preference
├── kind
├── scope
├── source references
├── created_at / updated_at / expires_at
├── confidence
├── sensitivity
└── supersedes / contradicted_by
```

## 5. 什么时候不要写

- 一次性任务细节，没有未来价值。
- 未经确认的模型猜测。
- 可从权威动态来源便宜读取的易变事实。
- 密码、Token、私钥和无必要的敏感数据。
- 当前用户明确要求不保留的内容。
- 仅因一次行为推断出的长期偏好。
- 会被误解为未来授权的副作用许可。

## 6. 读取不是盲信

Memory 召回后仍需：

- 检查 Scope 是否匹配当前用户、租户、仓库和分支；
- 对易变事实检查 Freshness，必要时重新读取权威来源；
- 与当前明确指令冲突时服从当前指令；
- 把推断标为推断，不伪装成用户原话；
- 在影响高风险动作前要求当前授权。

Memory 是决策输入，不是 Policy Grant。

## 7. Forget Policy

遗忘不只是删除一行。系统至少要支持：

- 用户主动清除；
- TTL 到期；
- 新事实取代旧事实；
- 来源删除后的派生数据清理；
- 账户、租户或项目 Scope 关闭；
- 敏感性策略要求立即移除；
- 降低召回权重但保留审计记录。

若 Memory 已被复制进索引、摘要和缓存，删除流程还要传播到这些派生物。否则“主表已删”不等于系统真的忘记。

## 8. Codex 源码阅读路线

先读 `codex-rs/state/src/runtime/memories.rs` 的 `MemoryStore`。从 `claim_stage1_jobs_for_startup` 看旧 Thread 如何成为提取候选，再看 Stage 1 Output、全局 Consolidation Job、使用计数和 `clear_memory_data`，理解提取与整合为什么是两个阶段。

接着看 `codex-rs/state/memory_migrations/0001_memories.sql`，用表结构确认 Job、来源更新时间、使用次数与输出之间的关系。然后到 `codex-rs/core/src/client.rs` 搜索 Memory summarize 请求，观察模型提炼如何接入状态存储。

最后读 `codex-rs/protocol/src/memory_citation.rs`，理解 Memory 注入后为何还需要 Citation；结合 `codex-rs/app-server/tests/suite/v2/memory_reset.rs` 看“忘记”如何成为对外可验证行为。

当前实现是理解工程管线的例子，不必把其阶段命名等同于四类认知 Memory。四类划分是设计和评审 Memory 内容时的语义工具。

## 9. 设计检查

- History、工作状态与长期 Memory 是否明确分开？
- 每条 Memory 是否有 Scope、来源、时间和置信度？
- 推断偏好是否能被用户查看、更正和删除？
- 易变事实使用前是否重新验证？
- Memory 是否可能被误当成当前授权？
- 删除能否传播到摘要、索引、缓存和派生记录？
- 是否评估写入准确率、召回价值、过期率和错误影响？

[上一篇：环境与 Workspace 状态](03-environment-and-workspace-state.md) · [返回学习地图](README.md) · [下一篇：RAG 摄取与索引](05-rag-ingestion-indexing-and-isolation.md)
