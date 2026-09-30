# 工程侧 OpenTelemetry Trace 设计

**目标：**在 Hera 打开一条 trace，能看清云 Agent 的执行路径、耗时、错误、重试及跨服务调用。下面是**拟设计**，尚未在自研 Agent / Hera 验收。工程 trace 默认不存模型或工具原文；完整交互内容留给算法 trace 方案。

**原则：**一个用户 turn 一个 trace；有持续时间的操作建 span，关键时间点才考虑 span event。模型调用与它触发的工具是兄弟节点；实际发生什么，才展示什么。`app.agent.*` 均为本项目自定义字段。

## 1. Codex 与 DeepSeek Harness 的实际做法

### Codex：已有执行 trace，但粒度偏细

本机 Langfuse `Codex Native OTel` 项目，通过 Observation API 查看：

| Trace ID 前缀 | 实际观察 | 对本方案的启发 |
| --- | --- | --- |
| `89221ded…` | `turn/start` 24 ms，整轮 `session_task.turn` 347 s；16,586 个节点里约 80% 是 `receiving` / `handle_responses`。 | 区分入口受理与整轮；逐流片段不建 span。 |
| `984fd959…` | 一次 `run_sampling_request` 下有 7 个尝试边界。 | 逻辑模型调用覆盖重试，传输尝试单独记录。 |
| `f9a26fc3…` | `mcp.tools.call` 记录 MCP 客户端调用、工具名、地址与约 494 ms 耗时。 | MCP 工具在主树中必须可辨认。 |
| `f58cf58b…` | `run_auto_compact` 约 113 s，子树含模型请求；`run_pre_sampling_compact` 是极短检查。 | 真正执行的压缩建 span，未触发的检查不常态展示。 |
| `941e4338…` | 同一 OTel trace ID 下出现两个不同 turn ID。 | 本项目明确用户 turn 与 trace 的边界，并记录业务 turn ID。 |

Codex 可出现的主要 span 如下；名称来自源码及所查样本，**不是 GenAI 标准 span 名清单**：

| 行为 | Codex span 例子 | 本方案取舍 |
| --- | --- | --- |
| 入口与整轮 | `turn/start`、`session_task.turn` | 保留短入口与整轮两个边界。 |
| 模型循环与传输 | `run_sampling_request`、`try_run_sampling_request`、`model_client.stream_responses_websocket` / `model_client.stream_responses_api` | 汇成可读的逻辑模型调用，传输尝试按需展开。 |
| 工具与 MCP | `handle_tool_call_with_source`、`exec`、`mcp.tools.call` | 展示工具 / MCP 操作与失败；折叠内部路由。 |
| 压缩 | `run_auto_compact`、`run_pre_sampling_compact` | 展示实际压缩，折叠短检查。 |
| 上下文准备与逐片处理 | `build_prompt`、`mcp.runtime.resolve_for_step`、`receiving`、`handle_responses` | 有显著耗时才显示准备；逐片处理默认不建 span。 |

`session_task.turn` 由任务持有，入口请求结束后仍可覆盖整轮；`mcp.tools.call` 记录服务、工具、传输、错误类别和业务 ID。这两点值得借鉴。[整轮 span 源码](../../../codex-rs/core/src/tasks/mod.rs)、[模型 / 流处理源码](../../../codex-rs/core/src/session/turn.rs)、[模型传输源码](../../../codex-rs/core/src/client.rs)、[MCP 调用源码](../../../codex-rs/core/src/mcp_tool_call.rs)、[本地样本摘要](../assets/langfuse-install-turn-evidence.json)。

子 Agent 的启动与等待是不同生命周期，参考 [Codex `spawn_agent`](../../../codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs) 和 [`wait_agent`](../../../codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs)；**本地样本未证明 Codex 已输出标准 `invoke_agent` 子 Agent span**。样本与当前源码不是同一提交；上表说明可能出现的节点，不保证每次运行都有全部节点。

### DeepSeek Harness：接入 OTel Logs，未见 Agent span 树

