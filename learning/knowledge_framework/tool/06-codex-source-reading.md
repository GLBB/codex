# Codex Tool 系统源码阅读路线

## 阅读目标

沿一条真实主链理解“定义如何进入模型、调用如何进入 Runtime、结果如何回到下一轮”，而不是逐个浏览 `handlers/` 目录。

```text
ToolSpec / ToolExecutor
    → spec_plan
    → Provider API Request / Stream
    → ToolRouter
    → ToolCallRuntime
    → ToolRegistry
    → Handler / Orchestrator
    → ToolOutput / History
```

## 第一站：共享抽象

从 `codex-rs/tools/src/lib.rs` 开始，只看它导出了哪些概念。随后依次打开：

1. `tool_spec.rs`：看 `ToolSpec` 支持哪些模型调用形态。
2. `responses_api.rs`：看 Function、Namespace 和 Freeform 的协议结构。
3. `tool_executor.rs`：看 Spec、Exposure、并发声明和 Handler 如何绑定。
4. `tool_payload.rs` 与 `tool_output.rs`：看 Runtime 输入输出的统一边界。

这一站结束时，应能画出 `ToolSpec`、`ToolExecutor`、`ToolPayload` 和 `ToolOutput` 的关系。先停在这里，不要跟进具体 Shell 实现。

## 第二站：构建工具表面

打开 `codex-rs/core/src/tools/spec_plan.rs`，从 `build_tool_router` 进入。依次阅读：

1. `build_tool_specs_and_registry` 如何收集上下文；
2. `add_tool_sources` 如何聚合 Core、MCP、Extension、Dynamic 和 Hosted 来源；
3. `append_tool_search_executor` 如何为 Deferred 工具建立发现入口；
4. `build_model_visible_specs_and_registry` 如何拆出模型可见 Specs 和 Runtime Registry；
5. `merge_into_namespaces` 如何合并 Namespace。

读到这里应回答：为什么一个 Runtime 已注册的工具可能不出现在模型请求中。

## 第三站：解析与调度

在进入 Runtime 前，先用 [Model Provider API 与 Tool 协议](08-provider-api-protocol.md) 对照 `codex-rs/core/src/client.rs` 的 `build_responses_request`，确认模型看到的 Specs 如何进入 `tools`，以及 Function Call 如何从 Provider Stream 返回。这里重点是协议映射，不必展开 HTTP Transport。

打开 `codex-rs/core/src/tools/router.rs`，阅读 `ToolRouter::build_tool_call`，观察 Function、Custom 和 Tool Search 如何归一成 `ToolCall`。

然后打开 `codex-rs/core/src/tools/parallel.rs`，阅读 `ToolCallRuntime::handle_tool_call_with_source`。重点是：

- 从哪里查询并发能力；
- 读写锁如何形成共享与独占执行门；
- CancellationToken 如何竞争执行结果；
- 哪些 Runtime 需要等待取消清理；
- Recoverable Error 如何变成失败 Output。

## 第四站：统一 Registry 管线

打开 `codex-rs/core/src/tools/registry.rs`，从 `dispatch_any_with_terminal_outcome` 顺序向下读：

```text
lookup
→ payload compatibility
→ start notification
→ pre hook
→ executor handle
→ telemetry
→ post hook
→ finish notification
→ AnyToolResult
```

注意 `FunctionCallError::RespondToModel` 与 `Fatal` 的边界，以及 Post Hook 阻断的是结果还是已经发生的副作用。

## 第五站：选择两种具体工具

先读 `codex-rs/core/src/tools/handlers/apply_patch.rs`，理解 Freeform 输入、文件范围、审批和 Diff 跟踪。再读 `handlers/mcp.rs`，理解外部 Tool Definition 如何适配到统一 Executor。

不要一开始阅读所有 Handler。完成这两个对照后，再按兴趣选择：

- Shell：`handlers/unified_exec.rs`、`runtimes/unified_exec.rs`、`unified_exec/`；
- Ask User：`handlers/request_user_input.rs`；
- Multi-Agent：`handlers/multi_agents_v2.rs` 及其子模块；
- MCP Resources：`handlers/mcp_resource.rs` 及其子模块。

## 第六站：审批、Sandbox 与输出

对于 Shell 和 Patch，打开 `codex-rs/core/src/tools/orchestrator.rs`，沿 `ToolOrchestrator::run` 阅读审批需求、Sandbox 选择、第一次执行和拒绝后的处理。审批解析在 `codex-rs/core/src/tools/approvals.rs`，共享策略类型在 `codex-rs/core/src/tools/sandboxing.rs`。

最后打开：

1. `codex-rs/core/src/tools/context.rs`：结果如何变成 Response Input Item；
2. `codex-rs/core/src/tools/mod.rs`：执行输出如何格式化和截断；
3. `codex-rs/core/src/context_manager/history.rs`：结果进入历史后如何再次有界化和规范化。

## MCP 专线

理解统一主链后，再进入：

1. `codex-rs/codex-mcp/src/tools.rs` 的 `ToolInfo` 和名称规范化；
2. `codex-rs/codex-mcp/src/connection_manager.rs` 的连接、工具列表和 `call_tool`；
3. `codex-rs/core/src/mcp_tool_call.rs` 的审批、调用事件、结果截断和 Elicitation。

这样可以避免把 MCP 误解为一套独立 Agent Loop；它最终仍适配到 Codex 的 Tool Router、Registry 和 Output 管线。

## 跟读练习

### 练习一：追踪 `apply_patch`

从 Spec 开始，写出它如何被加入工具表面、模型用什么 Payload 调用、Handler 如何验证、何时审批、结果如何变成 Custom Tool Output。

### 练习二：追踪只读 MCP Tool

从 `ToolInfo` 开始，解释名称如何生成、Annotation 如何影响并发和审批、Tool Timeout 在哪里生效、结果如何截断。

### 练习三：解释取消

构造一个仍在运行的 Shell 调用，说明用户取消 Turn 后 Future、底层进程、终态事件和模型可见 Output 分别发生什么。

## 验收问题

1. Spec、Executor、Registry 和 Router 各自拥有哪一部分职责？
2. Tool Exposure 为什么不是简单布尔值？
3. Hosted Tool 为什么可能没有本地 Handler？
4. MCP 原始名称与模型可见名称为什么要同时保留？
5. PostToolUse 阻断为什么不能撤销已经发生的外部副作用？
6. Output 为什么在 Handler 和 History 两处都需要预算控制？
