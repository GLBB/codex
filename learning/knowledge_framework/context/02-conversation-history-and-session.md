# 对话历史与 Session

## 1. 一次聊天其实包含多层对象

```text
Thread / Session
├── Turn 1
│   ├── user message
│   ├── assistant reasoning / response
│   ├── tool call
│   └── tool output
├── Turn 2
│   └── ...
└── Rollout / Event Log
    └── 用于持久化、恢复、审计或派生视图
```

这些对象不应被都叫作“上下文”。

| 概念 | 含义 |
| --- | --- |
| Thread / Session | 一段可继续、恢复或分叉的交互生命周期 |
| Turn | 一次用户任务边界及其内部的多轮模型—工具交互 |
| Message / Item | 历史中的具体内容单元；不一定都是自然语言消息 |
| History | 该 Thread 已发生事件的有序记录或其物化视图 |
| Model Context | 某一次模型调用实际可见的有界输入 |
| Rollout / Trace | 更适合持久化、恢复、调试和审计的事件记录 |

History 可以比 Model Context 大，Rollout 可以比 History 更详细，Memory 又可以跨越多个 Session。

## 2. 为什么不能每轮只传最后一句

考虑任务：“把配置读取错误修好，但不要改公共 API”。模型下一步至少要知道：

- 用户目标和范围；
- 已经查看过哪些文件；
- 上一次测试失败的内容；
- 已执行的修改；
- 工具调用与结果之间的对应关系；
- 当前计划是否变化。

只传最后一句会丢掉状态；无脑传全量又会超出窗口、增加延迟，并让旧错误干扰当前决策。Context Manager 的工作就是在连续性和容量之间保持不变量。

## 3. 历史的关键不变量

### 有序追加

普通历史应按发生顺序追加。频繁重写早期内容会破坏缓存、审计与恢复。确实需要压缩、回滚或脱敏时，应显式产生新版本或记录转换关系。

### 调用与结果成对

```text
tool_call(call_id = 42)  ↔  tool_output(call_id = 42)
```

孤立 Tool Output 会让模型不知道它回答了什么；孤立 Tool Call 会让模型误以为动作仍未完成。删除或截断历史时也必须维护配对。

### 边界明确

系统需要知道哪个 Item 是新用户 Turn、哪个是模型生成内容、哪个是环境注入。否则回滚“最后两轮”或压缩“旧历史”时会裁错位置。

### 内容有界

一个 20 MB 的编译日志不能原样永久进入历史。应该截断、保存 Artifact，并在 Context 中保留错误窗口、路径、哈希或可再次读取的引用。

## 4. Resume、Fork、Rollback 的语义

- **Resume**：继续同一 Thread，需要恢复历史、设置状态和必要的最新环境。
- **Fork**：从某个历史点创建新分支；之后两个分支的事件不再共享。
- **Rollback**：裁掉后续 Turn，让当前分支回到过去的逻辑边界；外部副作用不一定随历史回滚。

最后一点最危险：删掉“执行了部署”的消息，并不会撤销已经发生的部署。Session 历史不是现实世界的事务日志替代品。

## 5. 压缩不是普通摘要

当 History 接近窗口上限时，可以把旧区段压成一个 Compacted Item：

```text
旧历史：目标 + 调查过程 + 多次日志 + 决策 + 修改
                         ↓
压缩状态：
- 当前目标与禁止事项
- 已确认事实及证据位置
- 已做修改
- 未解决问题
- 重要 ID、路径和测试结果
```

好压缩保留未来行动所需的状态；坏压缩只写“用户和助手讨论了构建问题”。压缩后还要保留最近原始 Turn，因为细节和对话衔接通常集中在尾部。

## 6. Handoff Skill 与 Context 压缩不是一回事

社区工具中的 `/handoff` 或 Handoff Skill，常见用途是生成一份结构化交接件，让任务能在新 Session、另一个 Agent 或人类接手者处继续。例如社区项目 oh-my-opencode 的 `/handoff` 会记录当前状态、已完成工作、剩余工作和相关文件路径，用于在新 Session 继续。它与自动压缩都可能产出“摘要”，但系统语义不同。

