# 主要 Tool 的关键设计

## 为什么按 Tool 单独分析

统一的 Contract、Registry 和 Runtime 解决共性问题，但不同 Tool 管理的资源不同。Shell 管理长生命周期进程，Patch 管理文件变更，MCP 管理外部连接和信任，控制类工具管理 Agent 状态机。设计时应先识别工具拥有的状态和副作用，再复用统一管线。

| Tool | 核心状态 | 主要风险 | 关键恢复机制 |
| --- | --- | --- | --- |
| Shell / Exec | Process、PTY、Output Buffer、Session ID | 任意命令、进程泄漏、环境变量和网络 | Interrupt、Terminate、Poll、进程树清理 |
| Apply Patch | Patch、目标文件、Diff | 越权写入、冲突、部分修改 | 预解析、路径审批、原子应用、Diff 验证 |
| MCP / App | Connection、Auth、Remote Tool Catalog | 外部副作用、数据泄露、Prompt Injection | Timeout、Approval、过滤、审计和结果截断 |
| Tool Search | Deferred Catalog、Search Result | Schema 膨胀、错误发现、名称冲突 | 分页、硬上限、稳定 Namespace |
| Ask User | Pending Request、Answer | 死等、问题歧义、状态错配 | Timeout、Cancel、`call_id` 关联 |
| Multi-Agent | Child、Message、Budget、Status | 失控并发、重复委派、失败传播 | 父子状态机、等待、取消、结果合并 |

## Shell / Unified Exec：命令工具也是进程管理器

Shell Tool 不应只建模成同步的 `run(command) -> text`。命令可能立即退出，也可能持续运行、要求交互、产生大量输出，或者在 Agent Turn 被取消后仍留在操作系统中。

Codex 将接口拆成两个工具：

```text
exec_command
    创建进程，等待一个 yield 窗口
    ├── 已退出：返回 exit code 和输出
    └── 仍运行：返回 session_id / process_id 和当前输出

write_stdin
    根据 session_id 找到已有进程
    ├── 写入字符
    ├── 空写入表示轮询
    └── 返回新增输出或最终退出状态
```

### Process Store

`codex-rs/core/src/unified_exec/mod.rs` 中的 `UnifiedExecProcessManager` 持有 `ProcessStore`。每个 `ProcessEntry` 不只保存进程句柄，还保存原始 `call_id`、进程 ID、工作目录、命令、TTY 标志、网络审批状态、所属 Session 弱引用和最后使用时间。

这使 Runtime 可以：

- 为后台进程分配稳定 ID；
- 让后续 `write_stdin` 续接原始命令；
- 把最终完成事件归到最初的 Tool Call；
- 清理过期或超过容量的进程；
- 列出、终止单个或终止全部后台终端。

进程数必须有硬上限。Codex 使用 `MAX_UNIFIED_EXEC_PROCESSES` 限制 Store，并根据存活状态和最后使用时间清理条目。

### 本地与远程进程统一

`codex-rs/core/src/unified_exec/process.rs` 的 `ProcessHandle` 同时封装本地 PTY Session 和 Exec Server 进程。上层通过统一的 `write`、`interrupt`、`terminate`、`exit_code` 和输出接口操作它们，不需要让模型区分进程运行在哪个操作系统。

### 输出与状态通道

进程输出同时服务于轮询、流式 UI 和最终 Tool Output。Codex 使用有界 Head/Tail Buffer 保存代表性输出，并用 Broadcast、Watch、Notify 和 CancellationToken 分别传递输出块、退出状态、等待通知和关闭信号。

这比一个不断增长的字符串更安全：长时间运行的构建或日志命令不会无限占用内存和模型上下文。模型侧输出还有独立 Token 上限，Telemetry Preview 的预算更小。

### 取消不是 Drop Future

取消 Tool Future 不能保证子进程退出。Unified Exec 必须向本地 PTY 或远端 Exec Server 发送 Interrupt/Terminate，关闭输出任务，并确认终态。Session 结束时还需要统一清理后台进程。

`write_stdin` 不重复触发原始命令的 PreToolUse，因为它只是已有执行会话的传输；但轮询观察到最终退出时，需要为原始命令补齐匹配的 PostToolUse。这是“Tool Call 生命周期”和“Process 生命周期”不完全重合的典型例子。

### Shell 安全边界

启动前还要处理工作目录、Shell 类型、登录 Shell、环境变量继承、Permission Profile、审批、Sandbox 和网络代理。对应主路径是：

```text
codex-rs/core/src/tools/handlers/unified_exec/exec_command.rs
    → UnifiedExecProcessManager
    → ToolOrchestrator
    → UnifiedExecRuntime
    → local PTY or remote Exec Server
```

## Apply Patch：把文件修改建模成可验证变更

Patch Tool 的重点不是“写字符串到文件”，而是把模型意图转换成一组可检查的文件变化。

Codex 的关键设计包括：

