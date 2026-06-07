# 12 Multi-Agent 编排：任务拆分、通信、隔离和回收

## 本课目标

Multi-Agent 不是“多几个角色聊天”，而是把复杂任务拆成多个有边界的执行单元。本课学习：

- 什么时候应该引入子 agent。
- 父 agent 如何 spawn / wait / send input / close 子 agent。
- 子 agent 继承哪些上下文，隔离哪些状态。
- 多 agent 如何通信、同步、超时和回收。
- 多 agent 的成本、权限和评估怎么控制。

学完以后，你应该能设计一个 `planner -> coder -> tester -> reviewer` 的 coding agent team，并说明为什么每个 agent 需要独立存在。

## Step 1：先判断是否需要 Multi-Agent

不要一上来就多 agent。先问四个问题：

| 判断问题 | 如果答案是“是” |
| --- | --- |
| 单 agent 上下文是否装不下？ | 可以拆出研究/执行/审查子 agent |
| 是否需要并行探索多个方向？ | 可以 spawn 多个 explorer |
| 是否需要不同权限或不同角色？ | 可以隔离 coder、tester、reviewer |
| 是否需要长期等待或异步任务？ | 需要 wait、resume、close 语义 |

不适合 Multi-Agent 的情况：

- 任务步骤很固定，workflow 更简单。
- 子任务之间强依赖、频繁同步，通信成本过高。
- 没有清晰验收标准，只是让多个 agent 自由讨论。

## Step 2：阅读 Codex 的 agent 控制层

打开：

1. `codex-rs/core/src/agent/control.rs`
2. `codex-rs/core/src/agent/control/spawn.rs`
3. `codex-rs/core/src/agent/registry.rs`
4. `codex-rs/core/src/agent/status.rs`
5. `codex-rs/core/src/agent/role.rs`

重点找：

- agent 如何注册和查找。
- spawn 时如何描述子任务。
- 子 agent 的状态如何表达。
- role / builtin agent 如何影响行为。

## Step 3：阅读 Multi-Agent 工具入口

打开：

1. `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
2. `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
3. `codex-rs/core/src/tools/handlers/multi_agents_v2/send_message.rs`
4. `codex-rs/core/src/tools/handlers/multi_agents_v2/list_agents.rs`
5. `codex-rs/core/src/tools/handlers/multi_agents_v2/close_agent.rs`
6. `codex-rs/core/src/tools/handlers/multi_agents_common.rs`

观察每个工具解决的问题：

| 工具 | 解决什么问题 |
| --- | --- |
| spawn | 创建子 agent，并给它任务 |
| wait | 等待子 agent 完成或超时 |
| send_message | 给已存在子 agent 继续输入 |
| list_agents | 观察当前 agent 集合 |
| close_agent | 回收子 agent |

## Step 4：理解上下文继承和状态隔离

Multi-Agent 最容易出错的地方是上下文边界。

需要区分：

- 父 agent 的任务目标。
- 子 agent 可以看到的历史。
- 子 agent 的工具和权限。
- 子 agent 的输出如何回到父 agent。
- 子 agent 的中间思考是否进入父上下文。

阅读：

- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/core/src/session/multi_agents.rs`
- `codex-rs/core/src/state/turn.rs`
- `codex-rs/core/src/session/input_queue.rs`

自测问题：

```text
如果 reviewer 子 agent 继承了 coder 的全部上下文，会有什么风险？
如果 tester 子 agent 拥有写权限，会有什么风险？
如果 explorer 子 agent 的长输出全部塞回父上下文，会有什么风险？
```

## Step 5：通信模型：消息还是共享状态

常见设计有两种：

| 模式 | 优点 | 风险 |
| --- | --- | --- |
| 消息传递 | 边界清楚、可审计、容易回放 | 需要设计消息格式 |
| 共享状态 | 协作方便、减少复制 | 容易污染、并发冲突、难追踪 |

生产系统优先选择消息传递。共享状态要非常克制，只放稳定、结构化、可审计的数据。

Codex 的学习重点是：父子 agent 之间通过工具和事件交互，而不是让所有 agent 共享一坨可变上下文。

## Step 6：失败、超时和回收

多 agent 必须有生命周期管理：

- spawn 失败：父 agent 要收到结构化错误。
- wait 超时：父 agent 要能继续、重试或关闭子 agent。
- 子 agent 输出过长：要摘要或截断。
- 子 agent 卡住：要 close。
- 子 agent 失败：要保留 trace，用于复盘。

阅读：

- `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/close_agent.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_tests.rs`
- `codex-rs/core/tests/suite/responses_api_proxy_headers.rs`

## Step 7：动手练习

设计一个 `coding-agent-team`：

```text
planner:
  input: 用户任务
  output: 任务拆分和验收标准

coder:
  input: planner 的计划
  output: patch summary

tester:
  input: patch summary
  output: test result and failure diagnosis

reviewer:
  input: diff + tests
  output: findings ordered by severity
```

要求写出：

```text
每个 agent 能看到什么上下文:
每个 agent 能用哪些工具:
父 agent 如何等待和汇总:
失败时怎么处理:
如何控制 token 和工具成本:
哪些输出会进入最终回答:
```

## Step 8：评估 Multi-Agent

不要只评最终答案。至少评：

| 维度 | 检查什么 |
| --- | --- |
| 分工正确性 | 子任务是否拆得合理 |
| 工具权限 | 子 agent 是否只拥有必要工具 |
| 通信质量 | 消息是否结构化、可回放 |
| 成本 | 子 agent 数量、token、工具调用次数 |
| 失败恢复 | wait 超时、子 agent 失败、输出过长 |
| 汇总质量 | 父 agent 是否忠实整合子结果 |

## Codex 对照源码

- `codex-rs/core/src/agent/control.rs`
- `codex-rs/core/src/agent/control/spawn.rs`
- `codex-rs/core/src/agent/registry.rs`
- `codex-rs/core/src/agent/status.rs`
- `codex-rs/core/src/agent/role.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2`
- `codex-rs/core/src/tools/handlers/multi_agents_common.rs`
- `codex-rs/core/src/session/multi_agents.rs`
- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/core/src/state/turn.rs`
- `codex-rs/core/tests/suite/responses_api_proxy_headers.rs`

## 推荐资料

- [LangGraph Multi-Agent / Orchestration](https://docs.langchain.com/oss/python/langgraph/overview)
- [OpenAI Agents SDK handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [A2A Specification](https://a2aproject.github.io/A2A/latest/specification/)
- [Building effective agents 中文精读版](../../articles/building-effective-agents.zh.md)

## 验收标准

你完成本课时，应该能回答：

- 什么时候该用 Multi-Agent，什么时候不该用？
- 父 agent 和子 agent 的上下文边界怎么设计？
- 消息传递和共享状态怎么选？
- spawn、wait、send message、close 分别解决什么生命周期问题？
- 如何评估 Multi-Agent 的成本、失败恢复和汇总质量？