| 维度 | Context Compaction | Handoff Skill / Command |
| --- | --- | --- |
| 主要目的 | 当前 Thread 接近窗口上限后继续运行 | 跨 Session、Agent 或人传递任务 |
| 典型触发 | Token 阈值、模型切换、Runtime 策略 | 用户要求交接、主动换 Session、职责切换 |
| 接收者 | 同一 Thread 后续模型调用 | 新 Session、目标 Agent 或人 |
| 结果位置 | History 中的 Compacted Item 或内部状态 | 显式文档、消息、Artifact 或交接参数 |
| 对原历史的影响 | 可能替换模型可见的旧历史 | 通常不改写当前 History |
| 是否立即释放当前窗口 | 是，若 Runtime 用结果替换旧历史 | 否；只有进入新 Context 且不再携带旧历史时才释放 |
| 内容重点 | 维持当前推理连续性 | 让不了解前情的接收者能够重新定位、验证并接手 |

### 哪个效果更好

不能脱离任务阶段比较。如果目标是**在同一 Session 中无缝继续**，Compaction 通常更好；如果目标是**摆脱长期积累的噪声，在干净 Context 中重新聚焦**，高质量 Handoff 往往更好。

| 评价目标 | 更适合的机制 | 原因 |
| --- | --- | --- |
| 保留近期对话细节 | Compaction | 通常仍保留最近原始 Turn |
| 延续 Tool Call、内部 ID 和运行状态 | Compaction | 仍处于原 Thread 和 Runtime 生命周期 |
| 清除重复日志、失败探索和过期计划 | Handoff + 新 Session | 新 Context 不再携带旧历史 |
| 让另一个 Agent 或人接手 | Handoff | 交接件面向不了解原历史的接收者 |
| 自动跨过一次 Token 阈值 | Compaction | Runtime 可以直接替换旧 Model Context |
| 多次压缩后恢复任务清晰度 | Handoff + 新 Session | 避免继续累积摘要漂移和旧 Context 干扰 |

Handoff 经常“感觉效果更好”，是因为它把任务重新整理成一份短而自包含的状态，并在新 Session 中去掉探索过程：

```text
旧 Session
├── 多轮探索和失败尝试
├── 重复 Tool Output
├── 已过期的计划与 Workspace 判断
└── 当前仍然有效的任务状态
                 │
                 ▼ Handoff
新 Session
├── 目标、限制和完成标准
├── 已确认事实与证据位置
├── 当前修改和验证结果
└── 未决项、下一步与待刷新状态
```

但这种优势不是 Handoff 这个名字天然带来的。如果交接件漏掉否定条件、失败原因、用户已有改动或外部副作用，新 Session 无法再从原始 History 补回信息，效果会比 Compaction 更差。Compaction 的主要风险则是摘要错误继续留在同一 Thread，并与残余旧 Context 一起累积。

还要注意：**只在当前 Session 里生成 Handoff 文档，不切换 Context，并不会节省 Token 或清除噪声**。只有新 Session 以 Handoff 为启动输入、且不再附带完整旧历史时，才获得“干净重启”的效果。

### 推荐的组合策略

```text
普通长任务
    ↓
优先 Compaction，保持工具和近期对话连续
    ↓
到达阶段边界 / 多次压缩 / 出现重复与约束遗忘
    ↓
生成 Handoff Artifact
    ↓
新 Session 读取 Handoff，并重新验证 Workspace、权限和外部状态
```

适合继续 Compaction 的信号：任务接近完成、近期 Tool 交互很重要、后台进程仍在运行，或者只是第一次接近窗口阈值。

适合 Handoff 的信号：从调查切换到实现或验证阶段、已经多次压缩、模型开始重复或遗忘约束、需要更换 Agent / Model / Environment，或者任务将暂停后继续。

所以更准确的结论是：**Compaction 擅长不中断地继续，Handoff 擅长清理后重新开始；长任务通常组合使用，而不是永久二选一。**

### 同一段摘要为什么不能直接通用

压缩摘要可以依赖同一 Thread 中仍保留的最近 Turn、工具状态和内部 ID；Handoff 必须更自包含，至少明确：

