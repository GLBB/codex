# 5. Prompt 构建专题

Prompt 是最容易被文件名误导的部分。当前运行链路不是“读取一个 prompt.md，再拼上用户文本”，而是把会话级 instructions、模型可见 History、Step 级工具定义和可选输出 schema 分别映射到 Responses 请求。

## 5.1 先区分六层输入

| 层 | 典型来源 | 模型角色/请求字段 | 更新节奏 |
| --- | --- | --- | --- |
| Base Instructions | 配置 override、恢复 metadata、`ModelInfo` 默认指令 | 通常是 Responses `instructions` | Session 默认，Turn 可按模型/personality渲染 |
| Developer Messages | configured developer instructions、plugin instructions、extension fragments | `input` 中 developer message | 首轮完整注入，必要时追加 |
| Contextual User Messages | AGENTS.md、WorldState 各 section、skill instructions、环境/权限提示 | `input` 中 user message | 首轮完整，后续差量 |
| Conversation History | 用户、assistant、reasoning、tool call/output | Responses `input` | 每个 item 发生时追加；可压缩/回滚 |
| Tool Specifications | 内建、MCP、extension、dynamic、hosted tools | Responses `tools` | 每个 Step 重建 |
| Output Schema | `TurnContext.output_schema` | Responses `text.format` 等请求配置 | Turn 级 |

Developer context 是一个语义集合，不是单一字段：一部分来自 `SessionConfiguration.developer_instructions`，一部分可能由插件或 extension 以 developer-role contextual fragment 注入。AGENTS.md 与 Skills 在当前实现中通常是 contextual user messages；不能因为它们“指导模型”就一概称为 top-level developer instructions。

## 5.2 Base Instructions

会话启动时，[`Session::spawn_internal`](</home/goulei1/code/codex/codex-rs/core/src/session/mod.rs:636>) 按以下优先级选择基础指令：

1. 配置显式 override；
2. 恢复历史中的 Session metadata；
3. 当前 `ModelInfo::get_model_instructions`。

[`ModelInfo::get_model_instructions`](</home/goulei1/code/codex/codex-rs/protocol/src/openai_models.rs:487>) 还会按 personality 渲染模板。模型目录可以由服务刷新，所以“某个本地 Markdown 是唯一 base prompt”并不成立。

`run_sampling_request` 取得 Session 的 base instructions，[`build_prompt`](</home/goulei1/code/codex/codex-rs/core/src/session/turn.rs:1289>) 将其放入 `Prompt.base_instructions`。它与 History 分开保存，目的是维持 Responses API 的顶层 instructions 语义和提示词缓存稳定性。

## 5.3 Developer Messages

Session 配置中的 developer instructions 会在初始上下文构建时变成 developer-role `ResponseItem`。插件指令的 fragment 也明确使用 developer role；可从 [`plugin_instructions.rs`](</home/goulei1/code/codex/codex-rs/core/src/context/plugin_instructions.rs:1>) 看其 marker 和渲染方式。

Extensions 还可以贡献 thread/turn 范围的 developer fragments。它们最终都进入 History，而不是合并进 `Prompt.base_instructions` 字符串。这一点对于恢复很重要：History 中的 developer message 有明确时序，base instructions 则是请求级固定字段。

## 5.4 Contextual User Messages

[`ContextualUserFragment`](</home/goulei1/code/codex/codex-rs/context-fragments/src/fragment.rs:14>) 给动态上下文定义统一接口：声明 role、marker、body，并渲染成 Responses item。常见来源包括：

- AGENTS.md：[`user_instructions.rs`](</home/goulei1/code/codex/codex-rs/core/src/context/user_instructions.rs:1>)；
- Skills：[`skill_instructions.rs`](</home/goulei1/code/codex/codex-rs/core-skills/src/skill_instructions.rs:22>)；
- WorldState 中的模型、权限、环境、apps/plugins/tools、协作和多 Agent section；
- 推荐插件、token budget、extension context。

这些消息虽然使用 `user` role，却不是终端用户刚输入的自然语言。marker 让 core 可以识别、替换或差量维护它们。

## 5.5 首轮完整注入

新 Thread 不在 `Session::new` 时立刻注入初始上下文，而是在首个真实 Turn 已经合并 per-turn override 后进行。打开 [`build_initial_context_with_world_state`](</home/goulei1/code/codex/codex-rs/core/src/session/mod.rs:3421>)，按以下顺序理解即可：

1. configured developer instructions；
2. 推荐插件和 extension thread/turn fragments；
3. token budget 等会话提示；
4. 当前完整 WorldState 按各 section 声明的 role 渲染；
5. 部分 multi-agent/guardian 专用上下文。

构造出的 items 随后通过 `record_conversation_items` 写入 History 和 Rollout。首轮的关键不变量是：**用于渲染 WorldState 的 Step 与用于公开工具、执行工具的 Step 相同。**

函数内部存在 feature、session source 和 extension 条件分支。第一次只看默认根 Session 的路径，看到返回 `Vec<ResponseItem>` 即停。

