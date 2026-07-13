# Tool Runtime

## 执行主链

Runtime 把模型协议中的 Tool Call 归一化，再交给具体执行器：

```text
Response Item
    ↓ parse
ToolCall { name, call_id, payload }
    ↓ route
Registry / Executor
    ↓ policy and runtime
ToolOutput
    ↓ adapt
Response Input Item
    ↓
Next Model Request
```

## 参数解析与语义验证

第一层解析识别 Function、Freeform 或 Tool Search，并保留 `call_id`。第二层由 Handler 将参数转换为具体类型。第三层再验证路径、资源状态、权限、互斥条件和业务不变量。

Codex 的第一层入口是 `codex-rs/core/src/tools/router.rs` 中的 `ToolRouter::build_tool_call`；统一 Payload 定义位于 `codex-rs/tools/src/tool_payload.rs`。读完这两个类型，再选择一个 Handler 看参数反序列化。

## 路由与执行

Registry 通过结构化 `ToolName` 找到执行器，并检查 Payload 类型是否匹配。找不到工具通常应生成模型可理解的失败结果；Registry 自身损坏、任务 Join 失败等内部问题才应升级为 Fatal。

Codex 使用 `ToolExecutor` 绑定 Spec 和 Handler，Core 再通过 `CoreToolRuntime` 增加 Hook、遥测、取消和参数改写能力。对应文件是 `codex-rs/tools/src/tool_executor.rs` 与 `codex-rs/core/src/tools/registry.rs`。

## 并发与互斥

模型能够一次生成多个 Tool Call，不代表它们都能安全并发。Runtime 应根据工具声明和资源冲突决定：

- 只读或明确并发安全的工具可以共享执行门；
- 写操作或未知工具默认串行；
- 对同一文件、进程、事务或远端资源可增加更细粒度锁；
- 并发取消时要避免产生重复终态。

Codex 的 `ToolCallRuntime` 位于 `codex-rs/core/src/tools/parallel.rs`。它用读写锁允许多个并发安全工具共存，同时让非并发工具独占执行。

## Timeout、Cancel、PTY 与后台进程

这些概念需要分开：

- Timeout：达到运行期限，由 Runtime 主动结束；
- Cancel：用户、上游 Turn 或系统请求停止；
- Yield：进程仍运行，但先返回当前输出和会话标识；
- PTY：为交互式程序提供终端语义；
- Background Session：调用结束后仍有可继续轮询或写入的进程状态。

取消 Future 不一定能杀死底层进程。Shell Runtime 必须清理进程树、PTY 和远端会话，必要时等待 teardown 完成后再返回 Aborted Output。

## 输出结构化与有界化

输出通常需要多种视图：

```text
Raw Output       → 调试或短期缓冲
Model Output     → 有界、结构化、带截断标记
User Display     → 流式进度和可读摘要
Telemetry Preview→ 更小且经过脱敏
```

Codex 的执行输出格式化在 `codex-rs/core/src/tools/mod.rs`，通用 Tool Output 适配在 `codex-rs/core/src/tools/context.rs`，进入历史后还会由 `codex-rs/core/src/context_manager/history.rs` 再次执行上下文预算控制。

## call_id 与上下文回写

每个 Tool Call 都必须得到一个对应 Output，即使结果是拒绝、超时或取消。Runtime 还要避免孤儿 Output、重复 Output 和错误的输出种类：

- Function Call 对应 Function Call Output；
- Custom Call 对应 Custom Tool Call Output；
- Tool Search Call 对应 Tool Search Output。

这是协议正确性要求，也是 Agent 能否从失败中恢复的基础。

## 错误、重试与幂等

建议至少区分：

- 参数或语义错误：返回模型，让它修改调用；
- Policy 拒绝：明确标记未执行；
- Sandbox 拒绝：按策略决定是否升级或请求批准；
- Timeout / Cancel：报告可能存在的部分副作用；
- 外部服务错误：根据状态码和幂等键判断是否重试；
- Runtime Fatal：终止当前执行链并保留诊断。

重试前必须判断动作是否发生过。创建订单、发消息、提交审批和写数据库不能仅凭“没有收到响应”就重新执行。

## Runtime 设计检查

1. 参数解析、业务验证和权限验证是否分层？
2. 并发能力由谁声明，默认是否保守？
3. Cancel 是否真正终止底层资源？
4. 每个输出是否有 Token、字节、行数或分页上限？
5. 所有调用是否都有且仅有一个终态 Output？
6. 重试是否具有幂等键、去重或副作用核对机制？
