# Agent 开发学习路线

更新时间：2026-05-23

目标：掌握 Agent 开发相关技术，能从零写出一个可运行 Agent，能读懂 Codex / OpenClaw 这类现代 Agent 项目，最后能做出具备工具、记忆、权限、沙箱、评测和可观测性的工程化 Agent。

这份路线不是资料合集，而是一条主线：先理解 Agent，再实现最小闭环，然后学习工具、RAG、记忆、运行时、沙箱、协议、评测和生产化。

## 学习原则

- 每个阶段都要有产出。只看资料不写代码，Agent 很难真正掌握。
- 优先读官方资料和真实项目源码。二手教程只用来降低入门门槛。
- 不要一开始沉迷多 Agent。先把单 Agent 的工具调用、状态、错误处理、权限、评测做好。
- 把 Codex 和 OpenClaw 当作工程样本，不只是当工具使用。
- 每做一个 Agent，都要记录失败案例：工具错调、循环、幻觉、上下文爆炸、权限越界、成本过高。

## 总路线

1. LLM 和 Agent 基础
2. 最小 Agent Loop
3. Tool Use、RAG、Memory
4. Agent Harness 与运行时
5. Coding Agent：以 Codex 为主线
6. Sandbox、安全和权限
7. Skills、MCP、A2A 等能力协议
8. Multi-Agent 编排
9. Evaluation、Tracing、Observability
10. 做一个可交付的个人 Agent 项目

建议周期：8 到 12 周。每天 1 到 2 小时可以跑完第一轮；想真正吃透，需要持续做项目和读源码。

## 阶段 0：建立正确概念

时间：2 到 3 天

你要搞清楚：

- Chatbot、Workflow、Agent、Multi-Agent 的区别。
- Agent 的基本循环：observe -> reason/plan -> act -> observe。
- 什么任务适合 Agent，什么任务更适合普通脚本或固定 workflow。
- Agent 的核心工程问题：工具、状态、上下文、权限、错误恢复、评测。

必读资料：

- Hugging Face Agents Course 中文版  
  https://huggingface.co/learn/agents-course/zh-CN/unit1/what-are-llms
- Hugging Face Agents Course 英文入口  
  https://huggingface.co/learn/agents-course/en/unit0/introduction
- Anthropic: Building effective agents  
  https://www.anthropic.com/engineering/building-effective-agents
- OpenAI: A practical guide to building agents  
  https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf
- Datawhale Agent-Learning-Hub  
  https://github.com/datawhalechina/Agent-Learning-Hub

产出：

- 写一页笔记：Agent 和 Workflow 的区别是什么？
- 写 3 个你自己的 Agent 应用场景，并说明为什么不用普通脚本。

## 阶段 1：写一个最小 Agent Loop

时间：1 周

目标：不用框架，自己写一个最小 Agent。语言建议 Python 或 TypeScript，先不要上复杂框架。

需要实现：

- 调用一个 LLM API。
- 支持 system / user / assistant / tool 消息。
- 定义 2 到 3 个工具，例如 calculator、read_file、search_mock。
- 让模型选择工具。
- 执行工具，把 tool result 放回上下文。
- 设置最大轮数、超时、错误返回和最终答案。

资料：

- OpenAI Agents / Tools 文档入口  
  https://platform.openai.com/docs/guides/agents
- OpenAI Function Calling  
  https://platform.openai.com/docs/guides/function-calling
- OpenAI Agents SDK 文档  
  https://platform.openai.com/docs/guides/agents-sdk/
- Anthropic Tool Use  
  https://docs.anthropic.com/en/docs/agents-and-tools/tool-use/overview

练习项目：

- `mini-agent`：一个 100 到 300 行的命令行 Agent。
- 输入：`帮我计算 23*17，然后解释过程`
- 预期：模型调用 calculator 工具，然后给出答案。

验收标准：

- 工具 schema 明确。
- 工具执行失败时，Agent 不崩溃。
- Agent 不会无限循环。
- 每一步 tool call 都能打印出来。

## 阶段 2：Tool Use、RAG 和 Memory

时间：1 到 2 周

目标：让 Agent 能访问外部知识，而不是只靠模型记忆。

需要掌握：

