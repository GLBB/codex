# 10 生产级 AI 系统设计：网关、稳定性、成本和排障

## 本课目标

社招面试常常不会只问“Agent 怎么写”，而是让你设计一个生产级 AI 应用或 Agent 平台。本课补齐系统设计考点：

- 模型网关。
- 限流、熔断、降级、重试。
- Prompt / Context 版本管理。
- 结构化输出失败处理。
- 成本、延迟和可观测。
- 安全合规和权限治理。

## Step 1：画生产级 Agent 平台

推荐架构：

```text
Client / IDE / API
  -> auth / quota
  -> app server / protocol
  -> thread manager
  -> session runtime
  -> context builder
  -> model gateway
  -> tool orchestrator
  -> sandbox / approval / guardian
  -> memory / RAG
  -> logs / traces / eval replay
```

Codex 对照：

- `codex-rs/app-server`
- `codex-rs/app-server-protocol`
- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/core/src/context_manager`
- `codex-rs/core/src/tools/orchestrator.rs`

## Step 2：模型网关怎么答

常见问法：

```text
如何设计一个模型网关，支持限流、熔断、降级和成本统计？
```

回答结构：

- 入口：统一封装不同模型 provider。
- 鉴权：按用户、组织、项目做 quota。
- 路由：按任务类型、上下文长度、成本和可用性选模型。
- 重试：只对幂等请求重试，避免重复工具副作用。
- 熔断：provider 异常时快速失败或降级到备用模型。
- 成本：记录 input/output tokens、工具调用次数、延迟。
- 观测：每次请求有 trace id，能关联 agent turn 和工具事件。

Codex 对照：

- `codex-rs/core/src/client.rs`
- `codex-rs/core/src/client_common.rs`
- `codex-rs/core/src/responses_retry.rs`
- `codex-rs/otel/README.md`
- `codex-rs/rollout-trace/README.md`

## Step 3：结构化输出失败怎么处理

常见问法：

```text
JSON Mode / Structured Outputs / Function Calling 失败怎么办？
```

答题要点：

- 输出解析失败要结构化记录，不要静默吞掉。
- 可以做一次修复重试，但要限制次数。
- 对工具参数要做 schema validation。
- 对危险工具要先 validation，再 approval，再执行。
- 如果模型输出和业务状态冲突，应以业务状态为准。

Codex 对照：

- `codex-rs/core/src/tools/router.rs`
- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/tools/handlers`
- `codex-rs/core/src/tools/events.rs`

## Step 4：成本和延迟怎么优化

常见问法：

```text
Agent 很慢、很贵，怎么优化？
```

排查顺序：

1. 模型请求次数：是否循环过多。
2. 上下文大小：是否注入了无关历史、工具清单、RAG 片段。
3. 工具延迟：是否串行调用，是否可并发。
4. RAG：是否召回过多，是否 rerank 太慢。
5. Multi-Agent：是否拆得过细，导致 token 翻倍。
6. 失败重试：是否重复执行高成本动作。

优化手段：

- 缓存稳定上下文。
- 给工具结果做大小上限。
- 对 tools 做动态暴露，不把所有工具常驻上下文。
- 对多 agent 设置预算和超时。
- 用 eval 证明压缩和降级没有伤害质量。

Codex 对照：

- `codex-rs/core/src/context`
- `codex-rs/core/src/context_manager`
- `codex-rs/core/src/tools/parallel.rs`
- `codex-rs/core/src/agent/control.rs`
- `codex-rs/core/src/tasks/compact.rs`

## Step 5：线上排障怎么讲

面试官常问：

```text
用户说 Agent 答错了，你怎么排查？
```

建议链路：

```text
确认用户输入
  -> 查 thread / turn
  -> 查最终模型输入
  -> 查工具 schema 和工具选择
  -> 查工具参数和工具结果
  -> 查 RAG 引用
  -> 查权限或 sandbox 拒绝
  -> 查模型输出和结构化解析
  -> 用 replay 复现
  -> 加入 eval / regression case
```

Codex 对照：

- `codex-rs/rollout-trace/README.md`
- `codex-rs/core/src/tools/tool_dispatch_trace.rs`
- `codex-rs/core/tests/suite`
- `codex-rs/app-server/tests`

## Step 6：动手练习

设计一个生产级 Agent 平台方案，回答：

```text
业务场景:
入口协议:
模型网关:
上下文构建:
工具系统:
RAG / Memory:
权限与沙箱:
日志和 trace:
eval:
成本控制:
降级策略:
```

要求每一项都能映射到前面课程里的一个模块。

## Codex 对照源码

- `codex-rs/app-server`
- `codex-rs/app-server-protocol`
- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/core/src/context_manager`
- `codex-rs/core/src/tools/orchestrator.rs`
- `codex-rs/core/src/tools/tool_dispatch_trace.rs`
- `codex-rs/otel/README.md`
- `codex-rs/rollout-trace/README.md`
- `codex-rs/core/tests/suite`

## 推荐资料

- [JavaGuide AI 应用开发面试指南](https://javaguide.cn/ai/interview-questions/ai-interview-guide.html)
- [Rubduck AI System Design / LLM Evaluation](https://rubduck.ai/questions)
- [OpenAI Evals](https://github.com/openai/evals)
- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)

## 验收标准

你完成本课时，应该能回答：

- 生产级 Agent 平台有哪些模块？
- 模型网关如何做限流、熔断、降级和成本统计？
- 结构化输出失败和工具参数错误怎么处理？
- 用户反馈 Agent 答错时，如何从 trace 到 eval 完成闭环？
