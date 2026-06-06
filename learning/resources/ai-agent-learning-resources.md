# AI 素养与 Agent 学习资源

这份资源清单按学习层次组织：先补 AI 素养，再学习提示词和大模型使用，接着进入 Agent 基础，最后回到生产级 coding agent 工程。

## 1. AI 素养入门

适合目标：理解 AI 是什么、能做什么、不能做什么，以及普通工作场景如何使用 AI。

- [Elements of AI](https://www.elementsofai.com/)
  - 适合非技术和技术背景学习者。
  - 重点：AI 基础概念、局限性、社会影响。

- [Google AI Essentials](https://grow.google/ai-essentials/)
  - 偏工作生产力。
  - 重点：如何把 AI 用到日常办公、分析、写作和任务处理中。

- [Microsoft AI Learning Hub](https://learn.microsoft.com/ai)
  - 微软官方 AI 学习入口。
  - 重点：AI 基础、Copilot、Azure AI、企业应用。

## 2. Prompt 与大模型使用

适合目标：学会和大模型协作，能清晰描述任务、给上下文、迭代结果。

- [OpenAI Academy: Prompting Fundamentals](https://openai.com/academy/prompting/)
  - OpenAI 官方提示词基础。
  - 重点：如何写清楚目标、上下文、约束和输出格式。

- [OpenAI Prompting Guide](https://platform.openai.com/docs/guides/prompting)
  - 偏开发者。
  - 重点：结构化提示、任务拆解、工具调用前的指令设计。

- [OpenAI Help: Prompt Engineering Best Practices](https://help.openai.com/en/articles/6654000-best-practices-for-prompt-engineering-with-openai-api)
  - 适合当速查表。
  - 重点：清晰指令、示例、分隔符、分步推理和结果校验。

## 3. Agent 基础

适合目标：理解 agent 和普通 chatbot 的区别，掌握 tool use、workflow、多 agent、human-in-the-loop 等基本概念。

- [Anthropic: Building Effective Agents](https://www.anthropic.com/research/building-effective-agents)
  - 强烈推荐。
  - 重点：workflow 与 agent 的区别、工具调用、多 agent 编排、工程边界。

- [Hugging Face Agents Course](https://huggingface.co/learn/agents-course/en/unit0/introduction)
  - 更课程化，适合动手。
  - 重点：Thought-Action-Observation、ReAct、工具、agent 框架。

- [OpenAI Agents SDK Docs](https://openai.github.io/openai-agents-js/guides/agents/)
  - OpenAI 官方 Agents SDK 文档。
  - 重点：Agent、Runner、tool、handoff、tracing 等工程抽象。

## 4. Coding Agent 与工程化

适合目标：进入生产级 coding agent 开发，理解安全执行、工具编排、上下文管理、会话恢复和客户端协议。

- [Codex Documentation](https://developers.openai.com/codex)
  - Codex 官方产品和使用文档。
  - 重点：Codex CLI、IDE、认证、配置、使用方式。

- [Codex 生产级 Coding Agent 学习总览](../codex/production-coding-agent-overview.md)
  - 本仓库沉淀的源码学习地图。
  - 重点：Codex 主链路、工具系统、安全执行、MCP、多 agent、TUI/app-server。

- [Model Context Protocol 官方规范](https://modelcontextprotocol.io/specification/latest)
  - MCP 官方协议文档。
  - 重点：agent 如何标准化连接外部工具、数据源和上下文。

- [MCP GitHub Spec](https://github.com/modelcontextprotocol/modelcontextprotocol)
  - MCP 规范仓库。
  - 重点：协议定义、schema、演进记录。

## 推荐学习顺序

1. 先读 `Elements of AI` 或 `Google AI Essentials`，补 AI 素养。
2. 学 OpenAI prompting 文档，练习任务拆解和结果校验。
3. 读 Anthropic 的 `Building Effective Agents`，建立 agent 工程观。
4. 做 Hugging Face Agents Course，动手理解工具调用循环。
5. 回到本仓库，按 `../codex/production-coding-agent-overview.md` 阅读 Codex 主链路。
6. 学 MCP、权限、沙箱和多 agent，进入生产级 agent 的核心问题。

## 对照学习建议

如果只看 Codex，容易被生产复杂度淹没。可以用下面的方式对照：

- `pi-mono`：看最小 agent loop 和 TypeScript agent 工程。
- `codex`：看生产级 coding agent 的安全、协议、工具和多 agent。
- `openclaw`：后续再看个人 AI assistant 平台化、多通道和插件生态。

主线仍然建议以 `codex` 为主。
