# 知识框架可运行案例

本目录统一保存跨知识专题的可运行案例。概念文档负责建立术语和设计边界，案例负责把多个概念放入同一条执行链中验证。专题学习地图可以链接到这里，但不在各专题目录内重复维护案例代码。

## 案例目录

| 案例 | 对应专题 | 主要观察对象 |
| --- | --- | --- |
| [任务板 MCP Server](mcp-task-board/README.md) | [MCP](../mcp/README.md) | 初始化、发现、Resource、Tool、Request ID、业务失败和 stdio |
| [可切换模型 Provider 的 Agent 集成 MCP](agent-mcp-demo/README.md) | [MCP](../mcp/README.md) | OpenRouter/MiMo Tool Calling、Provider 边界、MCP Tool 转换、Agent Loop、Tool Result 回写和三种 ID |

## 组织约定

每个案例使用独立目录，并至少包含一份 `README.md`，说明学习目标、文件关系、运行方法、观察路径和有意省略的生产能力。可执行代码应提供无需阅读实现就能运行的入口，并通过断言或测试给出明确的成功与失败状态。

案例命名使用专题前缀，例如 `mcp-task-board`。一个案例如果同时覆盖多个专题，只保留一个实现，在相关学习地图中分别链接，避免复制后逐渐产生不同语义。