- 使用 Freeform Grammar，减少 Patch 文本的 JSON 转义；
- 在执行前解析并验证 Patch，而不是先运行再猜测影响范围；
- 从 Patch 得到目标文件集合，用于写权限和审批；
- 同时支持直接 `apply_patch` Tool，并拦截 Shell 中的 Patch 调用进入统一路径；
- 应用成功后更新 Turn Diff Tracker，使 UI、验证和最终总结看到净变更；
- 失败时返回上下文不匹配、路径越界或审批拒绝，而不是留下静默的部分结果。

先看 `codex-rs/core/src/tools/handlers/apply_patch_spec.rs` 的调用契约，再看 `codex-rs/core/src/tools/handlers/apply_patch.rs` 的 `ApplyPatchHandler` 和 `intercept_apply_patch`，最后看 `codex-rs/core/src/turn_diff_tracker.rs` 如何维护本轮净 Diff。

## MCP / App：外部工具适配与信任管理

MCP Handler 的职责不是重新实现外部业务，而是把不稳定的外部工具面适配到统一 Runtime：

```text
tools/list
  → Allowlist / Denylist
  → 名称清洗、Namespace 和冲突消解
  → ToolSpec + McpHandler
  → Annotation / Approval Decision
  → tools/call with Timeout
  → Result Truncation / Event / Context
```

关键设计是同时保留原始 Server/Tool 身份和模型可见名称。原始名称用于协议路由，规范化名称用于模型调用。`read_only_hint` 可以帮助并发规划，`destructive_hint` 和 `open_world_hint` 可以帮助审批，但这些 Annotation 只是外部声明，Host 仍要实施自己的策略。

连接与 Tool Timeout 位于 `codex-rs/codex-mcp/src/connection_manager.rs`，模型可见名称处理位于 `codex-rs/codex-mcp/src/tools.rs`，审批、Elicitation、调用事件和结果处理位于 `codex-rs/core/src/mcp_tool_call.rs`。

## Tool Search：工具目录也需要分页和预算

Tool Search 把大量工具从初始上下文移出。Deferred Tool 仍注册在 Runtime，但模型先看到搜索入口，搜索成功后才获得具体定义。

关键约束包括：搜索文本质量、结果数硬上限、稳定排序、Namespace 信息、重复结果消除，以及搜索输出本身的上下文预算。否则 Tool Search 只是把 Schema 膨胀推迟了一轮。

在 Codex 中，`codex-rs/core/src/tools/spec_plan.rs` 负责选择 Deferred Exposure，`codex-rs/core/src/tools/handlers/tool_search.rs` 负责搜索，`codex-rs/core/src/tools/context.rs` 中的 `ToolSearchOutput` 负责把发现结果作为可加载定义回写。

## Ask User：Tool Call 也可以暂停控制流

Ask User 不操作文件，却会使 Turn 等待外部输入。关键设计不是问题 Schema，而是 Pending Request 与响应的关联：

- 问题数量和选项必须有界；
- `call_id` 必须与用户回答配对；
- Turn Cancel 时等待必须解除；
- 没有回答时要明确是继续、超时还是保持等待；
- UI 回答不能误投递给另一个 Session 或 Turn。

Codex 对应实现位于 `codex-rs/core/src/tools/handlers/request_user_input.rs`，协议类型位于 `codex-rs/protocol/src/request_user_input.rs`。

## Multi-Agent：控制类 Tool 的状态机

Spawn、Message、Wait、Interrupt 和 List 不是五个孤立函数，而是共同操作父子 Agent 状态机。设计时需要统一：

- Child ID 和父子关系；
- 并发数、递归深度和预算上限；
- Context、权限和环境继承；
- Message 与 Follow-up 的投递语义；
- Wait 的超时和多个 Child 的聚合；
- Interrupt、失败和完成如何向父级传播；
- 多个 Agent 修改同一资源时如何避免冲突。

Codex v2 Handler 位于 `codex-rs/core/src/tools/handlers/multi_agents_v2.rs` 及其子模块。阅读时按 Spawn → Message → Wait → Interrupt → List 的状态变化顺序，而不是按文件名孤立阅读。

## 其他主要能力

- `view_image`：重点是本地文件边界、格式解码、大小限制和模型支持的细节级别。
- Web Search：Hosted 与本地 Extension 的执行边界不同，还要控制实时性、允许域名、引用和外部内容信任。
- Plan：更新显式进度状态，不应把计划仅保存在模型隐藏推理中。
- Plugin Install：安装会改变后续能力面，必须区分“建议安装”“用户批准”“实际安装完成”和新会话加载。

## 逐工具分析模板

以后分析任何新 Tool，都按同一组问题展开：

1. 模型看到什么 Contract，调用使用哪种编码？
2. Tool 拥有哪些跨调用状态，状态作用域是什么？
3. 执行发生在本地、远端、模型服务还是第三方？
4. 读取范围、写入副作用和认证身份是什么？
5. Approval、Sandbox、Network Policy 和 Hook 分别在哪里生效？
6. 并发、超时、取消和后台资源如何管理？
7. 输出如何流式展示、截断、脱敏并与 `call_id` 配对？
8. 重试前如何确认副作用，失败后如何恢复或补偿？
