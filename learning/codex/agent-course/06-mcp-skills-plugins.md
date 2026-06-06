# 06 MCP、Skills 与 Plugins：扩展 Agent 能力

## 本课目标

Agent 不可能把所有能力都写死在 core 里。本课学习三类扩展：

- MCP：用标准协议连接外部 tools/resources/prompts。
- Skills：把可复用工作流知识写成可触发的说明和参考资料。
- Plugins：把工具、资源、技能或配置打包成可安装单元。

学完以后，你应该能判断一个能力应该做成内置工具、MCP server、skill，还是 plugin。

## Step 1：先画扩展边界

写下四个问题：

| 问题 | 更适合的形态 |
| --- | --- |
| 需要调用外部系统 API | MCP |
| 主要是工作流说明和参考资料 | Skill |
| 要分发一组工具、技能和配置 | Plugin |
| 必须由 core 强一致控制 | 内置工具 |

## Step 2：阅读 MCP 连接和调用

打开：

1. `codex-rs/codex-mcp/src/connection_manager.rs`
2. `codex-rs/codex-mcp/src/runtime.rs`
3. `codex-rs/codex-mcp/src/tools.rs`
4. `codex-rs/codex-mcp/src/elicitation.rs`
5. `codex-rs/core/src/mcp_tool_call.rs`

观察：

- server 如何连接。
- tool list 如何刷新。
- MCP tool call 如何经过权限和 guardian。
- elicitation 为什么和普通 tool call 不一样。

## Step 3：阅读 Skills

打开：

1. `codex-rs/skills/src/lib.rs`
2. `codex-rs/core/src/skills.rs`
3. `codex-rs/core/src/context/available_skills_instructions.rs`
4. 当前环境里的一个 `SKILL.md`

关注：

- skill 如何被发现。
- 触发规则如何进入上下文。
- 为什么不能把所有 skill 全量塞进模型。
- skill 里的 references/scripts/assets 如何渐进读取。

## Step 4：阅读 Plugins

打开：

1. `codex-rs/plugin/src/lib.rs`
2. `codex-rs/plugin/src/plugin_id.rs`
3. `codex-rs/core-plugins`
4. `codex-rs/core/src/context/plugin_instructions.rs`
5. `codex-rs/core/src/context/available_plugins_instructions.rs`

思考：

- plugin 和 skill 的职责差别是什么？
- plugin 安装后如何影响可用工具或上下文？
- 插件失败应该阻塞 agent 还是降级？

## Step 5：动手练习

给 `mini-agent` 设计一个 `repo-review` skill：

```text
repo-review/
  SKILL.md
  references/checklist.md
  scripts/collect_diff.sh
```

`SKILL.md` 至少包含：

```markdown
# repo-review

Use when the user asks for a code review.

Workflow:
1. Read git diff.
2. Identify behavior changes.
3. Check tests.
4. Return findings first, ordered by severity.
```

然后写出触发逻辑：

```text
if user query contains ["review", "代码审查"]:
  expose skill summary
  load references/checklist.md only when needed
```

## Codex 对照源码

- `codex-rs/codex-mcp/src/connection_manager.rs`
- `codex-rs/codex-mcp/src/tools.rs`
- `codex-rs/core/src/mcp_tool_call.rs`
- `codex-rs/skills/src/lib.rs`
- `codex-rs/core/src/skills.rs`
- `codex-rs/core/src/context/available_skills_instructions.rs`
- `codex-rs/plugin/src/lib.rs`
- `codex-rs/core/src/context/plugin_instructions.rs`

## 推荐资料

- [Model Context Protocol docs](https://modelcontextprotocol.io/)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/latest)
- [Codex Skills docs](https://developers.openai.com/codex/skills)
- [Codex Plugins docs](https://developers.openai.com/codex/plugins)

## 验收标准

你完成本课时，应该能回答：

- MCP、Skill、Plugin 各自解决什么问题？
- 为什么 skill 要渐进加载，而不是一次性全部注入？
- MCP tool call 为什么仍然要走权限和 guardian？
- 一个团队内部工具应该做成 MCP server 还是内置工具？