所查版本 `639ed01` 的 `dsh-otel` 提供**产品事件**与**Session 日志**两个独立 OTLP Logs 通道；源码创建 `LoggerProvider`，依赖含 `sdk-logs`，未见 trace provider 或 Agent span 埋点。Session 日志经反馈授权后捕获，按 `sessionId`、事件序号关联，另设请求字节上限和独立队列。因此 DSH 的 OTel 接入**不能当成工程 trace 案例**；可借鉴的是把完整 Session 内容与低体积工程 span 分通道，并为内容通道单独设采集策略和容量上限。[OTel 服务](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/telemetry/otel/src/index.ts)、[产品事件通道](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/telemetry/otel/src/event-log.ts)、[Session 日志通道](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/telemetry/otel/src/session-log.ts)。

## 2. 目标 trace 案例

树中 `CLIENT / SERVER / INTERNAL` 是 span kind；标有“若发生”的节点仅在该功能实际执行时出现。树形表示父子关系，**上下顺序不代表串行**。HTTP/DB 等传输节点可在 Hera 默认折叠。

### 案例 A：普通模型—工具循环与重试

```text
POST /agent/turns               SERVER    入口请求
└── invoke_agent cloud-agent   INTERNAL  用户 turn
    ├── app.agent.step         INTERNAL  Step 1
    │   ├── chat model-A        CLIENT    逻辑模型调用
    │   │   ├── HTTP POST /model CLIENT   尝试 1
    │   │   └── HTTP POST /model CLIENT   尝试 2（仅重试时）
    │   └── execute_tool calc  INTERNAL  模型选中的本地工具
    └── app.agent.step         INTERNAL  Step 2
        └── chat model-A        CLIENT    最终回答
```

模型与工具同属 Step 1；工具时间不算入 `chat`。逻辑模型 span 的 usage 汇总可计费尝试，传输 span 不重复计 token。`app.agent.step` 是本项目自定义的循环边界，不是 GenAI 标准操作。若请求使用多模态生成 API，用相应的 `generate_content`，不要强行命名 `chat`。[GenAI 模型与工具规范](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-spans.md)。

### 案例 B：会话历史、长期记忆、MCP 与知识库

```text
invoke_agent cloud-agent        INTERNAL
├── app.agent.load_context     INTERNAL  组装本轮上下文（若有独立耗时）
│   ├── DB SELECT session      CLIENT    读取本会话历史
│   └── search_memory          CLIENT    查询长期记忆（若启用）
│       └── HTTP POST /memory  CLIENT    记忆服务传输（若采集）
├── app.agent.step             INTERNAL
│   ├── chat model-A            CLIENT
│   └── tools/call search_docs  CLIENT    MCP 工具调用
│       ├── HTTP POST /mcp      CLIENT    MCP 传输（若使用 HTTP 且采集）
│       │   └── HTTP POST /mcp  SERVER    MCP 服务的 HTTP 入口（若接入 OTel）
│       └── tools/call search_docs SERVER MCP 服务端；link → HTTP SERVER
│           └── retrieval kb   CLIENT    实际检索知识库
└── upsert_memory              CLIENT    同步写回长期记忆（若发生）
```

