# 可运行案例：可切换模型 Provider 的 Agent 集成 MCP

## 学习目标

这个案例复用 [任务板 MCP Server](../mcp-task-board/README.md)，增加一个最小 Agent Host。用户只提交自然语言目标，OpenRouter 或 MiMo 上的模型决定调用哪个 Function Tool；Host 再把模型调用转换成 MCP `tools/call`，将结果作为 Tool Message 写回模型对话，直到模型不再调用 Tool。默认 Provider 是 OpenRouter，可以用环境变量或命令行参数切换，Agent Loop 和 MCP Bridge 不随 Provider 改变。

```text
User
  ↓ natural language
Agent Loop ────────────────> OpenAI-compatible Chat Completions
  │                             │
  │ MCP Tool → Function Tool    │ tool_calls
  │                             ↓
  └── MCP Bridge → tools/call → Task Board MCP Server
           ↑                         │
           └──── CallToolResult ─────┘
                    ↓
             role=tool message
                    ↓
                 Model
```

运行后应能解释：

1. `tools/list` 返回的 MCP Tool 为什么不能不经处理地直接交给模型；
2. Host 怎样把 `inputSchema` 映射为模型 Function Tool 的 `parameters`；
3. 模型 `tool_call.id` 与 MCP JSON-RPC Request ID 为什么必须分别保存；
4. `CallToolResult` 怎样成为下一轮模型可见的 Tool Message；
5. 为什么模型没有返回 `tool_calls` 时，是 Agent Loop 而不是 MCP Server 判断任务结束；
6. Resource 为什么没有自动变成模型 Tool。

## 文件关系

先打开 [mcp_bridge.py](mcp_bridge.py)。`McpBridge.start` 完成 MCP 初始化和 Tool 发现，`model_tools` 把 MCP Definition 转成 OpenAI-compatible Function Tool，`call_tool` 负责协议路由和 Result 解包。阅读到 `read_task_board` 后停下来，注意 Resource 仍由 Host 显式读取，没有混入模型 Tool Catalog。

再打开 [llm_client.py](llm_client.py)。`ProviderPreset` 保存各 Provider 的默认 Endpoint、模型、认证方式和少量请求差异，`OpenAICompatibleClient` 统一读取配置、发送 Chat Completions 请求并校验响应，不知道 MCP 的存在。OpenRouter 使用 Bearer Token 和 `max_tokens`；MiMo 使用 `api-key`、`max_completion_tokens`，还可以附加 `thinking`。这些差异停在模型边界，没有进入 Agent Loop。

最后打开 [agent.py](agent.py)。`run_agent` 是唯一的循环：调用模型、保存 Assistant Message、执行每个 Tool Call、追加 `role=tool` Observation，然后进入下一轮。业务状态、MCP Transport 和模型 Provider 没有被揉进这个循环。

## 首选路径：OpenRouter 免费模型

在 OpenRouter 创建 API Key。案例默认使用免费模型路由：

```text
Provider openrouter
API URL  https://openrouter.ai/api/v1/chat/completions
Model    openrouter/free
Header   Authorization: Bearer $OPENROUTER_API_KEY
```

`openrouter/free` 会在当前免费模型中筛选满足请求能力的模型；本案例传入了 `tools`，因此路由器会筛选支持 Tool Calling 的候选模型。免费模型的可用性和输出稳定性可能变化，适合学习和低频演示，不应当作为生产依赖。API Key 只从环境变量读取，不写入源码、参数、日志或 MCP 消息。

Linux 或 macOS：

```bash
export OPENROUTER_API_KEY="你的 API Key"
python3 learning/knowledge_framework/cases/agent-mcp-demo/agent.py
```

PowerShell：

```powershell
$env:OPENROUTER_API_KEY="你的 API Key"
python learning/knowledge_framework/cases/agent-mcp-demo/agent.py
```

使用 `openrouter/free` 不消耗付费模型额度，但受免费请求限额和容量限制。不要把真实 Key 写进 `README.md`、`.vscode/launch.json`、Shell History 或提交记录。

## 切换 Provider

命令行参数优先表达本次运行选择：

```bash
python3 learning/knowledge_framework/cases/agent-mcp-demo/agent.py \
  --provider openrouter
```

也可以为一个终端会话设置默认 Provider：

```bash
export LLM_PROVIDER=mimo
export MIMO_API_KEY="你的 MiMo API Key"
python3 learning/knowledge_framework/cases/agent-mcp-demo/agent.py
```

`--provider` 当前支持 `openrouter` 和 `mimo`。切换只改变模型 API 边界：MCP Server、MCP Bridge、Tool Definition、Tool Result 和 Agent Loop 都保持不变。

## 配置项

通用覆盖项优先级高于 Provider 专用配置，适合在部署环境里使用一套变量名：

