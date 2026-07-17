# Context 与知识系统学习地图

## 目标

Context 系统决定模型在当前一步“看见什么、把什么当指令、依据什么事实做判断”。它不是一个不断增长的 Prompt 字符串，而是一套有来源、有优先级、有生命周期、有容量上限的工作集装配系统。

本文档组展开 [Agent 知识框架](../agent_knowledge_framework) 的第三部分：

```text
指令 / 历史 / Workspace / Memory / RAG / Skills / Tool Observation
                              │
                              ▼
                 来源标注、信任判断与新鲜度检查
                              │
                              ▼
                   选择、去重、冲突处理与压缩
                              │
                              ▼
                    有界的 Model-visible Context
                              │
                              ▼
                   决策、行动、证据与状态更新
                              │
                    ┌─────────┴─────────┐
                    ▼                   ▼
               Session 追加       Memory 写入候选
```

学习这部分时始终追问四个问题：信息从哪里来、它能否发号施令、它是否仍然有效、为什么值得占用本轮 Token。

## 推荐学习顺序

1. [Prompt、指令来源与优先级](01-prompt-instructions-and-priority.md)：先区分任务、指令、数据和证据。
2. [对话历史与 Session](02-conversation-history-and-session.md)：理解 Thread、Turn、History 与模型上下文的边界。
3. [环境与 Workspace 状态](03-environment-and-workspace-state.md)：理解 Agent 如何获得当前世界快照。
4. [Memory](04-memory.md)：区分工作记忆、情景记忆、语义记忆、偏好与程序性经验。
5. [RAG：摄取、切分、索引与隔离](05-rag-ingestion-indexing-and-isolation.md)：理解知识如何变成可安全检索的数据。
6. [RAG：召回、证据与评估](06-rag-retrieval-grounding-and-evaluation.md)：理解检索结果如何成为可核验依据。
7. [Skills：按需加载工作方法与资源](07-skills-and-progressive-disclosure.md)：理解渐进披露，而不是把所有方法常驻 Context。
8. [Context Engineering](08-context-engineering.md)：把来源、选择、冲突、压缩、缓存和预算放进一条装配流水线。
9. [完整案例与设计检查清单](09-complete-case-and-checklist.md)：用一次代码仓库故障修复串起全部节点。

## 先建立三个边界

### Context 不等于 Prompt

Prompt 常指给模型的指令或输入文本；Context 是一次推理可见的全部信息，可能还包括结构化工具定义、历史消息、图片和工具结果。Prompt 构造只是 Context Engineering 的一个环节。

### History 不等于 Memory

History 是某个 Session 中实际发生过的事件记录；Memory 是经过选择、提炼并准备在未来复用的信息。把完整历史称为长期记忆，会掩盖写入策略、遗忘策略和错误传播问题。

### 检索到的内容不等于指令

RAG 文档、网页、日志和工具输出通常是数据或证据。即使其中出现“忽略先前要求”，它也不会因此获得更高指令权。来源可信度与指令权限是两个维度。

## 三个贯穿全组的问题

### 窗口装得下，模型就一定用得好吗

不一定。Context Window 是协议和模型允许接收的容量，Effective Context 是模型在具体任务中能稳定定位、组合并服从的信息范围。位置偏置、干扰项数量、多跳证据距离、输入结构和具体模型版本都会影响利用率，详见 [Context Engineering](08-context-engineering.md#2-标称-context-window-不等于有效-context)。

### Handoff Skill 就是 Context 压缩吗

不是。社区中的 Handoff Skill 通常为新 Session、另一个 Agent 或人生成显式交接件；Context 压缩是在当前 Thread 内为释放窗口而转换旧历史。两者都可能生成摘要，但触发原因、接收者、存放位置和生命周期不同，详见 [对话历史与 Session](02-conversation-history-and-session.md#6-handoff-skill-与-context-压缩不是一回事)。

### 大 Context Window 会让 RAG 失去价值吗

通常不会。大窗口缓解“选出的材料放不下”，RAG 解决“从更大且持续变化、受权限控制的知识空间中选什么”。当资料小而固定时可以直接使用 Long Context；企业知识、动态事实和可引用回答通常仍需 RAG，实践中常采用 Hybrid，详见 [RAG：召回、证据与评估](06-rag-retrieval-grounding-and-evaluation.md#9-模型上下文很大rag-是否还有用)。

## 六类知识载体

| 载体 | 典型生命周期 | 主要用途 | 首要风险 |
| --- | --- | --- | --- |
| 指令 | 系统、会话或当前 Turn | 规定目标与行为边界 | 冲突、越权、提示注入 |
| 对话历史 | Thread / Session | 保持任务连续性 | 无限增长、错误累积 |
| Workspace 状态 | 当前环境快照 | 反映文件、分支、权限与工具状态 | 过期、泄密、竞态 |
| Memory | 跨步骤或跨会话 | 复用事实、偏好和经验 | 错记、过期、作用域污染 |
| RAG 证据 | 查询时动态加载 | 提供外部事实依据 | 召回错误、ACL 泄漏、无引用 |
| Skill | 任务触发后加载 | 提供可复用工作方法、知识与资源 | 误触发、上下文膨胀、隐含权限 |

## 两条核心闭环

### 读路径

```text
任务理解 → 候选来源发现 → 权限过滤 → 相关性选择
        → 冲突与新鲜度处理 → 预算分配 → 注入模型
```

### 写路径

```text
本轮事件 → 提取候选 → 判断是否值得长期保存
        → 确定作用域、来源、置信度与过期策略
        → 写入 / 更新 / 拒绝 → 支持查询、更正和遗忘
```

只设计读路径，系统会不断消费知识却无法治理积累；只设计写路径，系统会形成一个越来越大的错误仓库。

## Codex 源码验证基线

本文档用当前仓库中的 Codex 实现帮助理解通用概念。重点入口包括：

- `codex-rs/context-fragments/src/fragment.rs`：有类型、有角色、有边界标记的 Context Fragment。
- `codex-rs/core/src/context_manager/history.rs`：历史记录、归一化、工具调用配对与 Token 估算。
- `codex-rs/core/src/context/world_state/`：环境、AGENTS.md、Apps、Plugins 等状态的快照与差量注入。
- `codex-rs/core/src/session/` 与 `codex-rs/thread-store/`：Turn、Session、恢复和持久化历史。
- `codex-rs/state/src/runtime/memories.rs`：Memory 提取、整合、使用计数与清理。
- `codex-rs/core-skills/src/`：Skill 发现、Metadata 预算、加载与注入。
- `codex-rs/core/src/compact*.rs`：本地或远端压缩与压缩预算。

这些是实现示例，不代表 RAG、Memory 或指令优先级只有一种标准协议。阅读时先理解职责，再对照类型名。

## 学习完成标准

完成本组文档后，应能解释：

1. 为什么“模型看见了某段文字”和“这段文字有权发指令”不是一回事。
2. Thread、Turn、History、Rollout、Model Context 和 Memory 的区别。
3. 为什么 Workspace 状态需要快照、差量和新鲜度，而不是每轮全量拼接。
4. 四类 Memory 分别适合存什么，以及何时不应写入。
5. RAG 从摄取到引用的完整链路，以及租户隔离为什么必须在检索前实施。
6. Skill 为什么采用 Metadata → 主说明 → 相关资源的渐进披露。
7. 摘要、截断和缓存分别解决什么问题，分别可能损失什么。
8. 如何给不同 Context 类别分配预算和硬上限。
9. 如何设计 Memory Write / Forget Policy，避免把一次误解变成长期事实。
