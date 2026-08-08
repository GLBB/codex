# Learning

这个目录收集 Agent 与 Codex 源码学习材料。根目录只保留入口索引，正文按用途分区，方便从学习路线进入，也方便单独查资料。

## 推荐入口

1. [Agent 开发学习路线](roadmaps/agent-learning-roadmap.md)
2. [AI 素养与 Agent 学习资源](resources/ai-agent-learning-resources.md)
3. [Agent 开发系列教程](codex/agent-course/README.md)
4. [Agent 开发主题学习指南](codex/agent-topic-guide.md)
5. [Codex 生产级 Coding Agent 学习总览](codex/production-coding-agent-overview.md)
6. [codex-rs 深度研究专题](codex/deep-research/README.md)
7. [Codex 源码分析专库](codex/codex-source-analysis/README.md)
8. [codex-core 源码阅读指南](codex/core-source-guide/README.md)

## 目录结构

| 目录 | 内容 |
| --- | --- |
| `articles/` | 外部文章和白皮书的中文精读版 |
| `roadmaps/` | 主线学习路线和阶段安排 |
| `resources/` | 外部课程、文档、规范和补充材料 |
| `codex/` | Codex 源码阅读地图和工程化笔记 |
| `references/` | PDF 等原始参考材料 |
| `assets/` | Markdown 正文引用的图片资源 |

## 已整理材料

| 材料 | 用途 |
| --- | --- |
| [Building effective agents 中文精读版](articles/building-effective-agents.zh.md) | 建立 workflow / agent 的工程边界 |
| [A practical guide to building agents 中文精读版](articles/a-practical-guide-to-building-agents.zh.md) | 学习 Agent 设计、编排和 guardrails |
| [Agent 开发系列教程](codex/agent-course/README.md) | 从运行项目开始，按 13 课一步一步学习 Agent 工程，并覆盖常见 Agent 面试追问 |
| [Agent 开发主题学习指南](codex/agent-topic-guide.md) | 按工具、Session、记忆、RAG、沙箱、MCP、Skills 等主题对照 Codex 源码 |
| [Codex 生产级 Coding Agent 学习总览](codex/production-coding-agent-overview.md) | 按主链路阅读 Codex 源码 |
| [codex-rs 深度研究专题](codex/deep-research/README.md) | 12 篇专题报告，系统研究架构、主循环、上下文、工具、安全、app-server、TUI、扩展、状态、多 agent 和测试观测 |
| [codex-rs 项目演进史](codex/codex-rs-evolution-history.md) | 从 Git 历史梳理 Rust 版 Codex 的阶段、架构和功能演进 |
| [codex-rs 深度研究覆盖矩阵](codex/codex-rs-deep-research-coverage.md) | 对照深度研究主题检查 `learning/` 的覆盖范围和缺口 |
| [Codex 源码分析专库](codex/codex-source-analysis/README.md) | 独立维护的 25 章源码分析、专题附录与最新源码研究材料 |
| [Codex Query 处理流程](codex/query-processing-flow.md) | 跟踪一条用户 query 从入口到模型、工具、日志和持久化的执行过程 |
| [codex-core 源码阅读指南](codex/core-source-guide/README.md) | 面向 Rust 开发者，按启动、Turn、Prompt、工具循环、Rollout 与恢复系统跟读 `codex-rs/core/` |
| [ThreadManager Sample Debug 源码跟读](codex/thread-manager-sample-debug-flow.md) | 以 `thread-manager-sample` 为最小 debug 入口，梳理 `ThreadManager`、`CodexThread`、`Session`、`RegularTask` 和 `run_turn` 调用链 |
| [AI 素养与 Agent 学习资源](resources/ai-agent-learning-resources.md) | 补齐外部课程和官方文档 |