## 5.6 后续 WorldState 差量注入

后续 Turn 或 Step 调用 [`record_context_updates_and_set_reference_context_item`](</home/goulei1/code/codex/codex-rs/core/src/session/mod.rs:3713>)。它比较当前 `TurnContextItem` 和 `ContextManager` 保存的 reference context，再调用 [`ContextManager::update_world_state`](</home/goulei1/code/codex/codex-rs/core/src/context_manager/history.rs:92>)：

- 没有 baseline：渲染完整 fragments，并持久化 `WorldStateItem::full`；
- 有 baseline：对 section snapshot 做比较，只渲染模型应看到的变化，并持久化 JSON merge patch；
- 无变化：不制造重复上下文消息。

差量并不意味着模型只收到“本轮新增消息”。Responses `input` 仍是规范化后的完整当前 History；所谓差量是 History 中只追加状态变化提示，而不在每轮重复整份 AGENTS.md、环境和工具说明。

## 5.7 Conversation History

模型输入由 [`ContextManager::for_prompt`](</home/goulei1/code/codex/codex-rs/core/src/context_manager/history.rs:141>) 产生。调用前 Session clone 一个快照，随后规范化：

- 缺 tool output 的 call 被补齐；
- orphan output 被删除；
- 按模型 input modalities 剥离不支持的图像/音频；
- 工具输出此前已按 truncation policy 截断。

因此 Rollout 中的原始事件集合与最终 `Prompt.input` 不是一一等同；只有 ContextManager 中适合 API 的 `ResponseItem` 经过规范化后进入请求。

## 5.8 Tool Specifications

[`build_tool_router`](</home/goulei1/code/codex/codex-rs/core/src/tools/spec_plan.rs:119>) 先注册 core tools，再附加 MCP、extension 和 dynamic runtimes，最后加入 hosted model tools。Router 同时保存 spec 与 executor registry；[`build_prompt`](</home/goulei1/code/codex/codex-rs/core/src/session/turn.rs:1289>) 读取 `router.model_visible_specs()`，并设置 `parallel_tool_calls`。

工具定义不写入 Conversation History。它们是当前 Step 的请求字段，因此 MCP server 或环境变化后可以重新构建，而无需伪造一条聊天消息。

工具的“自然语言能力摘要”可能另外作为 WorldState/context message 出现；那是帮助模型理解当前能力，不能替代正式 `tools` JSON schema。

## 5.9 Output Schema

app-server 的 `turn/start` 可把输出 schema 放入 Turn settings，最终进入 `TurnContext.final_output_json_schema`。`build_prompt` 将其复制到 `Prompt.output_schema` 并带上 strictness。ModelClient 再映射为 provider 支持的 structured-output 请求字段。

它约束 assistant 最终输出格式，不是工具参数 schema，也不进入 History。

## 5.10 映射到 Responses API

打开 [`client.rs`](</home/goulei1/code/codex/codex-rs/core/src/client.rs:840>) 的请求构造，不要继续跟 HTTP transport。标准 Responses 路径的映射是：

```text
Prompt.base_instructions -> request.instructions
Prompt.input             -> request.input
Prompt.tools             -> request.tools
Prompt.parallel...       -> request.parallel_tool_calls
Prompt.output_schema     -> request.text/format 配置
```

有一个应明确标为兼容/特殊路径的例外：Responses Lite 会把额外工具说明和 base instructions 作为 developer input 前置，并把顶层 `instructions`/`tools` 留空。阅读主链时以标准 Responses 为准，只有排查 Lite provider 时才跟这条分支。

## 5.11 旧 Prompt 文件不是当前入口

`core/` 根下可见若干 `gpt*_prompt.md`。在当前仓库的 Rust/Bazel 运行引用中，它们没有进入上述 `Session -> build_prompt -> ModelClient` 主链；不要仅凭文件名把它们当成当前 base prompt 入口。

`prompt_with_apply_patch_instructions.md` 当前可见引用位于 [`session/tests.rs`](</home/goulei1/code/codex/codex-rs/core/src/session/tests.rs:1424>)，用于测试期望，而非生产请求构建。这个判断限定于当前仓库可见实现；仓库外的打包或发布流程不在本教程证据范围内。

真正需要追的是：启动时解析出的 `BaseInstructions`、模型目录提供的 instructions、以及写进 ContextManager 的 contextual fragments。

## 5.12 Prompt 调试入口

[`prompt_debug.rs`](</home/goulei1/code/codex/codex-rs/core/src/prompt_debug.rs:26>) 的隐藏辅助入口可以构建模型可见 input，适合测试或调试上下文。但它返回的不是完整网络请求；工具字段、top-level instructions 和 transport metadata 仍应从正常 ModelClient 路径理解。

## 5.13 本章阅读停点

依次打开 `Prompt`、`build_initial_context_with_world_state`、`record_context_updates_and_set_reference_context_item`、`build_prompt` 和 `client.rs` 请求构造。能把任意一段指令归类为 `instructions`、History item 或 `tools` 后即可停下，不必先读每个 WorldState section 的渲染文案。
