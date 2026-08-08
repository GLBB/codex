# 04 Context、Memory 与 RAG：模型这一刻到底知道什么

## 三个概念先分开

把模型想成一位每次开会都会“失忆”的顾问。Context 是你放在这次会议桌上的材料；
Memory 是公司长期保存、以后可能取出的笔记；RAG 是根据今天的问题去资料库检索相关
材料的过程。

```text
Memory / Knowledge Base --retrieve--> candidate evidence
Conversation / Tools / Rules -------> Context Builder
                                      -> 本次 Model Request
```

Memory 和 RAG 的结果只有被选进当前 request，才成为 Context。模型不会自动知道数据库里
有什么。

## 一次请求的 Context 从哪里来

典型 Coding Agent 输入包括：

- system/developer instructions；
- 当前用户输入和必要历史；
- 工作目录、时间、权限等环境事实；
- 本轮可见的工具 schema；
- 已完成工具的结果；
- AGENTS.md、Skill 或 Plugin instructions；
- memory/RAG 召回片段与引用；
- hook 附加上下文；
- 图片、音频等多模态内容。

Context Engineering 不是“把能找到的都塞进去”，而是在质量、成本、安全和稳定性之间
选择最小充分信息。

## 每一段注入都要回答五个问题

| 问题 | 例子 |
| --- | --- |
| 来源是谁？ | 用户、项目文件、工具、远程 App |
| 模型应把它当指令还是证据？ | 工具输出通常是证据，不应覆盖 developer rule |
| 单项硬上限是多少？ | 每个工具结果最多 4 KB |
| 生命周期多长？ | 当前 step、当前 turn、整个 thread |
| 压缩/恢复后如何处理？ | 保留摘要、引用和关键约束 |

来源尤其重要：网页里出现“忽略之前指令”只是外部证据中的文字，不应获得 developer
instruction 的权力。把所有内容拼成一个字符串会丢失这种层级。

## 为什么要用有类型的 Fragment

假设环境、权限和 Skill 都直接拼进 user message。恢复历史时，系统很难判断哪段需要更新、
哪段应去重、哪段是用户原话。有类型 fragment 则可以定义 role、边界 marker、更新策略和
大小限制。

```text
EnvironmentContext(cwd, platform)
PermissionsInstructions(profile)
SkillInstructions(name, path, bounded_body)
HookAdditionalContext(source, bounded_text)
```

类型不是为了“Rust 更漂亮”，而是保护模型可见上下文的不变量：来源可识别、单项有界、
更新可控、序列化可测试。

## 长会话为什么会压缩

历史只增不减，最终会超过模型窗口。最简单的 sliding window 会把早期约束一起丢掉；
只做摘要又可能把精确文件名、审批结果和未完成任务写错。

更稳妥的压缩设计区分：

1. 永远保留的稳定规则和当前环境。
2. 可压缩的对话与 reasoning 轨迹。
3. 必须保真的工具事实、引用和当前任务状态。
4. 可以从外部存储重新获取的大对象。

压缩本身也是一次有损变换，所以要留下触发原因、摘要版本和前后 token 统计。频繁重排
稳定 prefix 还会破坏 prompt cache，导致成本与延迟上升。

## Prompt Cache 解决什么，不解决什么

Prompt Cache 解决的是重复输入的计算成本和延迟，不是上下文容量。即使某段前缀命中缓存，
它仍然属于模型这次请求的逻辑上下文，仍受 context window 和速率限制。缓存也不是回答
缓存：服务端复用前缀的预填充结果后，模型仍会为当前请求生成新的输出。

把这三个机制分开最清楚：

| 机制 | 解决的问题 | 不会做什么 |
| --- | --- | --- |
| Context window 与预算 | 限制一次请求能让模型看到多少内容 | 不负责复用重复计算 |
| Compaction | 用更短的 replacement history 延续长任务 | 不保证逐字保留旧历史 |
| Prompt Cache | 复用完全相同的 Prompt 前缀计算 | 不扩大窗口，也不复用旧回答 |

### 命中依赖相同前缀

