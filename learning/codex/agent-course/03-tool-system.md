# 03 Tool System：把模型的动作建议变成可靠结果

## 工具不是一个普通函数

对业务代码来说，`read_file(path)` 只是函数；对 Agent 来说，它同时跨越多个边界：模型要
理解它、协议要表达它、runtime 要找到实现、安全层要约束动作、结果要进入历史，用户还要
看到可信进度。

因此，工具系统并不是一条简单的函数调用链，而是两条相互关联的路径。

工具控制面决定本次模型能看到什么：

```text
Core / MCP / Extension / Dynamic tools
  -> Registry
  -> exposure、模式、配置和冲突策略
  -> model-visible specs
  -> Prompt
```

工具执行面决定模型提出动作后发生什么：

```text
completed model item
  -> ToolCall
  -> readiness + concurrency admission
  -> lifecycle / hooks
  -> executor
  -> ToolOutput projections
  -> history
  -> 下一次模型请求
```

这两条路径不能混在一起。工具已经注册，不代表本轮模型能看到；模型看到了一个 hosted
tool，也不代表本地一定有 handler。

## 一份完整工具契约包含什么

先用教学工具 `read_file` 建立直觉。模型可见的 spec 可以是：

```json
{
  "name": "read_file",
  "description": "Read a UTF-8 text file inside the workspace.",
  "parameters": {
    "type": "object",
    "properties": {
      "path": {"type": "string", "description": "Workspace-relative path"},
      "max_bytes": {"type": "integer", "description": "Maximum bytes to return"}
    },
    "required": ["path"],
    "additionalProperties": false
  }
}
```

但 schema 只是契约的一部分。一个生产工具至少要回答：

| 部分 | 要回答的问题 |
| --- | --- |
| Identity | canonical name 和 namespace 是什么？ |
| Spec | 模型何时应该选它，参数怎样生成？ |
| Payload | function JSON 还是 freeform input？ |
| Invocation | 本次调用属于哪个 turn、environment 和 call id？ |
| Executor | 谁把协议转换成真实动作？ |
| Policy | 哪些参数合法，动作是否被授权？ |
| Output | 模型、UI、Hook 和 trace 分别看到什么？ |
| Lifecycle | 能否并行、怎样取消、何时算完成？ |

名称和 description 不是装饰。它们会影响模型选工具；含糊的说明会让正确 handler 永远没有
机会执行。反过来，说明只能指导模型，不能成为安全策略。

## Schema 帮助生成，不替代运行时校验

模型生成的参数是不可信输入，与 HTTP 请求体没有本质区别。Handler 应按层处理：

```text
parse JSON
  -> deserialize into typed arguments
  -> semantic validation
  -> resolve environment / path / target
  -> permission and policy checks
  -> execute with resource limits
```

这几层解决的问题不同：

- schema 告诉模型参数形状，并可能由模型服务做约束；
- deserialization 拒绝类型不匹配或缺少必填字段；
- semantic validation 检查范围、字段组合和业务不变量；
- permission 判断格式正确的动作是否被授权；
- sandbox 限制进程实际能触碰的资源。

不要假设任何 JSON Schema 关键字都会在 runtime 自动执行，也不要假设所有参数类型都会
拒绝未知字段。外部 MCP 或 Dynamic tool schema 还可能为了兼容 Responses API 和上下文
预算而被规范化、裁剪或压缩。`max_bytes` 的实际硬上限必须由 handler 守住。

Hook 如果重写参数，也必须重新进入解析、语义校验和权限链；“原参数已经检查过”不能覆盖
新参数。

## ToolSpec 不只有 JSON Function

工具系统要支持不同 wire shape，而不是强迫所有能力伪装成 JSON function：

| Spec | 输入形态 | 适合场景 |
| --- | --- | --- |
| Function | JSON arguments | 普通结构化工具 |
| Freeform / Custom | 自定义文本语法 | `apply_patch`、代码或 DSL |
| Namespace | 一组 function/custom tools | Connector、协作工具、领域工具 |
| Tool Search | 搜索参数 | 按需发现 deferred tools |
| Hosted tool | provider 定义 | 服务端 Web Search 等能力 |

相应地，模型输出也不是一种 item：

```text
FunctionCall -> ToolPayload::Function -> FunctionCallOutput
CustomToolCall -> ToolPayload::Custom -> CustomToolCallOutput
client ToolSearchCall -> ToolPayload::ToolSearch -> ToolSearchOutput
hosted call -> provider 处理，不进入本地 executor
```

因此 Registry 查到同名 runtime 后还要检查 payload kind 是否兼容。Function payload 被交给
只接受 freeform input 的 runtime，通常说明系统协议不变量已经损坏，而不只是用户参数错了。

