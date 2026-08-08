# Agent 开发主题学习指南

如果你想按顺序学习，请先走 [Agent 开发系列教程](agent-course/README.md)。如果想确认课程是否覆盖常见面试追问，可以配合 [Agent 常见追问覆盖矩阵](agent-course/interview-coverage-matrix.md) 自测。本文是主题地图，适合在课程中途回查某个主题的设计要点、资料和源码入口。

本文把 Agent 开发拆成一组可单独学习、也能组合成生产系统的主题。每个主题都回答四个问题：

1. 这个主题解决什么工程问题？
2. 设计时要抓住哪些要点？
3. 推荐先读哪些外部资料？
4. 在 Codex 项目里从哪里看真实实现？

如果你还没建立整体地图，先读：

- [Agent 开发学习路线](../roadmaps/agent-learning-roadmap.md)
- [Codex 生产级 Coding Agent 学习总览](production-coding-agent-overview.md)
- [Codex Query 处理流程](query-processing-flow.md)

## 主题总览

| 主题 | 你要掌握的核心问题 | Codex 入口 |
| --- | --- | --- |
| Agent Loop | 模型如何在“思考、调用工具、观察结果、继续执行”中闭环 | `codex-rs/core/src/session/turn.rs` |
| Session / Thread / Turn | 一次对话、一次运行、一次用户请求如何建模和持久化 | `codex-rs/core/src/thread_manager.rs`、`codex-rs/core/src/session` |
| Tool System | 工具如何声明、暴露给模型、路由、执行、返回结果 | `codex-rs/core/src/tools`、`codex-rs/tools` |
| Context / Prompt | 模型到底看到了什么，如何注入规则、历史、技能和环境变化 | `codex-rs/core/src/context`、`codex-rs/core/src/context_manager` |
| Memory / RAG | 短期上下文、长期记忆、检索增强如何避免污染和幻觉 | `codex-rs/memories`、`codex-rs/memories/read`、`codex-rs/memories/write` |
| Sandbox / Permission | 为什么不能裸跑 shell，如何做文件、网络、命令权限控制 | `codex-rs/sandboxing`、`codex-rs/linux-sandbox`、`codex-rs/execpolicy-legacy` |
| MCP | 如何用标准协议接入外部工具、资源和 elicitation | `codex-rs/codex-mcp`、`codex-rs/core/src/mcp_tool_call.rs` |
| Skills / Plugins | 如何把可复用能力、说明、资源和工具依赖打包 | `codex-rs/skills`、`codex-rs/plugin`、`codex-rs/core/src/skills.rs` |
| Multi-Agent | 子 agent 如何 spawn、fork 历史、通信、等待和回收 | `codex-rs/core/src/agent` |
| Review / Guardian | 如何让 Agent 审查代码或审查危险动作 | `codex-rs/core/src/tasks/review.rs`、`codex-rs/core/src/guardian` |
| App Server / Protocol | 如何把 agent runtime 暴露给 IDE、桌面端和自动化客户端 | `codex-rs/app-server`、`codex-rs/app-server-protocol` |
| Observability / Eval | 如何调试模型请求、工具调用、日志、trace、测试和回放 | [可观测性导读](observability-guide.md)、`codex-rs/otel`、`codex-rs/rollout-trace`、`codex-rs/core/tests/suite` |

## 学习产出矩阵

这张表把每个主题落到一个可以提交、演示或复盘的小产出。学习时不要只读源码，最好每个主题都留下一个能运行、能解释、能被别人 review 的证据。