| 环境变量 | 默认值 | 用途 |
| --- | --- | --- |
| `LLM_PROVIDER` | `openrouter` | 未传 `--provider` 时选择 Provider |
| `LLM_API_KEY` | 无 | 覆盖所选 Provider 的 API Key |
| `LLM_MODEL` | Provider 默认模型 | 覆盖模型名称 |
| `LLM_API_URL` | Provider 默认 Endpoint | 覆盖完整 Chat Completions URL |
| `LLM_TIMEOUT_SECONDS` | `60` | 覆盖单次 HTTP 请求超时 |

Provider 专用变量适合在同一台机器保存多组配置：

| Provider | API Key | Model | API URL | 其他 |
| --- | --- | --- | --- | --- |
| OpenRouter | `OPENROUTER_API_KEY` | `OPENROUTER_MODEL` | `OPENROUTER_API_URL` | `OPENROUTER_TIMEOUT_SECONDS` |
| MiMo | `MIMO_API_KEY` | `MIMO_MODEL` | `MIMO_API_URL` | `MIMO_TIMEOUT_SECONDS`、`MIMO_THINKING` |

`LLM_API_URL`、`OPENROUTER_API_URL` 和 `MIMO_API_URL` 都必须填写包含 `/chat/completions` 的完整地址，而不是只填写 `/v1`。MiMo Token Plan 的 URL 以控制台展示为准。

## 先做无 Key 检查

`--check` 不访问任何模型 API，也不要求 API Key。它会启动任务板 Server、完成 MCP 初始化、发现 Tool、执行 Definition 转换并读取 Resource：

```bash
python3 learning/knowledge_framework/cases/agent-mcp-demo/agent.py --check
```

看到 `CHECK PASSED` 说明本地 MCP Bridge 正常，但不代表 API Key、网络或模型 Tool Calling 已验证。客户端单元测试同样不访问网络：

```bash
python3 -m unittest discover \
  -s learning/knowledge_framework/cases/agent-mcp-demo \
  -p '*_tests.py'
```

## 运行真实 Agent

默认任务要求模型先新增任务，再根据返回的 ID 完成它：

```bash
python3 learning/knowledge_framework/cases/agent-mcp-demo/agent.py
```

也可以传入自己的目标：

```bash
python3 learning/knowledge_framework/cases/agent-mcp-demo/agent.py \
  "请添加任务‘理解 MCP Result’，完成它，并总结执行结果"
```

增加 `--trace-mcp` 可以查看 MCP 原始 JSON-RPC 消息：

```bash
python3 learning/knowledge_framework/cases/agent-mcp-demo/agent.py --trace-mcp
```

输出会分别标记：

```text
MODEL tool_call.id=call_xxx
MCP   request id=4
MCP   response id=4
```

三个层次不要合并：模型 Tool Call ID 用于配对 Assistant Tool Call 与 `role=tool` Message；MCP Request ID 只在一条 MCP 连接上配对 JSON-RPC Request 和 Response；Agent Turn 则控制一次模型推理和循环预算。

## VS Code 运行

安装 Microsoft Python、Pylance、Python Debugger 和 Ruff 插件，选择 Python 3.10+ 解释器。为了避免把 Key 固化在共享配置中，建议在 VS Code 集成终端设置 `OPENROUTER_API_KEY` 后，从同一终端运行上述命令。

在 `agent.py` 的 `run_agent` 中打断点可以观察 Agent Loop。MCP Server 是子进程；普通启动配置不会自动命中 `server.py` 内的断点。学习协议消息时优先使用 `--trace-mcp`，需要调试 Server 实现时单独为子进程配置 debugpy。

## 安全与实现边界

这是教学案例，不是生产 Agent。它实现了 Tool Allowlist、参数 JSON 解析、最大 Turn、HTTP Timeout 和 API 错误截断，但有意省略审批 UI、Sandbox、重试、并行 Tool Call、取消、流式输出、Token 预算、持久化、遥测和 Prompt Injection 隔离。

案例把 `resources/read` 用作执行后的 Host 验证，没有自动把 Resource 注入模型。生产 Host 必须明确选择 Resource、检查权限和 Provenance，并设置内容上限；“Server 提供了 Resource”不等于“每轮都应把它放进模型上下文”。

进一步练习可以先加入 `complete_task` 的人工审批，再让 Server 返回一次可纠正的业务错误。观察 Approval 属于 Host Policy，而 `isError: true` 属于 Tool Observation，两者不能互相替代。

## 参考

- [OpenRouter API Authentication](https://openrouter.ai/docs/api/reference/authentication)
- [OpenRouter Free Models Router](https://openrouter.ai/docs/cookbook/get-started/free-models-router-playground)
- [OpenRouter Tool Calling](https://openrouter.ai/docs/guides/features/tool-calling)
- [MiMo Chat Completions API Compatibility](https://mimo.mi.com/docs/api/chat/openai-api)
- [MiMo API Integration FAQ](https://mimo.mi.com/docs/en-US/quick-start/faq/api-integration)
- [MCP 2025-11-25 Tools](https://modelcontextprotocol.io/specification/2025-11-25/server/tools)
- [MCP 2025-11-25 Lifecycle](https://modelcontextprotocol.io/specification/2025-11-25/basic/lifecycle)