## Spec 与实现要职责清楚、保持同源

可以用餐厅类比理解角色：

- Spec 是模型看到的菜单说明。
- Registry 保存 canonical tool identity、executor 和本轮 exposure。
- Router 把完整 model item 转成 ToolCall，并按 identity 找 runtime。
- Handler 把 Agent 协议转换成工具请求。
- 底层 runtime 接触文件、进程或远程服务。
- ToolOutput 把执行事实投影回 Agent 协议。

这些是逻辑职责，不意味着代码中必须把 spec 和 handler 分开存放。当前 Codex 的
`ToolExecutor` 刻意让一个 runtime 同时提供 `tool_name`、`spec`、`exposure`、并发声明和
`handle`，避免菜单已经改名、厨房仍只认识旧名字。

真正适合替换的是 handler 下面的执行后端。例如 shell handler 可以保持模型协议稳定，
内部选择本地 PTY 或 remote exec-server；MCP handler 则把调用转发给不同 server。

## Registry 是本次 Step 的能力快照

工具集合不是进程启动时构建一次后永久不变。当前模型、feature、协作模式、目标
environment、MCP catalog、Plugin、Dynamic tools 和 Tool Search 命中都可能影响本次
sampling step。

```text
Session services + TurnContext + environments + MCP binding + extensions
  -> build registry
  -> apply exposure and mode policy
  -> detect collisions
  -> merge namespaces
  -> freeze ToolRouter for this step
```

工具调用可能在 model stream 后半段才执行，因此执行时必须保留“当初展示这份 spec 的
StepContext”，不能悄悄换成下一 step 的 registry。否则模型按旧参数调用，runtime 却按新
定义解释，形成难以复现的竞态。

Registry 中还可能包含 Hidden 或 Deferred runtime。已注册只说明系统知道怎样 dispatch，
不说明 spec 已进入首轮 Prompt。Exposure 与 `tool_search` 的完整机制在
[第 13 课](13-tool-discovery-apps-connectors.md)展开。

## ToolName 与 collision 是协议问题

外部系统很容易都提供 `search`、`get`、`create`。工具身份应由 namespace 和 name 共同
组成：

```text
calendar / search
drive / search
functions / exec_command
```

默认 namespace 要规范化后再比较。扁平字符串只应出现在仍要求旧格式的 hook、遥测或 wire
边界，不能作为内部主键。

冲突处理也应区分来源：

- 内置 trusted tool 重复通常是编程错误；
- external tool 与已有能力冲突时，可以跳过并记录诊断；
- 保留名称不能被外部 runtime 抢占；
- 同 namespace 的说明如果互相矛盾，也属于模型可见协议冲突；
- 严格配置可以把记录到的 collision 升级为 step 构建失败。

“后注册者随机覆盖前注册者”会让同一个 Prompt 在不同启动顺序下执行不同代码，是最差的
选择。

## 只有完整 item 才能产生副作用

模型响应通常是流。系统可能先收到工具 item、参数 diff，最后才收到 item done。参数增量
可以驱动 UI，例如提前展示 `apply_patch` 将修改哪些文件，但不能看到半段 JSON 就开始
执行。

完整 item 到达后，runtime 才：

1. 记录模型确实提出了该调用；
2. 用 `call_id`、namespace、payload 构建 ToolCall；
3. 创建子 cancellation token；
4. 把 future 放入当前 step 的 in-flight 队列；
5. 标记完成后需要下一次模型请求。

先持久化调用 item、再开始动作也很重要。即使执行时进程崩溃，仍能回答“模型尝试调用了
什么”，而不是只留下一个来源不明的错误。

## ToolInvocation 是真实的 handler 输入

Handler 不只需要业务参数。一次调用通常还携带：

```text
ToolInvocation {
  session,
  turn / step context,
  call_id,
  canonical tool name,
  call source,
  payload,
  cancellation token,
  turn diff tracker
}
```

调用来源也会改变处理方式。直接模型调用、Code Mode 中的 nested call 和某些受保护的明文
消息可能共享 executor，却需要不同 trace、参数预览或防泄漏策略。

Environment 也不能退化成一个本机 cwd 字符串。Handler 应从 step snapshot 选择目标
environment，再让该 environment 解释 shell、PathUri、文件系统和 sandbox 能力。

## 通用 Dispatch 生命周期

找到 runtime 以后，通用层可以统一处理横切能力：

```text
account active tool call
  -> start dispatch trace
  -> resolve runtime and verify payload kind
  -> emit tool start
  -> run PreToolUse hook; optionally block or rewrite
  -> execute handler with telemetry
  -> optionally run PostToolUse hook
  -> emit exactly one finish/abort outcome
  -> convert ToolOutput for the caller
```