- Tool registry：工具注册、schema、权限、超时、错误分类。
- RAG：chunk、embedding、vector search、hybrid search、citation。
- Memory：短期上下文、会话记忆、长期记忆、用户偏好。
- Grounding：回答必须带来源，避免编造引用。

资料：

- LlamaIndex Agents  
  https://developers.llamaindex.ai/python/framework/module_guides/deploying/agents/
- LangGraph Overview  
  https://docs.langchain.com/oss/python/langgraph/overview
- Model Context Protocol  
  https://modelcontextprotocol.io/docs/getting-started/intro
- OpenAI File Search / Retrieval 文档入口  
  https://platform.openai.com/docs/guides/tools

参考项目：

- GPT Researcher  
  https://github.com/assafelovic/gpt-researcher
- Open Deep Research  
  https://github.com/langchain-ai/open_deep_research
- Khoj  
  https://github.com/khoj-ai/khoj
- Onyx  
  https://github.com/onyx-dot-app/onyx
- RAGFlow  
  https://github.com/infiniflow/ragflow
- mem0  
  https://github.com/mem0ai/mem0
- Letta  
  https://github.com/letta-ai/letta

练习项目：

- `research-agent`：输入一个主题，自动搜索或读取资料，输出带引用的总结。
- `pdf-qa-agent`：读取本地 PDF 或 Markdown，支持问答并给出来源片段。

验收标准：

- 回答里必须带链接或文件片段引用。
- 找不到资料时明确说找不到。
- 记录每次检索 query 和命中文档。
- 能区分“模型推断”和“资料明确写了”。

## 阶段 3：学习 Agent Harness

时间：1 周

Agent 的能力不只来自模型，更多来自 harness。Harness 是 Agent 的运行外壳，负责工具、状态、权限、上下文、事件流、日志、重试、人工确认和运行生命周期。

需要掌握：

- session / thread / run 的关系。
- event stream：模型输出、工具调用、工具结果、错误、完成事件。
- context compaction：上下文压缩。
- permission gate：危险工具需要确认。
- tool runtime：工具在哪里执行，如何隔离。
- state store：会话状态如何持久化。

资料：

- OpenAI Agents SDK  
  https://platform.openai.com/docs/guides/agents-sdk/
- OpenAI Agents SDK Python  
  https://openai.github.io/openai-agents-python/
- OpenAI Agents SDK JavaScript  
  https://openai.github.io/openai-agents-js/
- LangGraph  
  https://docs.langchain.com/oss/python/langgraph/overview

练习项目：

- 把阶段 1 的 `mini-agent` 改造成 `agent-harness`。
- 增加 run id、event log、tool timeout、approval hook、conversation save/load。

验收标准：

- 一次运行能完整回放。
- 每个 tool call 有唯一 id。
- 每个危险工具有 approval 决策点。
- 上下文超过阈值时能压缩或裁剪。

## 阶段 4：读 Codex，理解 Coding Agent

时间：1 到 2 周

Codex 是学习 coding agent 的好样本，因为它把真实代码库、shell、文件编辑、测试、权限、沙箱、审批和上下文管理都放在一起。

本地重点阅读路径：

- `codex-rs/cli`：CLI 入口。
- `codex-rs/tui`：终端交互界面。
- `codex-rs/core`：核心会话、工具调用、模型交互。
- `codex-rs/exec`：命令执行。
- `codex-rs/protocol`：事件和配置协议。
- `codex-rs/sandboxing`：沙箱管理。
- `codex-rs/linux-sandbox`：Linux 上的 bubblewrap / seccomp 执行。
- `codex-rs/app-server`：长运行服务和 API。

建议阅读顺序：

1. 从 CLI 或 TUI 入口找到一次用户输入如何进入 core。
2. 找到模型返回 tool call 后如何分发到 shell / apply_patch。
3. 找到 approval 和 sandbox 是在哪里决策的。
4. 找到一次 shell 命令如何经过 sandbox manager 执行。
5. 找到工具结果如何回传给模型。
6. 找到会话历史和 context compaction 的处理点。

练习项目：

- 给 `mini-agent` 增加 `read_file`、`list_files`、`apply_patch`、`run_shell`。
- 做一个 `coding-review-agent`：读取 git diff，输出风险、测试建议和修复建议。

