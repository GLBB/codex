# 14 Hooks：在生命周期中自动化，但不创造后门

## 为什么不能把自动化都写进 Agent Prompt

团队要求“每次运行 shell 前检查公司策略，完成工具后记录审计摘要”。把这句话写进 prompt
不可靠：模型可能忘记、上下文可能压缩、外部内容还可能诱导它跳过。

Hook 把自动化放在运行时的确定生命周期点：事件发生时，系统选择 handler、运行命令、
解析结构化结果，再决定继续、阻止或注入上下文。

```text
Lifecycle Event
  -> trusted Hook Discovery
  -> matcher
  -> command with JSON stdin
  -> structured stdout / status
  -> runtime decision + trace
```

Hook 比 prompt 更确定，但仍不能越过 permission、sandbox 和 managed policy。

## 11 个事件是一张生命周期地图

| 阶段 | Events | 可以解决的问题 |
| --- | --- | --- |
| Thread 起止 | SessionStart、SessionEnd | 启动上下文、清理、通知 |
| 用户输入 | UserPromptSubmit | 补充上下文、阻止不合规输入继续 |
| 工具前后 | PreToolUse、PermissionRequest、PostToolUse | 输入检查、审批决策、审计反馈 |
| 压缩 | PreCompact、PostCompact | 在有损历史变化前后执行治理 |
| Agent 停止 | Stop | 接受完成或要求继续 |
| 子 Agent | SubagentStart、SubagentStop | child 上下文与停止检查 |

事件共享通用 wire shape，不代表能力完全相同。`SubagentStart` 可以注入 child context，但
不会因为 `continue:false` 阻止 child 启动；主 `SessionStart` 则可以停止启动流程。每种
语义要由具体 event contract 决定。

## PreToolUse：改参数之后仍要重新安检

Hook 收到稳定输入：session/turn、tool name、tool input、cwd、model、permission mode。它可以
阻止调用、给出 permission decision，或返回 updated input。

例如把：

```json
{"command": "pytest"}
```

改成限定测试：

```json
{"command": "pytest tests/auth"}
```

更新后的参数必须重新进入 schema validation、permission、approval 和 sandbox。Hook 不是
“可信 handler 的内部调用”，不能借 input rewrite 绕过正常工具链。

## PermissionRequest：参与审批，不扩张权限

当正常工具流程需要审批时，Hook 可以 allow、deny 或不作决定。例如公司 managed hook
拒绝向未知域名上传，而个人 hook 对只读命令选择不表态。

当前预留的 updated permissions、updated input 和 interrupt 能力尚未实现；若输出这些
字段，系统应 fail closed。对安全协议来说，“忽略不认识字段然后继续”会把版本不匹配变成
放行漏洞。

即使 Hook 返回 allow，permission profile 和 sandbox 仍是上界。它只能影响审批步骤，不能
给进程凭空增加文件或网络能力。

## PostToolUse：影响未来，不能改写过去

Post hook 在工具已经产生成功结果后运行。它可以生成审计反馈、附加下一轮上下文或停止
后续 loop，但不能把已发生的写入说成“没有执行”。

Handler 应主动提供稳定、经过治理的 tool input/response，不把任意内部对象和无限 stdout
交给脚本。审计记录要区分工具事实与 Hook 评论。

## Stop Hook：完成也可以被要求继续

模型给出 final answer 后，Stop hook 可以接受停止，或返回 continuation prompt，例如：

```text
测试结果缺失，请运行相关测试后再结束。
```

Agent 会再次 sampling。这很强大，也容易无限循环。需要记录 stop hook 是否已活跃、每次
continuation 原因、最大继续次数和最终 terminal status。SubagentStop 类似，但目标和
transcript 属于 child。

## Compact Hook：在有损边界保持不变量

PreCompact 可以在压缩前阻止或记录关键事实，PostCompact 可以检查结果和提供反馈。Hook
不能假设原历史永久存在；真正需要保留的内容应成为明确的持久化 item、memory 或有界
context fragment，而不是藏在一次脚本 stdout 中。

## Trust 与来源：谁允许执行这段脚本

Hooks 可能来自 system、MDM、cloud requirements、user、project、session flags 或 Plugin。
来源和路径必须进入配置与 trace。项目 hook 属于可执行仓库内容：未 trusted 项目的配置层
应禁用；已信任脚本修改后，trusted hash 也应失效。

Plugin hook 进入同一个 discovery/registry 与 policy 合并流程，不能因为“来自 Plugin”就
建立另一条无审计执行通道。

## Command Runner 的现实边界

当前可用的是同步 command hooks：JSON 从 stdin 进入，stdout/stderr 被解析，handler 有
timeout，匹配的 handlers 可并发运行，但结果按配置顺序聚合。

跨平台时可以提供 `commandWindows`；否则使用目标系统 shell。配置为 async 的非
SessionEnd hook 当前会被跳过，async SessionEnd 也仍同步运行并告警。Protocol 中存在
Async、Prompt、Agent 类型，不代表 runtime 已完整支持。

模型可见 additional context 默认以约 2,500 tokens 为 spill 阈值：超出后完整输出保存到
受控临时文件，模型只收到有界 preview 和恢复路径。把阈值设为 0 会禁用 spilling，应被
当成显式风险选择。

## 动手实验：三类 Hook 串成一条治理链

实现：

```text
PreToolUse:
  检查 shell command
  危险或范围不明 -> deny + reason

PermissionRequest:
  只读且 cwd 在 workspace -> allow
  其他 -> no decision

PostToolUse:
  生成有界审计摘要
  不修改原始工具结果
```

写六个 replay cases：正常、block、invalid JSON、timeout、oversized additional context、
试图通过 updated permissions 提权。断言不仅看 Hook status，还要确认工具是否执行、模型
看到什么、trace 是否记录 source 与 duration。

再加一个 Stop hook，故意连续要求继续，验证 loop budget 能终止它。

## 常见误区

- Hook 是事件监听，不会改变流程。部分 Hook 明确可以 block、rewrite 或 continue。
- Hook 脚本来自项目，所以天然可信。项目配置本身需要 trust。
- PreToolUse 改过参数后可以直接执行。必须重新走正常校验。
- PostToolUse 能撤销工具事实。它只能影响后续流程。
- 配置写了 async 就异步。当前实现有明确限制。

## 理解之后再对照 Codex

事件配置与 11 个名称在 `config/src/hook_config.rs` 和 `protocol/src/protocol.rs`。Discovery、
并发调度、command runner 和输出解析位于 `hooks/src/engine`；每种语义在
`hooks/src/events`，wire schema 在 `hooks/src/schema.rs`，spill 在
`hooks/src/output_spill.rs`。

Core 接线位于 `core/src/hook_runtime.rs`，模型可见附加上下文在
`core/src/context/hook_additional_context.rs`，App Server hook payload 在
`app-server-protocol/src/protocol/v2/hook.rs`。

用六个 replay cases 反查实现即可，不要先把所有 event 文件通读一遍。

## 本课验收

你应该能：

1. 把 11 个 events 放到 Agent 生命周期中，并说明主要作用。
2. 解释 Pre、Permission、Post Tool Hook 分别能改变什么、不能改变什么。
3. 设计 trust、timeout、跨平台和 output spill 策略。
4. 说明当前 async/prompt/agent handler 的实现边界，避免把 schema 当功能承诺。