PostToolUse 发生时，真实动作可能已经完成。它可以阻止原结果进入模型或增加反馈，但不能把
已写入的文件说成“没有修改”。详细 Hook 语义在
[第 14 课](14-hooks-lifecycle-automation.md)。

并不是所有工具都会进入 approval/sandbox orchestrator。通用 dispatch 适用于 MCP、用户
输入、Tool Search 等所有 runtime；`ToolOrchestrator` 则服务于 shell、patch 等可审批、可
sandbox 的执行请求，负责 approval、sandbox selection 和受控升级重试。详细安全决策在
[第 5 课](05-sandbox-permission.md)。

## 错误需要区分“模型可恢复”和“系统坏了”

一个实用的最小分类：

| 类型 | 例子 | 后续行为 |
| --- | --- | --- |
| Respond to model | 参数解析失败、未知工具、权限拒绝 | 生成失败 tool output，让模型改方案 |
| Fatal | payload/runtime 不匹配、tool task join 失败 | 终止当前 turn |
| Business failure | 命令 exit 1、MCP `isError` | handler 完成协议，结果标记失败 |
| Cancelled/Blocked | 用户取消、PreToolUse 阻止 | 不再开始或继续副作用，反馈明确状态 |

Rust future 返回 `Ok(ToolOutput)` 不等于业务动作成功；它只说明 handler 正常完成协议。相反，
可恢复错误不应直接变成整个 Session 崩溃。

错误信息应提供下一步所需证据，同时限制 secret、绝对系统路径和无限 stderr。还要记录
`handler_executed` 或等价事实，因为“执行前被拒绝”和“执行后结果失败”的恢复策略不同。

## 一个结果会生成多个投影

“Tool Result”不是一个到处复用的 JSON 对象：

```text
raw runtime result
  ├── ResponseInputItem -> 下一次模型请求
  ├── code_mode_result -> nested script
  ├── hook response -> PostToolUse
  ├── lifecycle events -> UI / persistence
  └── log preview -> telemetry
```

不同消费者有不同安全和容量边界：

- 模型结果必须有 token/byte 上限和明确 truncation marker；
- telemetry preview 应比模型预算更小，不能复制全部输出；
- UI 可以流式显示，但事件大小和数量仍要有界；
- MCP `_meta` 等私有字段不能误入 Code Mode；
- 文本、图片和音频结果要保持模态信息；
- 外部内容应被标记，必要时阻止它污染长期 memory。

结构化结果的教学示例可以是：

```json
{
  "path": "README.md",
  "content": "...",
  "bytes_read": 12000,
  "truncated": true
}
```

但不要强迫每种工具都使用 `{ok, error}`。Responses function output、custom output、MCP
result 和 Tool Search output 各有自己的 wire contract，通用层只需保证关联、成功语义和
容量治理一致。

## 并行有模型层和 Runtime 层

系统通常先告诉模型是否允许在一次响应中产生多个 tool calls，再由每个 executor 声明自己
是否支持并行。Runtime 可以使用读写 gate：

```text
parallel tool -> read lock，可以和其他 parallel tool 重叠
serial tool -> write lock，与当前其他 tool calls 互斥
```

这只是 admission control，不是依赖分析器。下面两次读取通常可以并行：

```text
read_file("README.md")
read_file("Cargo.toml")
```

下面两步仍应由模型分成前后两轮：

```text
apply_patch("src/lib.rs")
run_tests()
```

即使 shell runtime 声明能并发处理多个进程，也不表示任意两条 shell 命令没有文件或端口
竞争。工具能力说明“实现不会因并发调用损坏自身”，任务依赖说明“这些动作是否应该同时
发生”，两者不能互相替代。

## 取消是一个协议，不是一次 `abort`

工具可能正处于不同阶段：

```text
等待 MCP readiness
  -> 等待并发 gate
  -> handler 执行
  -> runtime teardown
  -> terminal lifecycle event
```

取消发生在执行前，可以直接阻止 handler；发生在执行中，则要由 runtime 决定能否立即
abort，还是必须等待它杀掉子进程、关闭远端请求或完成清理。通用层还要避免正常完成和
取消分支各发一次 terminal event。

长 shell 进程尤其说明了这个边界：停止等待工具 future，不等于操作系统进程已经结束；
一个进程还可能被 ProcessManager 保留，供后续 `write_stdin` 轮询。完整设计在
[第 15 课](15-shell-process-lifecycle.md)。

## 比较几种 Runtime 拓扑