| 阶段 | 主题 | 最小实践产出 | Codex 对照点 | 验收证据 |
| --- | --- | --- | --- | --- |
| 1 | Agent Loop | 一个支持多轮 tool call 的 `mini-agent` | `codex-rs/core/src/session/turn.rs` | 日志能看到 model request、tool call、tool result、final answer |
| 1 | Session / Thread / Turn | 一份状态机图，标出 thread、session、turn 的生命周期 | `codex-rs/core/src/thread_manager.rs`、`codex-rs/core/src/session` | 能解释新建、resume、fork、完成和取消分别改了什么状态 |
| 2 | Tool System | 一个 typed tool registry，支持声明 schema、执行和返回结构化结果 | `codex-rs/core/src/tools`、`codex-rs/core/src/tools/registry.rs` | 给模型的工具定义和实际执行入口能一一对应 |
| 2 | Context / Prompt | 一个上下文构建器，能合并 system、developer、history、environment 和 tool outputs | `codex-rs/core/src/context`、`codex-rs/core/src/context_manager` | 能打印最终模型输入，并证明每类注入都有上限 |
| 3 | Memory / RAG | 一个小型检索记忆模块，支持写入、检索、引用来源和过期策略 | `codex-rs/memories` | 回答中能显示引用片段，且无关记忆不会被注入 |
| 3 | Sandbox / Permission | 一个命令审批器，按命令、目录、网络策略决定 allow / ask / deny | `codex-rs/sandboxing`、`codex-rs/execpolicy-legacy` | 危险命令会被拦截，允许命令能产生日志和退出码 |
| 4 | MCP | 一个 MCP 工具客户端 demo，列出 tools/resources 并调用一个工具 | `codex-rs/codex-mcp`、`codex-rs/core/src/mcp_tool_call.rs` | 能区分本地工具和 MCP 工具的发现、调用、失败路径 |
| 4 | Skills / Plugins | 一个技能包，包含 `SKILL.md`、参考资料和一个可复用工作流 | `codex-rs/skills`、`codex-rs/plugin`、`codex-rs/core/src/skills.rs` | 触发词能找到技能，技能说明能进入上下文且大小受控 |
| 5 | Multi-Agent | 一个父 agent 派生子 agent 的实验，子任务完成后汇总结果 | `codex-rs/core/src/agent` | 能说明子 agent 继承了什么上下文、隔离了什么状态 |
| 5 | Review / Guardian | 一个 review/guardrail 检查器，对代码改动或危险动作给出结构化意见 | `codex-rs/core/src/tasks/review.rs`、`codex-rs/core/src/guardian` | 输出包含发现、严重级别、证据和建议动作 |
| 6 | App Server / Protocol | 一个客户端脚本，通过协议创建 thread、发送 query、读取事件 | `codex-rs/app-server`、`codex-rs/app-server-protocol` | 能记录请求、响应和事件流，并解释字段语义 |
| 6 | Observability / Eval | 一组回放样例和评分表，覆盖成功、工具失败、权限拒绝和上下文过长 | `codex-rs/otel`、`codex-rs/rollout-trace`、`codex-rs/core/tests/suite` | 每个样例有日志、期望行为和失败定位方法 |

## 1. Agent Loop

### 设计要点

Agent loop 是最小闭环：构建模型输入，调用模型，解析输出，执行工具，把工具结果放回上下文，再决定是否继续采样。教学版通常只有几十行；生产版要额外处理 stream、取消、重试、token 限制、上下文压缩、工具并发、审批、日志和持久化。

学习时重点看三件事：

- 退出条件：最终回答、工具调用完成、错误、达到预算、用户中断。
- 反馈闭环：工具结果必须成为下一次模型请求的输入。
- 可观察性：每次模型请求、工具调用、错误和完成事件都要能追踪。

### 推荐资料

- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)
- [Hugging Face Agents Course](https://huggingface.co/learn/agents-course/en)
- 本地精读：[Building effective agents 中文精读版](../articles/building-effective-agents.zh.md)
- 本地精读：[A practical guide to building agents 中文精读版](../articles/a-practical-guide-to-building-agents.zh.md)

### Codex 怎么做

Codex 的核心 loop 在 `codex-rs/core/src/session/turn.rs`。主路径是：

```text
run_turn
  -> run_sampling_request
  -> try_run_sampling_request
  -> ModelClientSession::stream
  -> ResponseEvent
  -> handle_output_item_done
  -> tool dispatch / assistant message / follow-up
```

配套阅读：

- [Codex Query 处理流程](query-processing-flow.md)
- `codex-rs/core/src/tasks/regular.rs`
- `codex-rs/core/src/session/turn_context.rs`

### 练习

写一个 `mini-agent`，只支持 2 个工具：`calculator` 和 `read_file`。要求打印每一步：model request、tool call、tool result、final answer。再给它加最大轮数和超时。

## 2. Session / Thread / Turn

### 设计要点

这组概念决定 Agent 能不能被恢复、分支、并发运行和接入多个客户端。

- Thread：用户可见的一条工作流或对话历史。
- Session：进程内运行时，持有配置、状态、工具、模型客户端和事件通道。
- Turn：一次用户请求到完成事件的生命周期。
- Item：turn 内的可持久化单元，例如用户消息、assistant message、reasoning、shell command、patch。

设计时不要把所有东西塞进“conversation history”。历史、运行状态、权限快照、UI 事件、日志和长期记忆最好有清楚边界。

### 推荐资料

- [OpenAI Agents SDK Python](https://openai.github.io/openai-agents-python/)
- [OpenAI Agents SDK JavaScript](https://openai.github.io/openai-agents-js/)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)

### Codex 怎么做

源码入口：

- `codex-rs/core/src/thread_manager.rs`
- `codex-rs/core/src/codex_thread.rs`
- `codex-rs/core/src/session/session.rs`
- `codex-rs/core/src/tasks/mod.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/thread.rs`
- `codex-rs/app-server-protocol/src/protocol/v2/turn.rs`

要抓住的主线：

```text
ThreadManager
  -> CodexThread
  -> Codex
  -> Session
  -> Submission
  -> SessionTask
  -> TurnContext
```

### 练习

给你的 `mini-agent` 增加 `thread_id`、`turn_id`、event log 和 resume。要求重启进程后能继续上一条 thread，并能看到每个 turn 的事件序列。

## 3. Tool System

### 设计要点

工具系统是 Agent 工程的核心。好工具不是“把函数暴露出去”这么简单，而是要让模型容易选对、容易填对参数、失败时容易恢复。

这一主题先回答“模型提出动作后，系统怎样把它变成受控的工具调用”。如果工具启动的是 Shell 长进程，工具调用返回并不代表进程已经结束；进程的保存、轮询、输入、取消和回收应继续阅读 [15 Shell 与进程生命周期](agent-course/15-shell-process-lifecycle.md)。

设计时关注：

- Tool schema：名称、描述、参数、返回格式是否明确。
- Tool registry：工具如何注册、过滤、动态启用。
- Tool routing：模型输出如何转成内部调用。
- Tool runtime：超时、取消、并发、错误分类、审计。
- Tool result：结果如何同时给用户看、给模型继续推理。
- Permission：哪些工具有副作用，哪些需要审批或沙箱。

### 推荐资料

- [OpenAI Agents SDK Tools](https://openai.github.io/openai-agents-python/tools/)
- [Anthropic Tool Use](https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview)
- [Model Context Protocol Specification](https://modelcontextprotocol.io/specification/latest)

### Codex 怎么做

源码入口：

- `codex-rs/core/src/tools/router.rs`
- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/tools/orchestrator.rs`（需要审批或沙箱准备的执行路径）
- `codex-rs/core/src/tools/sandboxing.rs`
- `codex-rs/tools/src/tool_spec.rs`
- `codex-rs/tools/src/responses_api.rs`

关键路径：

```text
ResponseItem::FunctionCall / CustomToolCall
  -> ToolRouter::build_tool_call
  -> ToolRegistry
  -> concrete tool handler
  -> 按需进入 ToolOrchestrator 完成审批与沙箱准备
  -> tool runtime
  -> ResponseInputItem
  -> conversation history
```

读源码时先沿 `ToolRouter::build_tool_call`、`ToolRegistry` 的分派入口和具体 handler 跑通通用路径。只有看到 handler 需要构造受沙箱约束的执行请求时，再进入 `ToolOrchestrator`；不要把它误认为每一种工具都必须经过的总调度器。

### 练习

给 `mini-agent` 增加一个 `run_shell` 工具。先只允许 `ls`、`pwd`、`cat`。命令不在 allowlist 时，返回可恢复错误，而不是直接执行。

## 4. Context / Prompt

### 设计要点

Agent 的能力上限很大程度由 context 决定。模型看到的内容包括系统指令、用户输入、历史、工具说明、环境变化、skills、MCP 工具清单、hook 注入、压缩摘要等。

设计时关注：

- Context 边界：哪些是稳定系统指令，哪些是本轮动态上下文。
- Context diff：环境变化是否需要告诉模型。
- Context cap：任何注入项都要有大小上限，避免撑爆窗口。
- Context trust：外部网页、MCP、用户文件和系统规则不能混为一谈。
- Compaction：长任务如何压缩历史，同时保留任务状态和关键事实。

### 推荐资料

- [OpenAI Prompting Guide](https://platform.openai.com/docs/guides/prompting)
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)

### Codex 怎么做

源码入口：

- `codex-rs/core/src/context`
- `codex-rs/core/src/context_manager`
- `codex-rs/core/src/session/turn.rs`
- `codex-rs/core/src/session/turn_context.rs`
- `codex-rs/core/src/tasks/compact.rs`

Codex 会在 turn 开始时记录 context updates，必要时注入 skills/plugins/extensions，然后从 session history 构建 prompt。上下文超限时会触发 compact。

### 练习

给 `mini-agent` 加一个 context builder，把 prompt 分成 `base_instructions`、`conversation_history`、`tool_specs`、`runtime_context` 四块，并打印最终发送给模型的 JSON。

## 5. Memory / RAG

### 设计要点

RAG 和 Memory 都是在给模型补外部知识，但目标不同：

- RAG：为当前问题检索相关资料，重点是 grounding 和 citation。
- Memory：跨会话沉淀用户偏好、项目事实、长期任务状态，重点是可控、可删、抗污染。

设计时关注：

- 资料来源：文件、网页、数据库、历史会话分别标注来源。
- 检索日志：记录 query、命中文档、片段、得分。
- 引用约束：回答中能追溯到来源。
- 写入策略：什么内容有资格进入长期记忆。
- 污染防护：外部未信任上下文不能轻易写入长期 memory。
- 删除和重置：用户应能禁用、清空或审计 memory。

### 推荐资料

- [OpenAI File Search / Tools](https://platform.openai.com/docs/guides/tools)
- [LlamaIndex Agents](https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/)
- [LangGraph Overview](https://docs.langchain.com/oss/python/langgraph/overview)
- [mem0](https://github.com/mem0ai/mem0)
- [Letta](https://github.com/letta-ai/letta)

### Codex 怎么做

源码入口：

- `codex-rs/memories/README.md`
- `codex-rs/memories/read/src/lib.rs`
- `codex-rs/memories/write/src/phase1.rs`
- `codex-rs/memories/write/src/phase2.rs`
- `codex-rs/memories/write/src/guard.rs`
- `codex-rs/state/src/model/memories.rs`
- `codex-rs/codex-api/src/endpoint/memories.rs`

Codex 的长期 memory 更接近“从历史 rollout 中提取和整合可复用事实”，不是普通向量库 RAG。它需要考虑 thread memory mode、外部上下文污染、阶段化提取和 consolidation。

### 练习

做一个 `notes-rag-agent`：读取本地 Markdown 笔记，回答时必须给出文件路径和片段。再加一个 `memory.json`，只允许用户明确说“记住”时写入。

## 6. Sandbox / Permission

### 设计要点

Coding agent 能读写文件、执行 shell、访问网络，所以安全边界必须是一等公民。

设计时关注：

- 文件权限：read-only、workspace-write、danger-full-access。
- 网络权限：默认禁用、按域名或请求审批放行。
- 命令策略：可信命令、危险命令、用户审批、持久 allow rule。
- 进程隔离：namespace、seccomp、Landlock、Seatbelt、Docker。
- 人工确认：何时问用户，问什么，决策如何记录。
- 审计：危险动作必须能在日志和 rollout 中追溯。

### 推荐资料

- [bubblewrap](https://github.com/containers/bubblewrap)
- [Docker security](https://docs.docker.com/engine/security/)
- [Linux namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [seccomp](https://man7.org/linux/man-pages/man2/seccomp.2.html)
- [Linux capabilities](https://man7.org/linux/man-pages/man7/capabilities.7.html)

### Codex 怎么做

源码入口：

- `codex-rs/core/src/tools/orchestrator.rs`
- `codex-rs/core/src/tools/sandboxing.rs`
- `codex-rs/sandboxing/src/manager.rs`
- `codex-rs/sandboxing/src/bwrap.rs`
- `codex-rs/sandboxing/src/landlock.rs`
- `codex-rs/sandboxing/src/seatbelt.rs`
- `codex-rs/linux-sandbox/src/linux_run_main.rs`
- `codex-rs/execpolicy-legacy/src/policy.rs`
- `codex-rs/execpolicy-legacy/src/valid_exec.rs`

Codex 的典型路径是：工具执行前先判断审批需求，再选择 sandbox attempt；如果被 sandbox 或网络策略拒绝，根据策略和用户批准情况决定是否重试或升级。

### 练习

写一个 `sandbox-lab`。要求：

- `read-only` 模式不能写 workspace。
- `workspace-write` 模式不能写 workspace 外文件。
- `network-off` 模式访问外网失败。
- 所有失败都返回结构化错误。

## 7. MCP

### 设计要点

MCP 的价值是把外部工具、资源和提示模板标准化，让 Agent 不需要为每个系统定制接入方式。但 MCP 只是协议，不会自动带来好工具设计。

设计时关注：

- Server lifecycle：启动、重连、刷新工具列表。
- Tools：schema、权限、错误返回、结果大小。
- Resources：外部资料如何读取，是否可信。
- Elicitation：工具需要用户补信息时怎么回到客户端。
- Auth：OAuth 或其它认证如何和 Agent session 绑定。
- Memory pollution：外部工具返回的内容能否进入长期记忆。

### 推荐资料

- [Model Context Protocol docs](https://modelcontextprotocol.io/)
- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/latest)
- [MCP GitHub repository](https://github.com/modelcontextprotocol/modelcontextprotocol)

### Codex 怎么做

源码入口：

- `codex-rs/codex-mcp/src/connection_manager.rs`
- `codex-rs/codex-mcp/src/runtime.rs`
- `codex-rs/codex-mcp/src/tools.rs`
- `codex-rs/codex-mcp/src/elicitation.rs`
- `codex-rs/core/src/mcp_tool_call.rs`
- `codex-rs/codex-mcp/src/connection_manager.rs`
- `codex-rs/core/src/state/service.rs`
- `codex-rs/app-server/src/mcp_refresh.rs`

Codex 会通过 MCP connection manager 管理 server 和工具清单；模型触发 MCP tool call 后，core 会处理权限、调用、结果转换和污染判断。

### 练习

写一个 MCP server，提供 `search_notes` 和 `read_note` 两个工具。再写一条 skill，告诉 Agent 什么时候应该用这个 MCP server。

## 8. Skills / Plugins

### 设计要点

Skill 是可复用工作流知识：什么时候触发、要读哪些参考、要跑哪些脚本、如何避免重复解释。Plugin 则是更大的安装包，可以包含 skills、MCP、hooks、apps、assets 等。

设计时关注：

- 触发条件：描述要具体，避免所有任务都加载。
- 上下文控制：skill 内容要可裁剪，引用资料按需读取。
- 工具依赖：skill 需要哪些 MCP、脚本、资源。
- 安装和启用：用户级、项目级、组织级如何控制。
- 安全：plugin/hook/MCP 都可能引入外部动作，必须可审计。

### 推荐资料

- [Codex Skills docs](https://developers.openai.com/codex/skills)
- [Codex Plugins docs](https://developers.openai.com/codex/plugins)
- [Model Context Protocol docs](https://modelcontextprotocol.io/)

### Codex 怎么做

源码入口：

- `codex-rs/skills/src/lib.rs`
- `codex-rs/core/src/skills.rs`
- `codex-rs/core/src/context/available_skills_instructions.rs`
- `codex-rs/plugin/src/lib.rs`
- `codex-rs/core-plugins`
- `codex-rs/core/src/session/turn.rs`

`run_turn` 会根据用户输入中的显式 skill/plugin/app mention 生成本轮注入项。Skill 不应该无边界地常驻上下文，而是按任务需要注入。

### 练习

给自己的项目写一个 `SKILL.md`：当用户要求“总结会议纪要”时，读取固定模板和 checklist，再调用一个本地脚本生成结构化摘要。

## 9. Multi-Agent

### 设计要点

多 Agent 不是越多越好。只有当任务需要隔离上下文、并行探索、专门角色或独立权限时，才值得引入。

设计时关注：

- Spawn：子 agent 继承多少父历史。
- Role：子 agent 的目标、工具、权限是否和父 agent 不同。
- Communication：父子如何传消息、等待、取消。
- Result：子 agent 结果如何汇总，失败如何表达。
- Cost：并发 agent 会显著增加 token 和工具成本。

### 推荐资料

- [OpenAI Agents SDK handoffs](https://openai.github.io/openai-agents-python/handoffs/)
- [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)
- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)

### Codex 怎么做

源码入口：

- `codex-rs/core/src/agent/control.rs`
- `codex-rs/core/src/agent/registry.rs`
- `codex-rs/core/src/state/turn.rs`
- `codex-rs/core/src/session/input_queue.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs`
- `codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs`
- `codex-rs/core/src/tools/handlers/multi_agents/send_input.rs`

Codex 的子 agent 本质上是新的 thread/session，可以 fork 父历史，也可以通过 mailbox 通信。学习时重点看子 agent 为什么不是普通 async task，而是有独立上下文和生命周期的 thread。

### 练习

做一个 `coding-agent-team`：planner 只产出计划，coder 负责修改，tester 负责运行测试，reviewer 只做风险审查。记录每个 agent 的输入、输出和成本。

## 10. Review / Guardian

### 设计要点

生产级 Agent 需要两类审查：

- 任务结果审查：代码 review、报告质量评估、测试建议。
- 行为安全审查：是否允许某次 shell、patch、网络或权限请求。

设计时关注：

- Reviewer 看到的上下文应和执行 agent 不同。
- Reviewer 工具权限应该更小。
- 高风险动作最好有结构化审查结果。
- 审查不是万能安全边界，仍要依赖权限和沙箱。

### 推荐资料

- [Anthropic: Building effective agents](https://www.anthropic.com/research/building-effective-agents)
- [OpenAI: A practical guide to building agents](https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf)

### Codex 怎么做

源码入口：

- `codex-rs/core/src/session/review.rs`
- `codex-rs/core/src/tasks/review.rs`
- `codex-rs/core/src/review_format.rs`
- `codex-rs/core/src/guardian/prompt.rs`
- `codex-rs/core/src/guardian`
- `codex-rs/ext/guardian`

Review task 会启动受限 review workflow。Guardian/auto-review 则审查危险审批请求，例如命令、patch、网络访问和权限升级。

### 练习

给 `coding-review-agent` 增加两个输出：`findings` 和 `test_plan`。再加一个 guardian prompt，只判断“是否允许执行这条 shell 命令”。

## 11. App Server / Protocol

### 设计要点

生产 Agent 往往不是一个 CLI，而是一个可被 IDE、桌面端、Web、自动化脚本复用的 runtime。协议层要表达 thread、turn、item、审批、文件事件、进程事件和状态变化。

设计时关注：

- 双向通信：server 不只推事件，也会向 client 请求审批或输入。
- 流式事件：assistant delta、tool progress、command output 都要能增量显示。
- Rejoin/resume：客户端断开后能重新订阅运行中的 thread。
- Backpressure：客户端慢时不能无限堆事件。
- Schema：协议类型要稳定、可生成、可测试。

### 推荐资料

- [Model Context Protocol specification](https://modelcontextprotocol.io/specification/latest)
- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)

### Codex 怎么做

源码入口：

- `codex-rs/app-server/README.md`
- `codex-rs/app-server/src/message_processor.rs`
- `codex-rs/app-server/src/request_processors.rs`
- `codex-rs/app-server/src/outgoing_message.rs`
- `codex-rs/app-server/src/thread_state.rs`
- `codex-rs/app-server-protocol/src/protocol/v2`
- `codex-rs/app-server-test-client/README.md`

Codex app-server 的核心 primitive 是 `Thread -> Turn -> Item`。`turn/start` 返回后，客户端继续接收 `turn/started`、`item/*`、delta、approval request 和 `turn/completed`。

### 练习

给 `mini-agent` 包一层 JSONL 协议，至少支持 `thread/start`、`turn/start`、`turn/interrupt` 和 `item/delta`。

## 12. Observability / Eval

### 设计要点

Agent debug 难在三层不一致：模型看到了什么、工具实际做了什么、用户界面展示了什么。生产系统必须能把这三层对齐。

设计时关注：

- Trace：一次 turn 的模型请求、工具调用、审批和完成事件。
- Replay：能否从 event log 或 rollout 重建上下文。
- Evals：不仅评最终答案，也评工具选择、权限行为和错误恢复。
- Snapshot：UI 和协议事件需要回归测试。
- Token/cost：多 agent、RAG、compact 都要纳入成本统计。

### 推荐资料

- [OpenAI Agents SDK tracing](https://openai.github.io/openai-agents-python/tracing/)
- [LangSmith / LangGraph observability](https://docs.langchain.com/langsmith/home)
- [OpenAI Evals](https://github.com/openai/evals)

### Codex 怎么做

源码入口：

- `codex-rs/otel/README.md`
- `codex-rs/rollout-trace/README.md`
- `codex-rs/responses-api-proxy/README.md`
- `codex-rs/core/src/tools/tool_dispatch_trace.rs`
- `codex-rs/core/tests/suite`
- `codex-rs/app-server/tests`
- `codex-rs/tui/src/markdown_render_tests.rs`
- `codex-rs/tui/src/app/history_ui_tests.rs`

Codex 的集成测试会 mock 模型 SSE 事件，验证 agent loop、工具输出、审批、协议和 UI snapshot。学习时不要只看实现，也要看测试怎么构造模型事件。

### 练习

给 `mini-agent` 做 5 条 eval case：工具选错、工具失败、上下文过长、权限拒绝、用户中断。每条都保存输入、事件、最终状态和断言。

## 建议学习顺序

第一轮不要试图全部吃透。建议按这个顺序：

1. Agent Loop：先写最小闭环。
2. Tool System：让模型可靠调用 2 到 3 个工具。
3. Session / Thread / Turn：让运行可恢复、可回放。
4. Sandbox / Permission：给副作用工具加边界。
5. Context / Prompt：搞清楚模型到底看到什么。
6. Memory / RAG：补外部知识和长期状态。
7. MCP：把工具接入标准化。
8. Skills / Plugins：把能力包装成可复用单元。
9. Multi-Agent：只在单 agent 不够时引入。
10. Observability / Eval：把调试和评估贯穿始终。

## 最小毕业项目

做一个 `sandboxed-coding-agent`，具备：

- `read_file`、`list_files`、`apply_patch`、`run_shell` 四个工具。
- thread / turn / item event log。
- workspace-write sandbox 和命令 allowlist。
- 简单 RAG：能读取本地 Markdown 文档并引用来源。
- 可选 memory：只在用户明确要求时写入。
- 至少 5 条 eval case。

完成后，再回到 Codex 对照这些问题：

- Codex 为什么把 thread 和 session 分开？
- Codex 为什么需要 app-server，而不是只做 CLI？
- Codex 的 tool router 和 orchestrator 分别解决什么问题？
- Codex 为什么同时有 sandbox、approval、execpolicy 和 guardian？
- Codex 的 memory 为什么要防外部上下文污染？
- Codex 的 skill 为什么是按需注入，而不是常驻 prompt？
