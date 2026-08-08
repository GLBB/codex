# 07 从 Demo 到生产：委派、审查、可观测与评测

## “能跑一次”为什么离生产还很远

教学 Agent 在 happy path 上完成一次任务就算成功；生产 Agent 要在输入含糊、工具失败、
权限拒绝、上下文过长和系统升级后仍可理解、可恢复。为此需要四种能力：

- 委派：把真正独立的工作交给子 Agent。
- 审查：对代码质量或危险动作做独立判断。
- 可观测：重建一次任务发生了什么。
- 评测：用可重复样例阻止行为退化。

它们不是四个装饰模块，而是生产闭环：运行产生 trace，trace 变成 regression case，
评测发现退化，审查和运行策略再被改进。

## 委派：什么时候子 Agent 值得存在

把任务拆给子 Agent 的价值通常来自三点：并行、上下文隔离、角色验收。例如分析一个 PR：

```text
父 Agent：理解用户目标并整合结果
  ├─ worker A：检查业务逻辑
  ├─ worker B：检查测试覆盖
  └─ worker C：检查协议兼容性
```

若三项互相独立，父 Agent 可以继续本地工作并稍后汇总。若下一步立刻依赖 A 的结果，
spawn 再 wait 只会增加延迟；这时父 Agent 自己做更合理。

委派必须给出有边界的契约：任务、可见上下文、允许工具、期望输出和停止条件。共享工作区
下还要划分不重叠 write set，避免两个 worker 同时编辑同一文件。

第 12 课会详细解释 `send_message`、`followup_task`、mailbox、steer 和 interrupt；本课先
记住：多 Agent 是有成本的并发执行单元，不是角色扮演聊天室。

## 审查：代码 Review 与安全 Guardian 不同

两者都使用“另一个模型检查”，但目标不同：

| 审查 | 输入 | 产出 | 权限倾向 |
| --- | --- | --- | --- |
| Code review | diff、需求、测试 | 按严重性排序的 findings | 只读 |
| Approval Guardian | 用户授权、动作、环境证据 | allow/deny 与风险理由 | 更严格只读 |

Reviewer 不能只继承执行 Agent 的结论，否则会形成确认偏误。它需要明确标准、必要证据和
独立上下文。Guardian 更要把 transcript 与外部内容当不可信证据，失败时保守拒绝。

Reflection 也不是“再问一次模型”。有效审查必须改变信息或标准：提供测试结果、diff、
风险 policy 或独立视角，否则只是花两倍 token 重复同一偏见。

## 可观测：Trace 要能回答因果问题

只记录最终回答无法解释为什么错。一次 turn 的 trace 至少关联：

```text
thread_id / turn_id
  -> model request version、输入大小、延迟
  -> model output items
  -> tool name/namespace、call_id、参数摘要
  -> permission/approval/guardian decision
  -> tool result、截断、耗时
  -> retry/compact/cancel
  -> final status 与 token usage
```

日志、metrics、trace 各有分工：日志解释单个事件，metrics 看总体趋势，trace 连接一条请求
的因果链。敏感输入和工具结果不能因为“排障方便”就无界进入 telemetry；要做脱敏、采样、
访问控制和保留周期。

## 评测：不要只问“最终答案像不像”

Agent 行为包含决策和副作用，评测应分层：

| 维度 | 示例指标 |
| --- | --- |
| 任务结果 | 测试通过、文件正确修改 |
| 工具选择 | 是否选对工具、参数是否有效 |
| 过程效率 | 模型轮数、token、工具耗时 |
| 安全 | 危险动作是否被拒绝或审批 |
| Grounding | 回答是否基于工具/RAG 证据 |
| 恢复能力 | 工具失败、取消、超限后能否合理结束 |

线上 trace 可以脱敏后转成 replay case；但 replay 不能只固定模型文本，而应断言稳定行为：
调用了哪个工具、是否执行副作用、最终状态和关键结果。模型措辞轻微变化不应让测试全部
变红。

## 从一次事故建立闭环

事故：用户让 Agent 读取配置，Agent 却重复调用 shell 五次，最后超时。

```text
Trace：发现同一参数重复调用
  -> Root cause：工具错误没有进入模型可见结果
  -> Fix：结构化返回 permission_denied
  -> Regression：fake SSE + tool result replay
  -> Eval：断言最多一次失败调用，并给出替代方案
  -> Metric：重复 tool-call rate
```

生产改进不是“调 prompt 看起来好了”，而是从证据到修复、回放和长期指标的闭环。

## 动手实验：建立第一套回放集

给 `mini-codex-agent` 增加六个场景：

1. 正常读取文件并总结。
2. 工具返回结构化错误，模型解释并换方案。
3. 权限拒绝，确认没有执行副作用。
4. 上下文过长，触发 compact 并保留关键约束。
5. 模型重复相同调用，loop budget 终止。
6. Guardian 超时，本次危险动作 fail closed。

每个 case 保存输入、fake model event、预期工具行为、预期 terminal status 和关键 trace
字段。然后故意删掉工具错误回填，确认第 2、5 个 case 能抓到回归。

## 常见误区

- 多 Agent 一定更强。拆分成本和信息损失可能超过收益。
- Reviewer 给出“LGTM”就代表审查完成。审查要有标准和证据。
- 有日志就可观测。没有稳定关联 ID，日志无法形成因果链。
- Eval 只比较最终文本。副作用和安全决策更重要。
- 把线上所有原始输入永久保存。可观测也必须遵守数据治理。

## 理解之后再对照 Codex

Multi-Agent 控制在 `core/src/agent`，V2 工具在
`core/src/tools/handlers/multi_agents_v2`。代码 review 与 Guardian 分别对应
`core/src/tasks/review.rs`、`core/src/session/review.rs` 和 `core/src/guardian`。

OTel 与 rollout trace 的设计入口是 `otel/README.md`、`rollout-trace/README.md` 和
`core/src/tools/tool_dispatch_trace.rs`。集成测试在 `core/tests/suite` 与
`app-server/tests`，它们用 fake SSE 验证模型请求、工具输出、审批和协议事件。

阅读时选一个失败 case，沿 trace、测试、实现三处互相验证，不要把测试目录当目录树背诵。

## 本课验收

你应该能：

1. 判断一项工作适合委派还是留在父 Agent 的关键路径。
2. 区分 code reviewer、Guardian 和普通 Reflection。
3. 为一次错误回答列出最小可用 trace 字段。
4. 把一个真实失败转成稳定 regression case 和长期 metric。