| 工具 | 动作发生在哪里 | 主要等待对象 | 特有边界 |
| --- | --- | --- | --- |
| 本地文件工具 | Agent 进程或目标 filesystem | 文件 I/O | PathUri、大小、编码 |
| Shell | 本地或 exec-server | 进程、PTY、输出 | 审批、进程树、长任务 |
| MCP | 外部 server | readiness、RPC | 身份、远端错误、返回污染 |
| Dynamic tool | App Server client | oneshot 回传 | 客户端断开、pending call |
| request_user_input | 人 | 用户响应 | 模式限制、取消、turn 暂停 |
| Hosted tool | 模型服务端 | provider events | 本地没有 handler |

统一 ToolExecutor 并不要求它们共享粗糙的安全假设，而是让调用关联、错误、取消和结果回填
保持一致。

## 动手实验：构建最小工具层

给上一课的 fake agent 实现：

```text
ToolName { namespace, name }
ToolSpec = Function | Freeform | Hosted
ToolPayload = Function | Custom
ToolExecutor
ToolRegistry
ToolInvocation
ToolOutput
ToolError = RespondToModel | Fatal
```

加入 `list_files`、`read_file`、`calculator` 和一个没有本地 handler 的 hosted tool。至少
完成这些回放：

1. 合法 function 调用进入正确 executor。
2. 缺少参数和范围错误都回填模型，但错误类型不同。
3. function payload 调用 freeform runtime 被判为协议错误。
4. 同名不同 namespace 可以共存，同 namespace collision 可诊断。
5. hosted spec 能进入 Prompt，却不在本地 Registry dispatch。
6. 两个 parallel 工具重叠执行，serial 工具形成屏障。
7. 取消发生在 gate 前、handler 中和 teardown 时，各只有一个 terminal outcome。
8. 大结果对模型和 telemetry 使用不同上限。
9. registry 在下一 step 改变后，旧调用仍使用原 StepContext。
10. handler 返回业务失败后，Agent Loop仍能发起下一次模型请求。

不要只断言返回字符串。测试整个 ToolCall、ResponseInputItem、事件序列和 executor 是否真的
执行，才能发现协议与副作用不一致。

## 常见误区

- 工具出现在 Prompt 就一定有本地 handler。Hosted tool 是反例。
- Spec 与 handler 完全分离更灵活。失去同源约束容易产生协议漂移。
- Schema 写了范围，handler 就不用检查。模型约束不是执行权限和业务校验。
- 工具已注册就必须首轮可见。Registry、exposure 和 model-visible specs 是不同状态。
- 收到参数 diff 就可以提前执行。只能在完整 item 后产生副作用。
- Handler 返回 `Ok` 就代表业务成功。还要看 ToolOutput 的成功语义。
- 一个结果对象可以直接用于模型、UI 和日志。它们有不同容量与隐私边界。
- Runtime 支持并发就能并行所有调用。任务的数据依赖仍要保持顺序。
- Abort future 就完成了取消。外部进程和远程请求需要明确 teardown。

## 理解之后再对照 Codex

第一次阅读只追工具控制面。从 `tools/src/tool_executor.rs` 的 `ToolExecutor` 看 spec 与 runtime
怎样保持同源，再到 `core/src/tools/spec_plan.rs` 的 `build_tool_router` 和
`finalize_tool_router`，观察 core、MCP、extension 和 dynamic sources 怎样形成当前 step 的
Registry 与 model-visible specs。读到 `ToolRouter::from_parts` 即可停止。

第二次追执行面。从 `core/src/stream_events_utils.rs` 的 `handle_output_item_done` 看完整 item
怎样进入 in-flight future，再到 `core/src/tools/router.rs` 的 `build_tool_call`，最后阅读
`registry.rs` 的 `dispatch_any_with_terminal_outcome`。只标出 runtime lookup、Pre/Post Hook、
错误和 ToolOutput 转换，不展开某个具体 handler。

第三次比较四种边界：shell handler 怎样委托 process runtime，MCP handler 怎样等待 server，
Dynamic tool 怎样等待客户端响应，`request_user_input` 怎样等待人。并发与取消单独看
`core/src/tools/parallel.rs`；沙箱执行看第 5 课；长进程管理看第 15 课。

## 本课验收

你应该能：

1. 画出工具控制面和执行面，并说明它们为何不能合并。
2. 解释 ToolSpec、ToolPayload、ToolInvocation、ToolOutput 和 executor 的边界。
3. 说明 schema、semantic validation、permission 和 sandbox 分别保证什么。
4. 区分 model-visible spec、Registry runtime、hosted tool 和 deferred tool。
5. 设计可恢复错误、Fatal 错误和业务失败的不同处理路径。
6. 说明输出为何要分别投影给模型、UI、Hook、Code Mode 和 telemetry。
7. 判断两个调用在模型依赖和 runtime admission 两个层面能否并行。
8. 解释取消为何必须包含 readiness、handler 和 teardown 的终局语义。