模型服务缓存的不是 Rust `Prompt` 对象或整个 Session，而是渲染后 Prompt 的可复用前缀。
静态 instructions、稳定上下文和工具 schemas 应尽量靠前；用户新输入、最新工具结果等动态
内容自然追加到后面：

```text
请求 A：[稳定 instructions][稳定 tools][历史前缀][用户输入 A]
请求 B：[稳定 instructions][稳定 tools][历史前缀][回答 A][用户输入 B]
        ^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^^
                    可复用前缀
```

只设置相同 `prompt_cache_key` 并不能强制命中。key 帮助服务端把具有共同前缀的请求稳定
路由到合适缓存；真正命中仍要求 breakpoint 处的前缀精确一致。工具顺序、schema、图片、
动态时间文本或早期 history 发生变化，都可能缩短可复用前缀。

[官方 OpenAI Prompt Caching 文档](https://developers.openai.com/api/docs/guides/prompt-caching)
说明：符合条件且不少于 1024 tokens 的 Prompt 会自动参与缓存；GPT-5.6 及之后的模型默认
在最新 user 或 tool message 放置隐式 breakpoint，也允许调用方在稳定内容后放显式
breakpoint。不同模型代际的 breakpoint 和 retention 参数可能不同，实现时应以当前模型
文档为准。

### Codex 当前怎样接入缓存

阅读 `core/src/client.rs` 时，先看 `ModelClient::prompt_cache_key`：它优先使用 override，
否则使用 `CodexResponsesMetadata.session_id`。随后 `build_responses_request` 把这个 key 和
instructions、input、tools 等字段一起放入 `ResponsesApiRequest`。当前请求类型定义在
`codex-api/src/common.rs`，其中只显式暴露 `prompt_cache_key`，没有显式 breakpoint 或 TTL
字段，因此这条路径主要利用 provider 的自动缓存行为。

Codex 还会尽量保护前缀稳定性：history 以追加为主，稳定上下文通过 reference context 和
WorldState 的 full/patch 增量表达，规范化得到的 synthetic item id 也尽量稳定。动态发现的
工具如果每轮改变工具列表和 schema，则可能让前缀更早分叉，这也是工具暴露必须按需且有界
的性能原因。

缓存效果不能靠猜。`codex-api/src/sse/responses.rs` 会把响应 usage 中的 `cached_tokens` 和
`cache_write_tokens` 转成 `TokenUsage.cached_input_tokens` 和
`TokenUsage.cache_write_input_tokens`。观测时至少同时记录总 input tokens、缓存读取、缓存
写入、延迟、模型和 cache key 作用域，才能判断稳定前缀是否真正带来收益。

### WebSocket 增量请求不是 Prompt Cache

`core/src/client.rs` 的 `ModelClientSession::get_incremental_items` 处理的是另一层优化：同一
turn 内，如果新请求的非 input 属性不变，而且 input 是上一请求和响应的严格追加，它会用
`previous_response_id` 只发送新增 items。这减少的是网络传输和请求重放，不等于 provider
复用了模型前缀计算。

```text
逻辑 Prompt：每次仍从当前有效 history 重新构建
WebSocket delta：可能只传新增 items
Prompt Cache：provider 复用相同前缀的预填充计算
```

三者可以同时发生，也可以分别失效。例如改动 tool schema 会让 WebSocket 属性比较失败，
也可能破坏 Prompt Cache；HTTP 路径即使发送完整 input，仍可能命中 provider cache。

### Compaction 与缓存如何相互影响

Compaction 会用 replacement history 替换旧的模型可见历史，因此压缩后的第一个请求通常
形成了一个新前缀，不能假设继续命中压缩前的长前缀。此后如果 replacement history、基础
指令和工具定义保持稳定，新的前缀又可以被后续请求复用。

所以不要为了短期 cache hit 推迟必要压缩：容量正确性优先。更好的目标是让 compaction
结果可恢复且稳定，并减少无意义的前缀重排，在新的窗口内重新建立缓存局部性。

## Memory 的读取和写入不是对称的

读取错误通常影响当前回答；写入错误会污染未来很多 thread。长期记忆写入因此需要：

```text
候选事实提取
  -> 是否值得长期保存
  -> 来源与权限检查
  -> 去重/冲突处理
  -> 过期和删除策略
  -> 写入
```

“用户喜欢深色主题”可能是稳定偏好；“当前测试失败”通常只是任务临时状态。Memory 还要
支持修正、遗忘、引用和权限隔离，不是把聊天摘要永久保存就结束。

## RAG 是一次证据供应链

RAG 会把 query 改写为检索请求，从文档中召回片段、排序、打包进 context，并在回答中
保留来源。它解决知识新鲜度和证据定位，不保证模型一定忠实使用证据。

当回答错误时先分层：没召回是 retrieval 问题；召回但排后是 ranking；证据正确却回答
错是 packing/prompt/generation。第 8 课会完整展开。

## 多模态仍然服从同一预算

图片不是“不要 token 的附件”。它有尺寸、detail、编码和模型处理成本。Agent 可能缩放
图片，并用单独 notice 告诉模型原始与处理后尺寸。音频、文件和工具返回图片也要有数量、
字节或时长上限。

统一原则是：大对象保存为受控引用，模型只看到任务所需的有界表示；转换发生后要保留
来源和变换信息。

## 动手实验：做一个 Context Inspector

为 `mini-codex-agent` 实现 `build_context`，输出的不只是 messages，还要生成清单：

```text
developer_instructions: 820 tokens, stable
history: 12 items, 3100 tokens
tool_specs: 5 direct, 1400 tokens
tool_results: 2 items, 3900 bytes, 1 truncated
skills: [repo-review], 6400 bytes
memories: [mem-3, mem-8], 720 tokens
images: 2, resized=true
hook_context: 420 tokens
total_estimated_tokens: 9100
```

设置总预算后，设计确定性的裁剪顺序。再测试：超长工具结果、过大 Skill、四张图片、冲突
memory 和压缩后的恢复。每次都要说明删掉什么、为什么不删掉更重要的信息。

## 常见误区

- Context 就是聊天历史。工具、规则、环境和多模态同样属于输入。
- RAG 召回结果天然可信。外部内容仍可能过时、越权或包含 prompt injection。
- Summary 可以替代原始事实。精确 ID、引用和权限决定常需保真。
- Memory 越多越智能。错误或无关记忆会持续污染决策。
- 只限制总窗口，不限制单项。一个工具结果仍可垄断整个 context。
- Prompt Cache 可以让超长请求继续运行。缓存只复用计算，不能扩大 context window。
- 相同 cache key 一定命中。真正命中仍要求对应 breakpoint 之前的前缀精确一致。
- WebSocket 只发送新增 items 就等于命中 Prompt Cache。两者分属传输层和模型计算层。

## 理解之后再对照 Codex

有类型 fragment 位于 `core/src/context`，历史增长与更新在 `core/src/context_manager`，压缩
任务在 `core/src/tasks/compact.rs`。Skills 的加载、注入和 `SkillInstructions` 位于
`core-skills/src/loader.rs`、`injection.rs`、`skill_instructions.rs`；core 通过
`core/src/skills.rs` 集成。多模态输入类型见 `protocol/src/user_input.rs`，图片变换提示见
`core/src/context/image_resize_notice.rs`。Memory 的读、引用、分阶段写入和 guard 位于
`memories/read` 与 `memories/write`。

源码对照的任务是找出每类 fragment 的来源、上限和生命周期，不是罗列所有文件。

## 本课验收

你应该能：

1. 用“会议桌、长期笔记、检索”解释 Context、Memory、RAG。
2. 为任何新 context fragment 定义来源、角色、上限、生命周期和压缩策略。
3. 解释为什么 Memory 写入比读取风险更长期。
4. 用 Context Inspector 找出一次请求最占预算的三项。
5. 区分 context window、compaction、Prompt Cache 和 WebSocket 增量请求。
6. 用 `cached_tokens` 和 `cache_write_tokens` 判断稳定前缀是否真的被复用。