验收标准：

- Agent 修改文件前必须展示计划。
- Agent 执行 shell 前必须有权限判断。
- Agent 能运行测试并把失败信息反馈给模型。
- Agent 不直接覆盖用户未授权的文件。

## 阶段 5：沙箱、安全和权限

时间：1 到 2 周

这是你前面重点关心的主题。Agent 一旦能执行 shell、读写文件、访问网络，就必须有安全边界。

需要掌握：

- Linux namespace：mount、pid、user、network、ipc。
- cgroups：CPU、内存、进程数、IO 限制。
- capabilities：去掉 root 的危险能力。
- seccomp：限制 syscall。
- no_new_privs：禁止提权。
- bind mount、read-only mount、tmpfs。
- Docker、bubblewrap、Firecracker、Kata Containers 的差异。

资料：

- bubblewrap  
  https://github.com/containers/bubblewrap
- Docker security  
  https://docs.docker.com/engine/security/
- Seccomp  
  https://man7.org/linux/man-pages/man2/seccomp.2.html
- Linux namespaces  
  https://man7.org/linux/man-pages/man7/namespaces.7.html
- Linux capabilities  
  https://man7.org/linux/man-pages/man7/capabilities.7.html
- Kata Containers  
  https://katacontainers.io/
- Firecracker  
  https://firecracker-microvm.github.io/

本地源码对比：

- Codex：偏“每次命令执行时套沙箱”。
- OpenClaw：偏“为 Agent 或 session 准备运行环境，再通过 backend 执行工具”。

Codex 重点看：

- `codex-rs/sandboxing/src/manager.rs`
- `codex-rs/linux-sandbox/src/linux_run_main.rs`
- `codex-rs/linux-sandbox/src/bwrap.rs`
- `codex-rs/core/src/tools/sandboxing.rs`
- `codex-rs/protocol/src/permissions.rs`

OpenClaw 重点看：

- `/home/goulei/code/openclaw/src/agents/sandbox/types.ts`
- `/home/goulei/code/openclaw/src/agents/sandbox/config.ts`
- `/home/goulei/code/openclaw/src/agents/sandbox/context.ts`
- `/home/goulei/code/openclaw/src/agents/sandbox/docker.ts`
- `/home/goulei/code/openclaw/src/agents/sandbox/docker-backend.ts`
- `/home/goulei/code/openclaw/src/agents/sandbox/workspace-mounts.ts`
- `/home/goulei/code/openclaw/src/agents/sandbox/validate-sandbox-security.ts`

练习项目：

- `sandbox-lab`：实现两个 backend。
- backend 1：bubblewrap runner。
- backend 2：Docker runner。
- 支持 workspace read-only、workspace read-write、network off、tmpfs、resource limit。

攻击测试：

- 读 `~/.ssh` 应失败。
- 读 `~/.codex/auth.json` 应失败。
- 写 workspace 外文件应失败。
- 访问网络应按配置允许或拒绝。
- 挂载 Docker socket 应默认拒绝。
- symlink 绕过 workspace 应失败。
- fork bomb 或大内存申请应被限制。

验收标准：

- 沙箱策略是显式配置，不靠注释约束。
- 每次执行都有 audit log。
- 默认拒绝危险能力。
- elevated / unsandboxed 执行必须走人工确认。

## 阶段 6：Skills、MCP、A2A 和能力包装

时间：1 周

现代 Agent 不只是“模型 + 工具”。还需要可复用能力包和跨系统协议。

需要掌握：

- Tool：一个可调用接口。
- Skill：一份可复用操作手册，通常包含 `SKILL.md`、脚本、模板、资源。
- MCP：把外部工具和数据源暴露给 Agent。
- A2A：Agent 与 Agent 之间的通信协议。
- ACP / App protocol：宿主应用和 Agent 的集成协议。

资料：

- Model Context Protocol  
  https://modelcontextprotocol.io/docs/getting-started/intro
- MCP GitHub  
  https://github.com/modelcontextprotocol
- A2A Specification  
  https://a2aproject.github.io/A2A/latest/specification/
- A2A GitHub  
  https://github.com/a2aproject/A2A
- Agent Client Protocol  
  https://agentclientprotocol.com/

