# 03 Tool System：从工具声明到执行结果

## 本课目标

工具系统决定 Agent 能做什么，也决定它能造成什么风险。本课你要学会追踪一个工具的完整生命周期：

```text
tool spec -> 暴露给模型 -> 模型发起 tool call -> 路由 -> handler -> runtime -> result -> 回填上下文
```

## Step 1：从工具注册表开始

打开：

1. `codex-rs/core/src/tools/registry.rs`
2. `codex-rs/core/src/tools/router.rs`
3. `codex-rs/core/src/tools/mod.rs`

先找两个问题：

- 工具是在哪里声明的？
- 模型看到的 schema 和本地 handler 如何对应？

## Step 2：看工具 handler

打开：

1. `codex-rs/core/src/tools/handlers/shell.rs`
2. `codex-rs/core/src/tools/handlers/apply_patch.rs`
3. `codex-rs/core/src/tools/handlers/mcp.rs`
4. `codex-rs/core/src/tools/handlers/request_user_input.rs`

比较不同工具：

- 哪些工具直接执行？
- 哪些工具需要用户输入？
- 哪些工具转发给外部协议？
- 哪些工具需要权限或沙箱？

## Step 3：看执行编排

打开：

1. `codex-rs/core/src/tools/orchestrator.rs`
2. `codex-rs/core/src/tools/runtimes/mod.rs`
3. `codex-rs/core/src/tools/events.rs`
4. `codex-rs/core/src/tools/tool_dispatch_trace.rs`

关注：

- 工具执行前后发哪些事件。
- 结果如何转换成模型可读内容。
- 错误结果是否结构化。
- trace 如何帮助定位工具问题。

## Step 4：设计自己的工具协议

写一个 `read_file` 工具 spec：

```json
{
  "name": "read_file",
  "description": "Read a UTF-8 text file from the workspace.",
  "input_schema": {
    "type": "object",
    "properties": {
      "path": { "type": "string" }
    },
    "required": ["path"]
  }
}
```

然后补上 handler 的伪代码：

```text
validate path
check permission
read file
truncate if too large
return { content, truncated, bytes_read }
```

## Step 5：动手练习

给 `mini-agent` 增加工具系统，不需要写完整 Rust，可以先用任意语言或伪代码：

- `ToolSpec`
- `ToolRegistry`
- `ToolHandler`
- `ToolResult`
- `ToolError`

要求至少支持：

- `list_files`
- `read_file`
- `calculator`

## Codex 对照源码

- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/tools/router.rs`
- `codex-rs/core/src/tools/orchestrator.rs`
- `codex-rs/core/src/tools/handlers`
- `codex-rs/core/src/tools/runtimes`
- `codex-rs/core/src/tools/tool_dispatch_trace.rs`

## 推荐资料

- [OpenAI Agents SDK Tools](https://openai.github.io/openai-agents-python/tools/)
- [Anthropic Tool Use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/latest)

## 验收标准

你完成本课时，应该能回答：

- 工具 schema 和 handler 为什么必须解耦？
- 工具结果为什么要结构化，而不是只返回字符串？
- 工具失败时，应该让模型看到什么？
- 一个高风险工具进入系统前要经过哪些边界？
