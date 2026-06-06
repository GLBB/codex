# 04 Context、Memory 与 RAG：模型到底看到了什么

## 本课目标

Agent 的智能很大一部分来自“模型看到了什么”。本课把三件容易混在一起的事拆开：

- Context：本次请求注入给模型的所有内容。
- Memory：跨 turn 或跨 thread 的长期信息。
- RAG：按 query 检索外部知识，并带引用注入上下文。

学完以后，你应该能检查一次模型请求的输入，并判断哪些内容应该注入，哪些内容会污染模型。

## Step 1：列出上下文来源

先不要看源码，自己列出模型输入可能包含的内容：

- system/developer instructions
- 用户当前 query
- 历史消息
- 工具定义
- 工具结果
- 工作区环境
- AGENTS.md 或用户规则
- skills/plugins instructions
- memory/RAG retrieved snippets
- guardian 或权限提示

然后给每类内容标注：是否必须有上限。

## Step 2：阅读 Context fragments

打开：

1. `codex-rs/core/src/context/mod.rs`
2. `codex-rs/core/src/context/contextual_user_message.rs`
3. `codex-rs/core/src/context/environment_context.rs`
4. `codex-rs/core/src/context/available_skills_instructions.rs`
5. `codex-rs/core/src/context/permissions_instructions.rs`

关注一个设计点：注入上下文的内容最好是有类型的 fragment，而不是到处拼字符串。

## Step 3：阅读 Context Manager

打开：

1. `codex-rs/core/src/context_manager/mod.rs`
2. `codex-rs/core/src/context_manager/history.rs`
3. `codex-rs/core/src/context_manager/updates.rs`
4. `codex-rs/core/src/tasks/compact.rs`

思考：

- 历史如何增长？
- 什么会触发压缩？
- 压缩后哪些信息必须保留？
- 频繁改上下文为什么会破坏 prompt cache？

## Step 4：阅读 Memory

打开：

1. `codex-rs/memories/README.md`
2. `codex-rs/memories/read/src/lib.rs`
3. `codex-rs/memories/read/src/citations.rs`
4. `codex-rs/memories/write/src/phase1.rs`
5. `codex-rs/memories/write/src/phase2.rs`
6. `codex-rs/memories/write/src/guard.rs`

重点区分：

- 记忆读取：什么时候查，怎么带引用。
- 记忆写入：什么时候提取，如何避免写入垃圾。
- guard：为什么长期记忆需要过滤和约束。

## Step 5：动手练习

给 `mini-agent` 增加一个简单上下文构建器：

```text
build_context(query):
  add system
  add recent history, max 20 items
  add environment, max 2 KB
  add retrieved memories, max 3 snippets
  add tool results, each max 4 KB
```

再写一个 fake RAG：

```text
memory_store = [
  {id, text, tags}
]
retrieve(query) -> top 3 by keyword overlap
```

要求最终输出模型输入摘要：

```text
system: yes
history_items: 8
environment_bytes: 1200
memory_refs: [mem-1, mem-4]
tool_result_bytes: 3100
```

## Codex 对照源码

- `codex-rs/core/src/context`
- `codex-rs/core/src/context_manager`
- `codex-rs/core/src/tasks/compact.rs`
- `codex-rs/memories/README.md`
- `codex-rs/memories/read/src/citations.rs`
- `codex-rs/memories/write/src/guard.rs`

## 推荐资料

- [OpenAI File Search / Tools](https://platform.openai.com/docs/guides/tools)
- [LlamaIndex Agents](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [mem0](https://github.com/mem0ai/mem0)
- [Letta](https://github.com/letta-ai/letta)

## 验收标准

你完成本课时，应该能回答：

- Context、Memory、RAG 的边界分别是什么？
- 为什么所有注入模型的内容都要有大小上限？
- 记忆写入为什么比读取更危险？
- 回答中展示引用来源能解决什么问题，不能解决什么问题？