练习项目：

- 写一个 MCP server，提供 `search_notes` 和 `read_note`。
- 写一个 `SKILL.md`，让 Agent 知道什么时候调用这个 MCP server。
- 把阶段 2 的 `research-agent` 改成通过 MCP 获取资料。

验收标准：

- MCP server 有明确 tool schema。
- Skill 不是长 prompt，而是可执行步骤。
- Agent 能根据任务自动发现该用哪个 skill。
- 资料读取权限可控，不把整个用户目录暴露给 Agent。

## 阶段 7：Multi-Agent 编排

时间：1 周

Multi-Agent 不是让多个角色自由聊天，而是任务拆分、职责边界和状态编排。

需要掌握：

- planner / executor / reviewer / critic / router。
- supervisor 模式。
- graph 编排。
- handoff。
- 子 Agent 的输入输出 schema。
- 停止条件和循环检测。

资料：

- LangGraph Multi-Agent / Orchestration 入口  
  https://docs.langchain.com/oss/python/langgraph/overview
- OpenAI Agents SDK Orchestration 入口  
  https://platform.openai.com/docs/guides/agents-sdk/
- A2A Protocol  
  https://a2aproject.github.io/A2A/latest/specification/

练习项目：

- `multi-agent-writer`：researcher -> writer -> reviewer -> reviser。
- `coding-agent-team`：planner -> coder -> test-runner -> reviewer。

验收标准：

- 每个 Agent 的职责边界明确。
- 每步输入输出是结构化的。
- reviewer 不能直接改代码，只能给意见。
- coordinator 能判断任务完成或失败。

## 阶段 8：评测、Tracing 和可观测性

时间：1 周

没有评测的 Agent 只能算 demo。你需要知道它什么时候会失败、为什么失败、改动后有没有退化。

需要掌握：

- 固定测试集。
- 成功率、成本、延迟、工具调用次数。
- trace：每一轮模型调用和工具调用。
- 回归测试。
- prompt / tool / retrieval / state 的失败归因。
- 线上日志脱敏。

资料：

- OpenAI Agent Evals  
  https://platform.openai.com/docs/guides/agent-evals
- OpenAI Evals  
  https://platform.openai.com/docs/guides/evals
- LangSmith  
  https://docs.smith.langchain.com/
- OpenTelemetry GenAI Semantic Conventions  
  https://opentelemetry.io/docs/specs/semconv/gen-ai/
- SWE-bench  
  https://www.swebench.com/
- AgentBench  
  https://github.com/THUDM/AgentBench

练习项目：

- 给前面任意一个 Agent 加 eval。
- 准备 20 个任务，记录期望结果、实际结果、失败原因。
- 输出一个 markdown 或 CSV 评测报告。

验收标准：

- 每个失败都能归类。
- 每次改 prompt 或工具后能跑回归。
- trace 能定位到是哪一步失败。
- 成本和延迟可统计。

## 阶段 9：做一个可交付项目

时间：2 到 4 周

建议选一个你真的会长期用的 Agent。不要做纯 demo。

推荐项目方向：

- `personal-research-agent`：研究资料、保存笔记、输出引用报告。
- `coding-review-agent`：读取 PR diff，输出风险和测试建议。
- `repo-maintainer-agent`：自动整理 issue、生成修复计划、运行测试。
- `local-personal-agent`：接入本地文件、日历、消息，但有严格权限。
- `sandboxed-coding-agent`：具备 shell、patch、test、sandbox、approval。

交付标准：

- 有 README。
- 有配置文件示例。
- 有最小运行命令。
- 有 10 到 20 个 eval cases。
- 有 trace 或 event log。
- 有权限和安全说明。
- 有失败案例记录。

## 主线学习顺序

如果你想最稳地学，照这个顺序做：

1. Hugging Face Agents Course 中文版，快速过一遍概念。
2. Anthropic Building effective agents，建立工程判断。
3. 自己写 `mini-agent`，不要用框架。
4. 做 `research-agent`，补 RAG、工具、引用。
5. 读 Codex 的 shell、patch、sandbox、approval 流程。
6. 读 OpenClaw 的 sandbox、gateway、skills、session 设计。
7. 做 `sandbox-lab`，把安全边界跑通。
8. 学 MCP，写一个 MCP server。
9. 学 LangGraph 或 OpenAI Agents SDK，理解 harness 和 orchestration。
10. 给你的 Agent 加 eval、trace、权限、README。