`DB SELECT session` 是会话历史读取；`search_memory` / `upsert_memory` 是长期记忆库操作；`retrieval` 是知识库检索。三者的业务含义不同。模型主动调用本地记忆工具时，`search_memory` 放在 `execute_tool memory_search` 下；若通过 MCP，放在服务端 `tools/call` 下。异步写回若跨越本 turn 生命周期，则另起 trace，用 span link 和 `turn_id` 关联。[GenAI Memory](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-spans.md#memory)、[MCP 约定](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/mcp.md)。

`tools/call search_docs` 的同一个 CLIENT span 同时设置 `mcp.method.name=tools/call` 与 `gen_ai.operation.name=execute_tool`，不再套同义的 `execute_tool search_docs`。MCP 服务端从请求 `params._meta.traceparent` 提取 **MCP CLIENT span** 为父；HTTP CLIENT / SERVER 属另一条传输分支，MCP SERVER 可 link 到当时的 HTTP SERVER span。[MCP 官方示例](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/mcp.md#streamable-http)。

### 案例 C：中途压缩与下一次模型调用

```text
invoke_agent cloud-agent          INTERNAL
├── app.agent.step               INTERNAL
│   └── chat model-A              CLIENT    发现上下文接近上限
├── app.agent.compact_context    INTERNAL  实际压缩（若发生）
│   └── chat model-A              CLIENT    压缩调用（仅模型压缩时）
└── app.agent.step               INTERNAL
    └── chat model-A              CLIENT    使用压缩后的上下文
```

`app.agent.compact_context` 是自定义 span：记录触发原因、压缩前后 token 数和方法。压缩用模型才有子 `chat`；若调用独立压缩接口，则是相应 HTTP/模型服务节点。没有执行压缩时不创建该 span。后续实际使用压缩上下文的模型 span 设置标准属性 `gen_ai.conversation.compacted=true`。[压缩标记](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-spans.md)。

### 案例 D：异步子 Agent；跨服务时怎么变

```text
invoke_agent cloud-agent              INTERNAL  主 Agent
├── app.agent.step                    INTERNAL
│   ├── chat model-A                   CLIENT
│   └── execute_tool spawn_agent      INTERNAL  返回子任务 ID 即结束
├── invoke_agent research-agent       INTERNAL  子 Agent 可与主 Agent 并行
│   └── app.agent.step                 INTERNAL
│       ├── chat model-B               CLIENT
│       └── execute_tool read         INTERNAL
├── app.agent.step                    INTERNAL
│   ├── chat model-A                   CLIENT
│   └── execute_tool wait_agent       INTERNAL  真正等待的时间
└── app.agent.step                    INTERNAL
    └── chat model-A                   CLIENT    汇总结果
```

异步启动工具与子 Agent 执行 span 是根 Agent 下的兄弟；用 `app.agent.task_id`、`app.agent.spawn_call_id` 和 span link 关联。代码直接启动 / 等待而非模型工具时，短操作分别用自定义 `app.agent.spawn_subagent` / `app.agent.wait_subagent`。同步委派时，子 Agent `invoke_agent` 放在持续到完成的委派 span 下。

跨服务**同步**委派，把子 Agent 分支换成：

```text
execute_tool delegate_research       INTERNAL
└── invoke_agent research-agent     CLIENT    父服务
    └── HTTP POST /subagent/run     CLIENT
        └── POST /subagent/run      SERVER    子 Agent 服务（若接入）
            └── invoke_agent research-agent INTERNAL
                └── app.agent.step → chat / execute_tool …
```

远端异步受理时，父侧 CLIENT span 在受理后结束。跨越父 turn 的长期子任务另起 trace 并关联。`create_agent` 只在**确实创建远端托管 Agent 资源**时出现；本地启动一次子任务不等于创建资源。[Agent span 规范](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-agent-spans.md)。

### 案例 E：显式规划、工作流、其他模型操作

普通 `chat` 回答里出现“计划”，不额外创建 `plan`。只有独立、可识别的规划阶段，才这样表示：

```text
invoke_agent cloud-agent
├── plan cloud-agent             INTERNAL  规划阶段
│   └── chat model-A             CLIENT    规划阶段的一次模型调用
└── app.agent.step               INTERNAL  执行阶段
```

`plan` 包住一次模型调用及其输入准备 / 计划解析；这**不是两次模型调用**。规划结束不自动产生 `invoke_workflow`。只有产品定义并调用独立的图或编排流程，才有工作流入口，例如：

```text
POST /research                   SERVER
└── invoke_workflow research     INTERNAL  产品定义的编排入口
    ├── retrieval kb             CLIENT
    ├── invoke_agent researcher  INTERNAL
    │   └── app.agent.step → chat …
    └── invoke_agent writer      INTERNAL
        └── app.agent.step → chat …
```

当前已知云 Agent 是一个 Agent 循环，尚未定义这种入口；内部委派子 Agent 不自动算 workflow。向量化才用 `embeddings {model}`，多模态生成才用 `generate_content {model}`，按响应 ID 取回已有结果才用 `fetch_response`。这些节点挂在实际发起它们的 Agent / step / 工具下。管理接口真实创建托管 Agent 资源时用 `create_agent {name}`；记忆库创建 / 删除使用 `create_memory_store` / `delete_memory_store`，通常不在每轮对话 trace。[Agent / Plan / Workflow 约定](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-agent-spans.md)。

### 案例 F：其他模型操作与非用户 turn 的管理操作

```text
invoke_agent multimodal-agent     INTERNAL  仅在功能启用时
├── embeddings embed-model       CLIENT    查询向量化
├── retrieval kb                 CLIENT    检索知识库
├── generate_content model-M     CLIENT    多模态生成
└── fetch_response               CLIENT    按响应 ID 拉取已有结果（若发生）

app.agent.initialize             INTERNAL  服务启动（独立 trace）
├── initialize                   CLIENT    MCP 握手（若发生）
└── tools/list                   CLIENT    MCP 工具发现（若发生）

POST /admin/agents               SERVER    管理请求（独立 trace）
└── create_agent research-agent  CLIENT    创建远端托管 Agent 资源

POST /admin/memory-stores        SERVER    管理请求（独立 trace）
└── create_memory_store          CLIENT    创建记忆库
```

`fetch_response` 只是取回已有响应，不代表再次推理。`delete_memory_store` 对应真实的记忆库删除；MCP `resources/read`、`prompts/get` 也只有实际调用时才出现。

## 3. Span 分类与属性

OTel 自动提供 `trace_id`、`span_id`、父 ID 和开始 / 结束时间；Resource 统一提供 `service.name`、`service.version`、`deployment.environment.name`。以下字段只在有真实值时设置；业务 ID 不放进 span 名或 Metrics 标签。

| 类别 | Span / kind | 开始 → 结束；重点属性 |
| --- | --- | --- |
| 入口 | `POST /agent/turns` / SERVER | 收到 → 返回或流结束；`http.route`、`http.request.method`、`http.response.status_code`、`app.agent.turn_id`、`app.agent.session_id`。异步受理只覆盖受理耗时；整轮由独立的 Agent span 覆盖。 |
| Agent 与循环 | `invoke_agent {name}` / INTERNAL，`app.agent.step` / INTERNAL | Agent 从开始执行到完成；step 从准备本次模型输入到相关工具处理完成。`gen_ai.operation.name=invoke_agent`、`gen_ai.agent.name`、`gen_ai.conversation.id`（有真实会话 ID 时）、`app.agent.turn_id`、`app.agent.task_id`、`app.agent.step_index`、`app.agent.outcome`。Step 是自定义 span。 |
| 子 Agent / 工作流 | `invoke_agent {name}` / INTERNAL 或远程 CLIENT；`invoke_workflow {name}` / INTERNAL | 子 Agent 覆盖自身执行，工作流覆盖产品定义的编排。分别设置 `gen_ai.operation.name=invoke_agent` / `invoke_workflow`；子任务加 `app.agent.root_turn_id`、`app.agent.task_id`、`app.agent.parent_task_id`、`app.agent.spawn_call_id`，工作流加 `gen_ai.workflow.name`。托管资源稳定 ID 才用 `gen_ai.agent.id`。 |
| 创建 / 规划 | `create_agent {name}` / CLIENT；`plan {name}` / INTERNAL | 只有真实创建托管资源 / 独立规划阶段才建；分别用 `gen_ai.operation.name=create_agent` / `plan`、`gen_ai.agent.name`；创建资源时可得 `gen_ai.provider.name`、稳定 `gen_ai.agent.id`。 |
| 模型 | `chat {model}`、`generate_content {model}`、`embeddings {model}`、`fetch_response` / CLIENT | 单次逻辑模型操作；`gen_ai.operation.name`、`gen_ai.provider.name`、`gen_ai.request.model`、`gen_ai.request.stream`、`gen_ai.response.model`、`gen_ai.usage.input_tokens` / `gen_ai.usage.output_tokens`（适用时）、`gen_ai.response.finish_reasons`、流式时 `gen_ai.response.time_to_first_chunk`；自定义 `app.agent.model_call_id`、`app.agent.retry_count`。命名 prompt 可加 `gen_ai.prompt.name` / `gen_ai.prompt.version`；`fetch_response` 不记新生成的 token。 |
| 工具 | `execute_tool {name}` / INTERNAL | 实际执行到完成 / 失败；`gen_ai.operation.name=execute_tool`、`gen_ai.tool.name`、`gen_ai.tool.call.id`。模型 span 与工具 span 在 step 下同级。 |
| MCP | `tools/call {name}` / CLIENT、SERVER；按需 `tools/list`、`resources/read`、`prompts/get`、`initialize` | `mcp.method.name`、`gen_ai.tool.name`（工具调用时）、`gen_ai.operation.name=execute_tool`（工具调用时）、`mcp.protocol.version`、`server.address`、可得时 `jsonrpc.request.id` / `mcp.session.id`。MCP CLIENT 工具 span 不与同义 execute_tool 重复；错误用稳定类别区分请求失败与工具返回 `isError=true`。 |
| 长期记忆 | `search_memory`、`create_memory`、`update_memory`、`upsert_memory`、`delete_memory` / 远程 CLIENT，同进程可 INTERNAL | 实际记忆库调用；`gen_ai.operation.name`、`gen_ai.memory.store.id`、可得时 `gen_ai.memory.record.count`、针对单条记录时 `gen_ai.memory.record.id`。`create_memory_store` / `delete_memory_store` 属管理操作。 |
| 检索 | `retrieval {source}` / CLIENT | 实际检索知识源；`gen_ai.operation.name=retrieval`、有真实数据源 ID 时 `gen_ai.data_source.id`。 |
| 上下文 | `app.agent.load_context`、`app.agent.compact_context` / INTERNAL | 只为有实际耗时的组装、压缩建；压缩记录自定义 `app.agent.compaction.reason`、`app.agent.compaction.method`、`app.agent.compaction.input_tokens_before` / `app.agent.compaction.input_tokens_after`。后续模型用标准 `gen_ai.conversation.compacted=true`。 |
| 依赖与平台 | HTTP/RPC/DB/消息队列 CLIENT/SERVER；按需授权、限流、策略检查 | 每次真实依赖操作的耗时 / 失败；用对应标准语义属性。独立排队或等待有可定位耗时时建 span；不要为状态检查、逐 chunk 处理建 span。 |

自定义关联字段统一定义如下，索引和展示按业务需要配置：

| 字段 | 含义 |
| --- | --- |
| `app.agent.session_id` / `app.agent.turn_id` | 跨轮会话 ID / 本次用户 turn ID；多轮靠 session ID 关联，一轮对应一条主 trace。 |
| `app.agent.task_id` / `app.agent.parent_task_id` | 本次 Agent 执行实例 / 创建它的 Agent 实例；多个子 Agent 各有不同 task ID。 |
| `app.agent.root_turn_id` / `app.agent.spawn_call_id` | 子 Agent 所属的用户 turn / 触发启动的模型工具调用 ID；若不是工具启动，后者不设置。 |
| `app.agent.step_index` / `app.agent.model_call_id` | Agent 实例内从 1 开始的循环序号 / 一次逻辑模型调用的唯一 ID。 |
| `app.agent.retry_count` / `app.agent.outcome` | 模型额外尝试的次数（首次成功为 0）/ Agent 最终完成、失败或取消。 |

`create_memory` 是要求新增记录；`update_memory` 修改已知记录；`upsert_memory` 由记忆服务决定创建或合并。`gen_ai.memory.record.count` 在查询中是返回条数，在写入中是尝试写入条数。[Memory 规范](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-spans.md#memory)。

所有最终失败的操作设置 span status=`ERROR` 与稳定的 `error.type`；内部尝试失败但逻辑模型调用最终成功时，逻辑模型 span 不标失败。MCP 需区分传输 / 协议失败与工具正常返回但 `isError=true`，以免排障方向错误；Codex 源码分别归为 `mcp_request`、`tool_result`。usage 只在逻辑模型 span 汇总，不在其 HTTP 子 span 重复计数。[OTel 错误记录约定](https://opentelemetry.io/docs/specs/semconv/general/recording-errors/)、[Codex MCP 错误分类](../../../codex-rs/core/src/mcp_tool_call/telemetry.rs)。

## 4. 什么适合做 Span Event

**判定方法：**有独立、值得定位的耗时操作才建 span；只是持续状态或最终结果，用 span attribute；发生在 span 内的**少量、关键、不可由已有 span 边界还原的时间点**，才用 span event。Event 自带时间戳，只附少量不含正文的属性，且每次操作的 event 数量有明确上限。[OTel Span Event API](https://opentelemetry.io/docs/specs/otel/trace/api/#add-events)。

| 候选 | 决定与原因 |
| --- | --- |
| 首次用户可见输出 | **保留 event**：`app.agent.first_output` 记在真正写出首段正文的 SERVER span 上，只记时间点；异步返回后另开流时，记在该流的 SERVER span。模型首 chunk 与用户首输出不同。 |
| 模型重试决策 | **保留 event**：`app.gen_ai.retry_scheduled` 记在逻辑模型 span 上，带下一次尝试序号、`backoff_ms`、稳定的失败类别；每次 HTTP 尝试另有子 span。 |
| 模型降级或路由切换 | **发生时才用 event**：`app.agent.fallback_selected` 记在 step 上，带稳定原因类别与目标模型；实际新模型调用仍有自己的 span。 |
| 取消请求到达 | **清理或等待仍会继续时才用 event**：`app.agent.cancel_requested` 记在根 Agent span 上；若立即结束，结束时间和结果属性已足够。 |
| 未处理的异常 | **按需记录 `exception` event**：记在直接失败的操作 span，并设 status / `error.type`；上层不重复记录同一异常。只有失败状态码而无异常对象时，不造一个 exception event。 |
| 模型首 chunk | **默认用属性** `gen_ai.response.time_to_first_chunk`，标准已有定义；只有 Hera 必须在时间轴标点且属性无法满足时，才增补一次自定义 event。 |
| 工具开始 / 结束、MCP 响应、memory 命中、压缩完成、子 Agent 完成 | **不另建 event**：已有 span 边界或结束属性；失败看该 span 的 status / `error.type`。 |
| 每个 token、流片段、轮询、阈值检查 | **不采集为 event**：高频且对排障价值低；Codex 样本已显示此类粒度容易淹没主路径。 |

例：`chat model-A` 第一次 HTTP 尝试失败时，在该逻辑模型 span 的失败尝试结束后记录 `app.gen_ai.retry_scheduled {next_attempt=2, backoff_ms=100, error.type=timeout}`；第二次尝试成功后写模型 usage 与 `gen_ai.response.time_to_first_chunk`。服务真正写出首段正文时，在对应 SERVER span 只记一次 `app.agent.first_output`。不为每个 chunk 追加 event。

**内容 Event 另算。** GenAI 规范中的 `gen_ai.client.inference.operation.details` 和 `gen_ai.evaluation.result` 是 **LogRecord event**，不是这里讨论的 span event。前者可选地存模型输入输出，后者存评估结果。工程 trace 默认不采集 `gen_ai.input.messages`、`gen_ai.output.messages`、system prompt、工具原始参数 / 结果或 `gen_ai.memory.records`；算法 trace 方案另定内容采集。[GenAI 内容 Event](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-events.md)。

## 5. 跨语言传播与验收

- Java 管入口、Agent、step 及它实际执行的工具；最终发起模型请求的一层管模型 span。Java → Rust FFI 显式传 `traceparent`、`tracestate` 和业务 ID；同进程 FFI 不会自动传线程本地 OTel context。异步任务也传上下文。入口保证每个 turn 有独立 trace；若上游复用同一 `traceparent` 跨多个 turn，应为新 turn 建新 root，并用 span link 保留上游关联，避免 Codex 样本中多个 turn 混入同一 trace 的情况。[W3C Trace Context](https://www.w3.org/TR/trace-context/)、[OTel Context Propagation](https://opentelemetry.io/docs/concepts/context-propagation/)。
- MCP 消息把传播字段放进 `params._meta`，仅靠 HTTP 头不能覆盖同一连接中的多条 MCP 消息。远程子 Agent 继续传 `traceparent`；跨 turn 的独立任务用新 trace + span link。[MCP context propagation](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/mcp.md#context-propagation)。
- Hera 默认展开入口、Agent、step、模型、工具、MCP、子 Agent、压缩、记忆和失败节点；默认折叠 HTTP 尝试等传输细节。详情应显示各 span 耗时、模型首 chunk 时延、用户首输出时间、重试、错误和记忆记录数。并行子节点的时长不能简单相加。
- 按案例 A–F 制作导出 OTLP 样本并在 Hera 验收父子关系、span kind、属性、event 的时间与可见性、异步 / 取消 / 失败、跨服务上下文和 span link 跳转。当前文档是目标设计，不代表自研 Agent 或 Hera 已通过验收。

## 6. 参考资料

| 资料 | 对本文的用途 |
| --- | --- |
| [OTel GenAI Agent / Framework Spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-agent-spans.md) | 确定 `invoke_agent`、`create_agent`、`plan`、`invoke_workflow` 的使用边界。 |
| [OTel GenAI Spans](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-spans.md) | 确定模型、工具、检索、记忆等 span 与属性。 |
| [OTel MCP 约定](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/mcp.md) | 确定 MCP span 和消息级上下文传播。 |
| [OTel Span Event API](https://opentelemetry.io/docs/specs/otel/trace/api/#add-events)、[GenAI Events](https://github.com/open-telemetry/semantic-conventions-genai/blob/e57c543b4889619eb2a05702471937db5119165d/docs/gen-ai/gen-ai-events.md) | 区分 span event 与承载模型内容的 LogRecord event。 |
| [OTel 错误记录约定](https://opentelemetry.io/docs/specs/semconv/general/recording-errors/)、[W3C Trace Context](https://www.w3.org/TR/trace-context/) | 确定失败状态和跨 Java、Rust、MCP 服务的 trace 关联。 |
| [Codex 整轮 span](../../../codex-rs/core/src/tasks/mod.rs)、[模型循环](../../../codex-rs/core/src/session/turn.rs)、[MCP 调用](../../../codex-rs/core/src/mcp_tool_call.rs)、[子 Agent 启动](../../../codex-rs/core/src/tools/handlers/multi_agents_v2/spawn.rs) / [等待](../../../codex-rs/core/src/tools/handlers/multi_agents_v2/wait.rs) | 核对实际埋点、压缩、MCP 和子 Agent 生命周期。 |
| [本地 Codex trace 样本](../assets/langfuse-install-turn-evidence.json)、[Langfuse 最佳实践](../langfuse-best-practices.zh-CN.md) | 核对实际展示的 span 粒度与噪音，并确定默认展示重点。 |
| [DSH OTel 服务](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/telemetry/otel/src/index.ts)、[Session 日志通道](https://github.com/deepseek-ai/deepseek-harness/blob/639ed015397290b3745d163aafe02ffee4aa3f84/packages/telemetry/otel/src/session-log.ts) | 核对 DSH 当前接入的是 Logs，以及内容通道的独立队列和字节上限。 |

GenAI 规范链接固定到本文调研时使用的提交版本；规范仍处于 Development 阶段，实施前应核对版本变化。