- 目标、范围、禁止事项和完成标准；
- 当前 Commit、分支、Dirty File 与文件归属；
- 已完成动作、外部副作用和验证结果；
- 未决问题、失败尝试、下一步和停止原因；
- 证据、Artifact、路径与可重新读取的位置；
- 接收者必须重新验证的新鲜状态与权限。

Handoff 不是把完整 Context 复制到另一个地方。它应去掉闲聊、重复日志和无关秘密，并把易变事实标为待验证。接收者恢复工作时，仍要重新读取 Workspace、权限和外部系统状态。

### “Handoff”还有另一种含义

在一些 Multi-Agent Framework 中，Handoff 指把控制权和结构化输入转交给另一个 Agent，而不是生成新 Session 摘要。例如 OpenAI Agents SDK 的 Handoff 会把控制转移给指定 Agent。它可能携带交接摘要，但“控制转移”和“历史压缩”仍是不同机制。

因此看到 Handoff 时先问：它是在生成交接 Artifact、启动新 Session，还是把当前 Run 路由给另一个 Agent。不能只凭名字判断 Context 生命周期。

参考实现：[oh-my-opencode `/handoff`](https://github.com/Wangmerlyn/oh-my-opencode/blob/dev/docs/reference/features.md#handoff)、[OpenAI Agents SDK Handoffs](https://github.com/openai/openai-agents-python/blob/main/docs/handoffs.md)。

## 7. Session 状态不只在消息里

生产系统还会在结构化状态中维护：

- 当前模型、推理强度和能力；
- 工作目录、Sandbox 和审批模式；
- Token 使用量与自动压缩阈值；
- 当前计划、排队输入和取消状态；
- 可用工具、Skill、App 或环境；
- 持久化位置、Thread ID、Turn ID。

把这些都塞进自然语言历史会造成重复和漂移。更好的做法是：结构化状态作为真值源，需要模型知道时再渲染成有界 Fragment。

## 8. Codex 源码阅读路线

从 `codex-rs/core/src/context_manager/history.rs` 的 `ContextManager` 开始。依次看 `record_items`、`for_prompt`、`replace`、`drop_last_n_user_turns` 和 `normalize_history`，注意它怎样维护顺序、历史版本、Token 信息以及 Call / Output 配对。

然后阅读同目录的 `normalize.rs`，观察缺失输出、孤立输出和不支持图片时的处理。接着进入 `codex-rs/core/src/session/turn.rs`、`turn_context.rs` 与 `session.rs`，建立 Session 状态、Turn 状态与 Context Manager 之间的关系。

最后阅读 `codex-rs/thread-store/src/local/model_context.rs` 和 `thread_history_materialization.rs`，理解持久化事件如何恢复为模型上下文；再看 `codex-rs/core/src/compact.rs` 与 `compact_remote*.rs`，理解压缩为何是显式的历史转换。

阅读到能画出“用户输入 → History 追加 → Prompt 归一化 → 模型 → Tool Item → 持久化”的路径即可，暂时不用深入 UI 事件映射。

## 9. 设计检查

- History、Model Context 和审计 Trace 是否是不同视图？
- 工具调用和输出在截断、回滚、恢复后是否仍然成对？
- 单个消息、图片和 Tool Output 是否有硬上限？
- Resume 是否会刷新易变环境，而不是盲信旧快照？
- Fork 是否有明确的共享点和独立后续事件？
- 压缩是否保留目标、约束、事实、证据、修改和未决项？
- 系统是否根据连续性需求、Context 噪声和任务阶段选择 Compaction 或 Handoff？
- Handoff 是否明确接收者、状态基线、证据位置和必须重新验证的内容？
- Handoff 是否被误认为当前 Session 的自动 Token 回收机制？
- 新 Session 是否真的只使用交接所需 Context，而不是把 Handoff 和全部旧历史再次拼在一起？
- 外部副作用是否被误认为能随对话回滚？

[上一篇：Prompt、指令来源与优先级](01-prompt-instructions-and-priority.md) · [返回学习地图](README.md) · [下一篇：环境与 Workspace 状态](03-environment-and-workspace-state.md)