## 每周安排

第 1 周：

- 看 HF Agents Course 第 1 单元。
- 看 Anthropic 文章。
- 写 `mini-agent`。

第 2 周：

- 学 tool schema、tool result、错误处理。
- 给 `mini-agent` 加 3 个工具。
- 输出 event log。

第 3 周：

- 学 RAG。
- 做 `research-agent` 或 `pdf-qa-agent`。
- 要求回答带引用。

第 4 周：

- 学 Agent harness。
- 给 Agent 加 session、run id、approval、trace。

第 5 周：

- 读 Codex。
- 跑通 Codex build 和简单 exec。
- 画一张“用户输入到 shell 执行”的流程图。

第 6 周：

- 读 OpenClaw。
- 对比 Codex 和 OpenClaw 的 sandbox 设计。
- 写一页对比笔记。

第 7 周：

- 做 `sandbox-lab`。
- 跑攻击测试。
- 明确 Docker、bubblewrap、Kata、Firecracker 的适用场景。

第 8 周：

- 学 MCP / Skills。
- 写一个 MCP server。
- 写一个 `SKILL.md`。

第 9 周：

- 学 LangGraph 或 OpenAI Agents SDK。
- 做一个 multi-agent 小项目。

第 10 周：

- 给所有项目加 eval 和 trace。
- 选一个项目打磨到可交付。

## 需要掌握的关键词清单

基础：

- LLM
- token
- context window
- structured output
- function calling
- tool calling
- ReAct
- planning
- reflection

工程：

- agent loop
- tool registry
- tool schema
- run / thread / session
- event stream
- context compaction
- approval gate
- retry / timeout
- idempotency
- audit log

知识与记忆：

- RAG
- embedding
- vector database
- hybrid search
- reranking
- citation
- short-term memory
- long-term memory
- user preference

安全：

- sandbox
- namespace
- cgroup
- seccomp
- capability
- no_new_privs
- bind mount
- read-only filesystem
- network isolation
- prompt injection
- data exfiltration

协议与生产化：

- MCP
- A2A
- ACP
- OpenTelemetry
- tracing
- evals
- guardrails
- human-in-the-loop

## 推荐源码阅读清单

优先级 1：

- Codex  
  https://github.com/openai/codex
- OpenClaw  
  本地路径：`/home/goulei/code/openclaw`
- Datawhale Agent-Learning-Hub  
  https://github.com/datawhalechina/Agent-Learning-Hub

优先级 2：

- LangGraph  
  https://github.com/langchain-ai/langgraph
- OpenAI Agents SDK Python  
  https://github.com/openai/openai-agents-python
- OpenAI Agents SDK JavaScript  
  https://github.com/openai/openai-agents-js
- LlamaIndex  
  https://github.com/run-llama/llama_index

优先级 3：

- GPT Researcher  
  https://github.com/assafelovic/gpt-researcher
- Open Deep Research  
  https://github.com/langchain-ai/open_deep_research
- Khoj  
  https://github.com/khoj-ai/khoj
- Letta  
  https://github.com/letta-ai/letta

## 不建议作为主线的方向

- 一上来重押“角色扮演式 multi-agent”框架。
- 只调框架 API，不理解 agent loop。
- 只看 prompt，不做工具、状态、权限、评测。
- 不加 sandbox 就让 Agent 执行 shell。
- 不做 eval，只凭几次 demo 判断效果。

## 最终验收

当你能完成下面这些事，说明 Agent 开发已经入门到工程层面：

- 能手写一个最小 Agent loop。
- 能设计 tool schema 和 tool error。
- 能做 RAG 并给引用。
- 能解释 Codex 的 shell / patch / sandbox / approval 流程。
- 能解释 OpenClaw 的 session sandbox 和 backend 设计。
- 能写一个 MCP server。
- 能写一个可复用 skill。
- 能给危险工具加人工确认。
- 能用 eval 和 trace 定位 Agent 失败。
- 能交付一个别人能 clone 下来运行的 Agent 项目。
