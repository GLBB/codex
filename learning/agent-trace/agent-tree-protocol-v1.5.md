# agent\-tree\-protocol\-v1\.5

## 目的

> Agnet 可观测
> 
> - Metrics
> 
> - Trace
> 
> - Trajectory
> 
> - Rollout
> 
> - Rollout trace
> 
> 

记录请求执行过程，快速发现：哪里慢、错在哪

span 不放内容原文，内容原文体积大，进 trace 拖垮可观测后端存储和可能有隐私合规问题

## 设计原则

本文参考 OpenTelemetry GenAI 语义规范设计，优先遵循 GenAI 及相关 OTel 领域规范的 span、属性和状态约定，对齐版本见「参考资料」。

- 规范已定义且语义一致的属性，复用其名称、类型和含义。
- 规范未定义、但本项目确有观测需求的属性，使用 `corojaw.*` 命名空间，并说明含义、取值及采集条件。
- 不改变标准属性的语义来承载项目自定义概念；项目补充或收紧的约定应明确说明。

## 系统架构

```Plaintext
Gateway 入口（gateway.request，WS JSON-RPC）
→ 执行策略：排队 / 打断 / 取消 / step 级租约（不建 span，用属性与轨迹事件承载）
→ 构建上下文：load_session → assemble_context
→ 循环执行 step：
     chat（模型请求）→ execute_tool ×N（有 tool_call 时）
     工具结果追加进历史，进入下一 step
→ 历史超预算时触发压缩：compact_context（摘要替换旧历史）
→ 无 tool_call 或到步数上限，给出最终回复
```

## Trace 设计

### Span 分类总览

|组|span|name|示例|kind|描述|
|---|---|---|---|---|---|
|A 执行骨架|turn 执行|`invoke_agent {profile}`|`invoke_agent main`|INTERNAL|一次 turn attempt 的容器，每 turn 恰好 1 个|
|B 上下文|读会话|`load_session`|`load_session`|INTERNAL|读 append\-only 事件流，投影成消息视图|
||组装上下文|`assemble_context`|`assemble_context`|INTERNAL|消息 \+ section \+ 工具定义拼成模型请求体，turn 级 1 次|
||压缩上下文|`compact_context`|`compact_context`|INTERNAL|历史压成摘要，仅在真正发生压缩时|
|C 模型|推理|`chat {model}`|`chat mify-large`|CLIENT|一次模型调用，每 step 1 个|
||向量化|`embeddings {model}`|`embeddings mify-embedding`|CLIENT|文本转向量（语义检索、记忆 embedding）|
||检索|`retrieval {data_source}`|`retrieval kb_main`|CLIENT|RAG / 知识库检索|
||取回响应|`fetch_response`|`fetch_response`|CLIENT|异步或长任务响应的轮询取回|
|D 记忆|记忆操作|`{gen_ai.operation.name}`|`search_memory`|CLIENT|7 种记忆读写：`search_memory` / `create_memory` / `update_memory` / `upsert_memory` / `delete_memory` / `create_memory_store` / `delete_memory_store`|
|E 工具|工具执行（基础）|`execute_tool {tool}`|`execute_tool weather_query`|INTERNAL|一次工具调用的默认形态|
||装载 skill|`execute_tool {tool} {skill}`|`execute_tool load_skill code-review`|INTERNAL|skill 装载的专化名形，只改 name 后缀并追加属性|
||读 skill 资源|`execute_tool {tool} {skill} {resource}`|`execute_tool read_skill_resource code-review references/review_policy.md`|INTERNAL|读取技能资源的专化名形|
||命令执行|`execute_tool {tool} {process.executable.name}`|`execute_tool bash git`|INTERNAL|本地命令执行的专化名形|
|F Agent 编排|创建 agent|`create_agent {agent}`|`create_agent research`|CLIENT|hosted agent 资源创建|
||调用远程 agent|`invoke_agent {agent}`|`invoke_agent vision`|CLIENT|调用别的进程或服务的 agent|
||调用 sub\-agent|`invoke_agent {agent}`|`invoke_agent deep-research`|INTERNAL|turn 内派生同进程 sub\-agent|
||调用 workflow|`invoke_workflow {workflow}`|`invoke_workflow travel-plan`|INTERNAL|多步 workflow 编排|
||规划|`plan {agent}`|`plan main`|INTERNAL|独立规划阶段|
|G MCP|MCP 客户端|`{mcp.method.name} {target}`|`tools/call weather_query`|CLIENT|本仓作为 MCP client 发起调用|
||MCP 服务端|`{mcp.method.name} {target}`|`prompts/get summarize`|SERVER|本仓作为 MCP server 接到请求|
|H 入口|请求入口|`{rpc.method}`（`gateway.request`）|`gateway.request`|SERVER|网关收到一条 WS JSON\-RPC 请求并处理到完成|

### Span 父子关系

有入口时的标准树。没有入口 span 时 `invoke_agent` 就是根（父 = 当时的 active span，OTel 上下文规则，上游不规定这一层）。

```Plaintext
RPC server span（gateway.request）     WS JSON-RPC 入口
└─ invoke_agent main            [INTERNAL]  一次 turn attempt
   ├─ load_session              [INTERNAL]  每 turn 1 次
   ├─ assemble_context          [INTERNAL]  turn 级 1 次
   │  ├─ search_memory          [CLIENT]    组装期召回
   │  └─ retrieval {ds}         [CLIENT]    组装期 RAG
   ├─ compact_context           [INTERNAL]  仅在压缩时
   │  └─ chat {model}           [CLIENT]    摘要模型调用
   ├─ chat {model}              [CLIENT]    每 step 一次
   ├─ execute_tool {tool}       [INTERNAL]  每次工具调用
   │  ├─ execute_tool {tool} {skill} {resource}   refinement
   │  ├─ chat {model}                      工具内部的模型调用
   │  ├─ {mcp.method} {target}  [CLIENT]    MCP
   │  └─ HTTP client span                  工具发出的 HTTP
   └─ …下一 step 平铺
```

### 通用约定

#### Resource

进程启动时构造一次，SDK 自动附加到所有 span。

|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|
|`service.name`|必须|string|本进程的服务名|`corojaw-gateway`|
|`deployment.environment.name`|必须|string|部署环境；上游 Recommended，本仓提为必填，理由见「与上游的关系」非偏差 6|`prod`|
|`host.name`|可选|string|主机名，SDK 自动附加|`corojaw-gw-07`|
|`host.ip`|可选|string\[\]|主机 IP，SDK 自动附加|`["10.12.0.9"]`|

不写 `service.version`：发版归因看部署平台，写进 span 只是多一个填不对的字段。`telemetry.sdk.*` 由 SDK 自己填，不用管。

#### 关联键

> TODO：待学习研究。

把同一 turn 的 span 串起来，也是 span 与轨迹事件之间的 join 键。

|字段|回答什么问题|覆盖范围|
|---|---|---|
|`corojaw.turn.id`|哪一次执行：一次用户输入触发的完整 agent 执行，一个 ULID，粒度是「一轮」|turn 内所有 span|
|`gen_ai.conversation.id`|哪个会话：这轮执行属于哪段对话，粒度是「会话」，跨多轮复用，`sha256(session_key)[:16]`|GenAI 与自创 span<br>|
|`corojaw.turn.kind`|前台对话（`TURN`）还是后台任务（`TASK`）|`invoke_agent` 及其直接子 span|
|`corojaw.step.seq`|第几步：turn 内循环的轮次，从 1 开始|step 粒度 span|
|`corojaw.trajectory.seq`|对齐到哪条轨迹事件|有轨迹事件的 span|

turn 与 conversation 的关系：一个会话（conversation\.id 不变）包含多个 turn（turn\.id 各不相同）；执行接管与多次 attempt 的关联方式待确认。

不把 `trace_id` / `span_id` 再写成属性，span 元数据里本来就有。

#### 状态与错误

- 操作成功：status 保持 `UNSET`，不设置 `error.type`。
- 操作失败：
  - status：设为 `ERROR`。
  - status.description：简短、脱敏的错误描述，按需填写。
  - error.type：必填，取值及映射由各类 span 定义。

### Agent 执行骨架

#### invoke\_agent

> TODO：确认是否存在租约机制，以及租约获取、续租、失效和执行接管如何在 trace 中展示；epoch 暂不纳入属性。

> TODO：确认主动取消的记录方式，以及是否需要通过 span 属性区分取消与正常完成。

> TODO：研究 steer 场景的 trace 结构，确认追加 query 的请求入口与当前 Agent 执行如何关联，以及 steer 收到、生效的记录方式。

表示一次本地 Agent 调用，覆盖上下文准备、模型与工具循环，直到调用结束。

|项|值|
|---|---|
|name / kind / op|`invoke_agent {gen_ai.agent.name}`；INTERNAL；`invoke_agent`|
|父|当前 active span：主 Agent 通常为请求入口，子 Agent 为发起调用的 span|
|子|上下文、模型、工具及子 Agent 调用|

|分类|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|固定为 `invoke_agent`|`invoke_agent`|
||`gen_ai.agent.name`|必须|string|本次被调用 Agent 的稳定 profile 名，不使用运行实例 ID|`main`|
||`gen_ai.agent.description`|有配置时必填|string|该 Agent 的职责描述|`负责工具编排与最终答复`|
|执行关联|`gen_ai.conversation.id`|有会话时必填|string|所属会话标识，生成规则见「关联键」|`3f9a1c8b7d2e4051`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn；同一 turn 的子 Agent 调用沿用此值|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
|执行类型|`corojaw.turn.kind`|必须|string|`TURN`：处理用户当前对话并完成本轮回复，如问答、对话内工具调用；`TASK`：由任务系统独立调度和管理的后台执行，如定时日报、提交后返回任务 ID 并异步通知结果的任务|`TURN`|
|执行统计|`corojaw.step.count`|可选|int|本次调用实际启动的主循环 step 数；不含摘要调用、模型自动重试和子 Agent 内部 step|`4`|
|执行限制|`corojaw.step.limit`|有上限时必填|int|本次调用实际生效的最大 step 数，计数范围与 `step.count` 一致|`20`|
|状态与错误|`error.type`|失败时必填|string|本次调用最终失败的分类，见下表|`step_limit`|

失败时 status 设为 `ERROR`，description 按通用「状态与错误」填写。以下 `step_limit`、`thinking_loop`、`loop_detected` 为本项目定义的错误分类值。

|失败情况|`error.type`|
|---|---|
|达到主循环 step 上限，被强制终止|`step_limit`|
|思考死循环：运行时检测到持续重复的思考输出或无进展的思考循环并终止|`thinking_loop`|
|其他循环：运行时检测到重复工具调用等循环并终止|`loop_detected`|
|本次 Agent 调用整体超时|`timeout`|
|无法分类的失败|`_OTHER`|


### 上下文

> TODO：学习上下文的构建、加载与压缩机制后，再考虑本节的 span 划分和属性设计。

三个 span 都是自创的，上游没有对应形态。与 xiaoaiclaw 现网（`session.load` \+ `system_prompt.build` \+ compaction）的差异：

|维度|xiaoaiclaw|本仓|
|---|---|---|
|拆分|`session.load` 与 `system_prompt.build` 是 run 启动的两个阶段|`load_session` / `assemble_context` / `compact_context` 三个操作，边界对齐「读什么」vs「拼成什么样」vs「压缩」|
|规模观测|`promptBlockStats` 18 个 block 字符 \+ 裁剪前后两个 history\_chars|14 个固定 section id 的字符属性 \+ `rebuild_reasons`|
|缓存观测|无指纹体系|`stable_prefix_hash` / `effective_render_hash` / `rebuild_reasons`，缓存未命中可归因|
|内容外泄|`system_prompt.build` 的业务日志打完整正文（`logs=true` 时三条 info）|trace 与日志都不含原文，正文走 ContentRef|

#### load\_session

`load_session` 读的是 append\-only 事件流，投影之后才是一段对话。

```Plaintext
append-only 事件流（N 条事件）
  │ 定位 → 区间读 → profile 过滤 → 段裁剪 → 叠加压缩视图
  ▼
读视图（M 条消息 + 规模统计）        N ≠ M 是常态
```

|项|值|
|---|---|
|kind / 父 / 子|INTERNAL；父 `invoke_agent`；无子（存储 IO 用属性表达）|
|输入|`session_key`、段边界（`SegmentStarted`）、压缩覆盖区间（`Compacted.from_seq` / `to_seq`）；profile 取父 span 的 `gen_ai.agent.name`，不重复记|
|输出|消息序列（交给 `assemble_context`）\+ 规模统计|
|不归它|压缩（`compact_context`）、记忆召回（`search_memory`）、RAG（`retrieval`）、渲染排版（`assemble_context`）|

它决定「有哪些消息」，`assemble_context` 决定「每条消息长什么样、留多少」。

|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|
|`corojaw.session.degraded`|条件必填|boolean|读会话失败、降级继续时填 `true`；是读降级在 trace 里的唯一记录点，父 span 不重复记|`true`|
|`corojaw.session.compacted`|条件必填|boolean|读视图已叠加压缩区间时填 `true`|`true`|
|`corojaw.session.read_source`|可选|string|事件流来源，取值 `redis` / `inmemory` / `filesystem`|`redis`|
|`corojaw.session.event_count`|可选|int|投影前的事件条数 N|`428`|
|`corojaw.session.message_count`|可选|int|投影后的消息条数 M|`57`|
|`corojaw.session.user_count`|可选|int|user 消息条数|`20`|
|`corojaw.session.assistant_count`|可选|int|assistant 消息条数|`20`|
|`corojaw.session.tool_result_count`|可选|int|tool\_result 消息条数|`17`|
|`corojaw.session.transcript_chars`|可选|int|历史正文字符总数|`48210`|
|`corojaw.session.seq_start`|可选|int|实际读取区间的起始 seq|`1024`|
|`corojaw.session.seq_end`|可选|int|实际读取区间的结束 seq|`1451`|

工具定义不在这里统计：它由 `assemble_context` 注入，记在 `corojaw.context.tools_chars`，两边都记就是重复统计。

turn 冷启动的读日志耗时只可能出现在 trace 里，metric 聚合后没有时间线。Redis 慢或降级时 turn 首段变慢，只有 `invoke_agent` 总时长的话分不清是读会话还是组装上下文。

#### assemble\_context

读视图、14 类 section 与工具定义，经选段、排序和预算裁切，产出渲染后的请求体和两个缓存指纹。这是本仓唯一的上下文组装入口。

|项|值|
|---|---|
|kind / 父 / 子|INTERNAL；父 `invoke_agent`；子为组装期发起的 `search_memory` / `retrieval`，组装内做摘要时的 `chat`|
|粒度|turn 级一次。system 段在 turn 内只构建一次，step 级只追加历史|
|输入|读视图、`ContextProfile`、工具定义、`ctx_watermark`|
|输出|`rendered_request`（存 ContentRef，不进 span 属性）\+ `ContextAssembled` 轨迹事件 \+ 两个指纹|

`raw_input` 段不可裁且必须排最后（`l0-context`）。section 级细节走属性，不建子 span。

|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|
|`corojaw.context.profile_id`|必须|string|本次组装使用的 `ContextProfile` id，决定按 role 拼哪些 section；与 agent profile 是两套 id|`main`|
|`corojaw.context.stable_prefix_hash`|必须|string|稳定前缀（不随 turn 变化的 section）的指纹：每段算 sha256，按固定顺序以竖线分隔拼起来再整体算 sha256，取 64 位小写 hex。它是 prompt 缓存命中的前提，逐字节稳定才算同一段|`9f2c8a1b3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8`|
|`corojaw.context.effective_render_hash`|必须|string|缓存 key：`stable_prefix_hash`、`tools_hash`（工具定义段的指纹）、`model_fingerprint` 三者复合，算法见 `l0-context`「指纹算法」。回答「这次组装能不能复用上次的结果」|`4b7e1d0c9a8f5e234f6a8b0c2d4e6f8a1b3c5d7e9f0a2b4c6d8e0f1a3b5c7d9e`|
|`corojaw.context.rebuild_reasons`|条件必填|string\[\]|本次 `effective_render_hash` 与同会话上一次组装不同时，列出变化的 section id；没变化不发。缓存未命中的归因就靠它|`["turn_time"]`|
|`corojaw.context.compaction_applied`|条件必填|boolean|本次使用压缩视图时填 `true`|`true`|
|`corojaw.context.section.count`|可选|int|实际进入渲染的 section 数，上限 14|`12`|
|`corojaw.context.system_prompt_chars`|可选|int|system 段字符数|`38210`|
|`corojaw.context.history_chars`|可选|int|历史段字符数|`61230`|
|`corojaw.context.tools_chars`|可选|int|工具定义字符数|`22065`|
|`corojaw.context.estimated_input_tokens`|可选|int|预算裁切后的估算输入 token|`31200`|
|`corojaw.context.cache_breakpoint_count`|可选|int|缓存断点数，取自 `l0-llm` 的 `SystemBlock.cache_breakpoint`|`2`|
|`corojaw.context.watermark_seq`|可选|int|组装时使用的 `ctx_watermark`，审计据此判断回答是否基于过期上下文|`1451`|
|`corojaw.context.section.<section_id>.chars`|可选|int|单个 section 的字符数|`22065`|

`<section_id>` 取 `l0-context` 的 14 个固定 id：`agent_role` / `persona` / `security_rules` / `behavior` / `skills` / `environment` / `long_term_memory` / `turn_time` / `memory_recall` / `device_context` / `interrupt_recovery` / `inbox_context` / `hook_context` / `raw_input`。key 固定、值有界，不进 span name。

#### compact\_context

历史压成摘要，同时记下被覆盖的事件区间。追加不重写，可回放。

|项|值|
|---|---|
|kind / 父 / 子|INTERNAL；父 `invoke_agent`；子为摘要用的 `chat`，token 不得与子 span 重复计|
|触发|真正发生压缩时。低频，但发生时是 turn 的最大尖峰|

|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|
|`corojaw.compaction.from_seq`|必须|int|被摘要覆盖区间的起始 seq，供回放校验|`120`|
|`corojaw.compaction.to_seq`|必须|int|被摘要覆盖区间的结束 seq，供回放校验|`1024`|
|`corojaw.compaction.messages_before`|可选|int|压缩前的消息条数|`96`|
|`corojaw.compaction.messages_after`|可选|int|压缩后的消息条数|`12`|
|`corojaw.compaction.chars_before`|可选|int|压缩前的字符数|`182000`|
|`corojaw.compaction.chars_after`|可选|int|压缩后的字符数|`21000`|
|`corojaw.compaction.input_tokens`|可选|int|摘要模型的输入 token|`46000`|
|`corojaw.compaction.output_tokens`|可选|int|摘要模型的输出 token|`1800`|

`gen_ai.conversation.compacted` 不打在本 span 上，打在受影响的后续 `chat` / `invoke_agent` 上。上游脚注要求只在能可靠判定「生效上下文是压缩视图」时置 `true`，不得置 `false`。

### 模型

#### chat

> TODO：确认 mify Provider 的请求与响应映射，包括 Provider 标识、模型与参数、响应结束原因、usage，以及重试场景的用量统计口径。

> TODO：与项目设计同学确认是否需要模型配置指纹、参与计算的配置及其用途；`corojaw.model.fingerprint` 暂不纳入属性。

表示一次逻辑模型调用，覆盖请求发起、自动重试、退避等待，直到完整响应接收结束或调用终止。

|项|值|
|---|---|
|name / kind / op|`chat {gen_ai.request.model}`；CLIENT；`chat`|
|何时创建|每次逻辑模型调用|
|父|发起调用的 active span，如 `invoke_agent`、`execute_tool`、`compact_context`、`assemble_context`|
|子|实际 HTTP 请求 span，每次发送尝试分别记录|

自动重试不另建 `chat` span；应用切换模型并重新发起调用时，创建新的 `chat` span。

|分类|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|固定为 `chat`|`chat`|
||`gen_ai.provider.name`|必须|string|按接入服务及对应 GenAI 语义填写，mify 映射待确认|`mify`|
||`gen_ai.request.model`|可获得时必填|string|请求发送的模型标识|`mify-large`|
|执行关联|`gen_ai.conversation.id`|有会话时必填|string|所属会话标识，生成规则见「关联键」|`3f9a1c8b7d2e4051`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|所属主循环 step；摘要等独立调用不伪造序号|`2`|
|请求配置|`gen_ai.request.stream`|已知时填写|boolean|是否请求流式响应|`true`|
||`gen_ai.request.temperature`|请求设置时填写|double|采样温度|`0.7`|
||`gen_ai.request.top_p`|请求设置时填写|double|核采样阈值|`0.95`|
||`gen_ai.request.top_k`|请求设置时填写|int|采样候选数量|`40`|
||`gen_ai.request.seed`|请求设置时填写|int|随机种子|`42`|
||`gen_ai.request.choice.count`|请求设置时填写|int|请求生成的候选数量|`1`|
||`gen_ai.request.max_tokens`|请求设置时填写|int|输出 token 上限|`4096`|
||`gen_ai.request.stop_sequences`|请求设置时填写|string[]|停止序列|`["</answer>"]`|
||`gen_ai.request.frequency_penalty`|请求设置时填写|double|频率惩罚|`0.1`|
||`gen_ai.request.presence_penalty`|请求设置时填写|double|存在惩罚|`0.1`|
||`gen_ai.request.reasoning.level`|请求设置时填写|string|发给 Provider 的原始思考级别|`medium`|
||`gen_ai.request.previous_response.id`|请求引用时填写|string|延续的前序响应标识|`resp_previous`|
|响应结果|`gen_ai.response.model`|可获得时填写|string|实际生成响应的模型|`mify-large-2026-09`|
||`gen_ai.response.id`|可获得时填写|string|Provider 响应标识|`resp_123`|
||`gen_ai.response.finish_reasons`|可获得时填写|string[]|各候选的结束原因；预期但未收到的异常结束原因按规范记为 `error`|`["stop"]`|
|Token 用量|`gen_ai.usage.input_tokens`|用量可获得时填写|int|输入总 token，包含缓存命中部分|`8210`|
||`gen_ai.usage.output_tokens`|用量可获得时填写|int|输出总 token，包含 reasoning 部分|`310`|
||`gen_ai.usage.cache_read.input_tokens`|可获得时填写|int|缓存读取 token，属于输入总数的子集|`7680`|
||`gen_ai.usage.cache_write.input_tokens`|可获得时填写|int|缓存写入 token，按 Provider 用量定义采集|`512`|
||`gen_ai.usage.reasoning.output_tokens`|可获得时填写|int|reasoning token，属于输出总数的子集|`128`|
|上下文状态|`gen_ai.conversation.compacted`|确认生效时填写|boolean|使用压缩上下文时设 `true`，否则不设置|`true`|
|性能|`gen_ai.response.time_to_first_chunk`|流式且收到首块时填写|double|从逻辑请求发起到首次收到响应 chunk 的秒数；首块不一定包含可见文字|`3.42`|
|重试|`corojaw.retry.count`|发生重试时填写|int|自动重试次数，不含首次请求|`1`|
|模型切换|`corojaw.fallback.from`|切换模型时填写|string|前一次调用使用的模型，通过 Link 关联该调用|`mify-small`|
|状态与错误|`error.type`|失败时必填|string|最终失败分类，见下表|`timeout`|

失败分类：优先使用 Provider 或客户端已定义的低基数错误码；没有适用错误码时，使用以下项目分类。

|失败情况|`error.type`|
|---|---|
|请求或流式等待超时|`timeout`|
|无效凭据或权限不足|`auth`|
|请求被限流|`rate_limit`|
|服务容量不足|`overloaded`|
|欠费或额度耗尽|`billing`|
|请求或响应不符合协议|`format`|
|安全策略拦截并导致调用失败|`content_filter`|
|无法分类的失败|`_OTHER`|

#### embeddings

表示一次向量生成调用，如将用户问题转换为查询向量，或为知识库文档生成索引向量。

|项|定义|
|---|---|
|name / kind / op|`embeddings {gen_ai.request.model}`；CLIENT；`embeddings`|
|何时创建|每次逻辑向量生成调用，批量输入对应一次调用|
|父|发起调用的 active span，如 `assemble_context`、`execute_tool`、`retrieval`|
|子|实际 HTTP 请求 span|

自动重试不另建 `embeddings` span。

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|固定为 `embeddings`|`embeddings`|
||`gen_ai.provider.name`|必须|string|向量生成服务的 Provider 标识|`mify`|
||`gen_ai.request.model`|可获得时必填|string|请求的向量模型|`mify-embedding`|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|所属会话，生成规则见「关联键」|`conv_123`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn；离线索引任务不伪造 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|所属主循环 step；上下文准备阶段不填写|`2`|
|请求配置|`gen_ai.embeddings.dimension.count`|可获得时填写|int|生成向量的维度|`1024`|
||`gen_ai.request.encoding_formats`|请求设置时填写|string[]|向量编码格式|`["float"]`|
|响应结果|`gen_ai.response.model`|可获得时填写|string|实际生成向量的模型|`mify-embedding-v2`|
|Token 用量|`gen_ai.usage.input_tokens`|用量可获得时填写|int|本次调用的输入 token 数|`100`|
|服务地址|`server.address`|可获得时填写|string|向量生成服务地址|`embedding.internal`|
||`server.port`|设置地址时填写|int|服务端口|`443`|
|重试|`corojaw.retry.count`|发生重试时填写|int|自动重试次数，不含首次请求|`1`|
|状态与错误|`error.type`|失败时必填|string|最终失败分类，见下表|`timeout`|

失败分类：优先使用 Provider 或客户端已定义的低基数错误码；没有适用错误码时，使用以下项目分类。

|失败情况|`error.type`|
|---|---|
|请求超时|`timeout`|
|无效凭据或权限不足|`auth`|
|请求被限流|`rate_limit`|
|服务容量不足|`overloaded`|
|欠费或额度耗尽|`billing`|
|输入、请求或响应格式不符合协议|`format`|
|无法分类的失败|`_OTHER`|

输入原文和输出向量不放入 span。

#### retrieval

表示一次从知识库、向量库或搜索系统获取相关信息的调用，输入可以是文本、向量或两者组合。

|项|定义|
|---|---|
|name / kind / op|`retrieval {gen_ai.data_source.id}`；CLIENT；`retrieval`|
|何时创建|每次逻辑检索调用|
|父|发起调用的 active span，如 `assemble_context`、`execute_tool`|
|子|可观测的向量生成、存储或网络请求 span|

自动重试不另建 `retrieval` span。向量化发生在不可观测的外部服务内部时，不推测创建 `embeddings` 子 span。

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|固定为 `retrieval`|`retrieval`|
||`gen_ai.provider.name`|适用时填写|string|检索服务 Provider 标识|`search_service`|
||`gen_ai.data_source.id`|适用时填写|string|被检索的数据源；不可获得时 span name 退为 `retrieval`|`kb_main`|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|所属会话，生成规则见「关联键」|`conv_123`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|所属主循环 step；上下文准备阶段不填写|`2`|
|请求配置|`gen_ai.retrieval.top_k`|可获得时填写|int|请求召回的文档数量，不是实际返回数量|`10`|
|服务地址|`server.address`|可获得时填写|string|检索服务地址|`search.internal`|
||`server.port`|设置地址时填写|int|服务端口|`443`|
|重试|`corojaw.retry.count`|发生重试时填写|int|自动重试次数，不含首次请求|`1`|
|状态与错误|`error.type`|失败时必填|string|最终失败分类，见下表|`timeout`|

失败分类：优先使用检索服务或客户端已定义的低基数错误码；没有适用错误码时，使用以下项目分类。

|失败情况|`error.type`|
|---|---|
|请求超时|`timeout`|
|无效凭据或权限不足|`auth`|
|请求被限流|`rate_limit`|
|服务容量不足|`overloaded`|
|请求或响应格式不符合协议|`format`|
|无法分类的失败|`_OTHER`|

正常完成但未找到匹配结果，不作为错误。查询原文和文档正文通过内容引用记录，不放入 span。

#### fetch_response

> TODO：确认 mify 是否提供按响应 ID 查询、取回或恢复响应流的接口；按实际支持能力启用本类 span。

表示一次取回已有模型响应的请求，用于后台生成状态查询、结果获取或流式响应续取，不重新发起生成。

|项|定义|
|---|---|
|name / kind / op|`fetch_response`；CLIENT；`fetch_response`|
|何时创建|每次逻辑取回调用；轮询时每次查询分别创建|
|父|发起取回调用的 active span|
|子|实际 HTTP 请求 span|

单次取回调用的自动重试不另建 `fetch_response` span。

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|固定为 `fetch_response`|`fetch_response`|
||`gen_ai.provider.name`|必须|string|Provider 标识|`mify`|
|执行关联|`gen_ai.response.id`|必须|string|被取回的响应标识，同一生成的多次查询沿用此值|`resp_123`|
||`gen_ai.conversation.id`|有会话时填写|string|项目补充：所属会话|`conv_123`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|所属主循环 step；独立后台轮询不伪造序号|`2`|
|请求配置|`gen_ai.request.stream_cursor`|从已有位置续取时必填|string|上次已收到的流事件游标|`event_42`|
|响应结果|`gen_ai.response.model`|可获得时填写|string|原生成使用的模型|`mify-large`|
||`gen_ai.response.status`|可获得时填写|string|原生成的生命周期状态|`in_progress`、`completed`、`failed`|
||`gen_ai.response.finish_reasons`|可获得时填写|string[]|原生成的结束原因，按规范映射|`["stop"]`|
|服务地址|`server.address`|可获得时填写|string|Provider 服务地址|`model.internal`|
||`server.port`|设置地址时填写|int|服务端口|`443`|
|重试|`corojaw.retry.count`|发生重试时填写|int|本次取回调用的自动重试次数，不含正常轮询次数|`1`|
|状态与错误|`error.type`|取回操作失败时必填|string|最终失败分类，见下表|`timeout`|

失败分类：优先使用 Provider 或客户端已定义的低基数错误码；没有适用错误码时，使用以下项目分类。

|失败情况|`error.type`|
|---|---|
|取回请求超时|`timeout`|
|无效凭据或权限不足|`auth`|
|请求被限流|`rate_limit`|
|服务容量不足|`overloaded`|
|请求或响应格式不符合协议|`format`|
|无法分类的失败|`_OTHER`|

不重复记录原生成的 token 用量。span status 表示取回操作是否成功；`gen_ai.response.status` 表示原生成的状态，返回 `in_progress` 或 `failed` 不直接代表取回操作失败。

### 记忆

7 个操作共用一个 span 形态，靠 `gen_ai.operation.name` 区分：`search_memory` / `create_memory` / `update_memory` / `upsert_memory` / `delete_memory` / `create_memory_store` / `delete_memory_store`。

name 是 `{gen_ai.operation.name}`，不带目标。kind `CLIENT`（进程内实现可用 `INTERNAL`）。父是 `assemble_context`（召回）或 `execute_tool`（显式记忆工具）。

属性照上游：

|字段|是否必须|说明|
|---|---|---|
|`gen_ai.memory.store.id`|条件必填|记忆库 id|
|`gen_ai.memory.record.id`|条件必填|单条记录操作时|
|`gen_ai.provider.name`|条件必填|外部记忆服务时|
|`gen_ai.memory.record.count`|可选|操作涉及的记录数|
|`server.address` / `server.port`|可选|外部记忆服务地址|

查询原文与记录内容不进 span（含用户原文与 PII）。

消费方是 `l0-context` 的 `long_term_memory` / `memory_recall` 段。

### 工具

#### execute\_tool

|项|值|
|---|---|
|name / kind / op|`execute_tool {gen_ai.tool.name}`；INTERNAL；`execute_tool`|
|父 / 子|父 `invoke_agent`；子为工具内部的 `chat`、MCP span、HTTP client span|

并行工具调用每个工具一个 span，用 `corojaw.step.seq` 归组。

|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|
|`gen_ai.operation.name`|必须|string|操作名，同时决定 span name 前缀|`execute_tool`|
|`gen_ai.tool.name`<br>|必须|string|工具名，取自 `ToolManifest.spec.name`；注册工具是有限集合，可以进 span name|`weather_query`|
|`gen_ai.agent.name`|必须|string|发起本次调用的 agent profile id|`main`|
|`gen_ai.conversation.id`|必须|string|会话标识，取 `sha256(session_key)` 小写 hex 的前 16 位，与父 `invoke_agent` 同值|`3f9a1c8b7d2e4051`|
|`gen_ai.tool.call.id`|必须|string|本次调用的唯一 id，取自 `ToolInvocation.call_id`（必有）|`call_01J9ZK3Q7X`|
|`corojaw.step.seq`|必须|int|本次调用属于第几步|`2`|
|`corojaw.tool.status`|必须|string|执行结果，取值 `OK` / `ERROR` / `UNKNOWN` / `CANCELLED` / `TIMEOUT`，取自 `ToolOutcome.status`。`UNKNOWN` 表示结果未知（进程崩溃等，可能已执行），不算失败|`OK`|
|`error.type`|条件必填|string|失败时的错误分类，取值见「状态与错误」|`tool_timeout`|
|`corojaw.tool.truncated`|条件必填|boolean|返回被截断时填 `true`|`true`|
|`gen_ai.tool.description`|可选|string|模型可见的工具说明，取自 `ToolManifest.spec.description`|`查询指定城市的实时天气`|
|`gen_ai.tool.type`|可选|string|工具形态，取值 `function` / `extension` / `datastore`|`function`|
|`corojaw.tool.kind`|可选|string|工具类型，取值 `READ` / `WRITE` / `EXEC` / `NET`，取自 `ToolManifest.kind`|`READ`|
|`corojaw.tool.idempotent`|可选|boolean|是否幂等，来自 `ToolManifest`，影响重试决策|`true`|
|`corojaw.tool.risk_level`|可选|string|风险等级，取值 `LOW` / `MEDIUM` / `HIGH`，来自 `ToolManifest`；`UNSPECIFIED` 按 `HIGH` 处理|`LOW`|

#### 工具调用变体

- skill 装载

- 技能资源读取

- 命令执行

> 避免 name 高基数问题
> 
> 

|变体|name 形态|何时用|追加属性|
|---|---|---|---|
|Load skill|`execute_tool {tool} {gen_ai.skill.name}`；skill 名不可用时退回 `execute_tool {tool}`|装载一个 skill|`gen_ai.skill.name`\(条件必填\)、`gen_ai.skill.description`、`gen_ai.skill.source.uri`|
|Read skill resource|`execute_tool {tool} {gen_ai.skill.name} {gen_ai.skill.resource.name}`；只有 resource 名时 `execute_tool {tool} {gen_ai.skill.resource.name}`；都没有时裸名|读取 skill 内的资源文件|`gen_ai.skill.resource.name`\(条件必填\) 加上行|
|Command execution|`execute_tool {tool} {gen_ai.skill.name} {gen_ai.skill.resource.name}`，退到 `execute_tool {tool} {gen_ai.skill.resource.name}`，再退到 `execute_tool {tool} {process.executable.name}`，最后裸名|执行本地命令|`process.executable.name`\(条件必填\)、`process.exit.code`\(条件必填\)、`process.executable.path`、`gen_ai.skill.*`|

### Agent 编排

五个条件 span，都是上游原样照抄，本仓只决定何时发。进程内的主循环不产生它们。

|span|name|kind|何时发|上游属性|
|---|---|---|---|---|
|创建 agent|`create_agent {agent}`|CLIENT|出现 hosted agent 资源创建时|11 项。必须：`gen_ai.operation.name`、`gen_ai.provider.name`；条件必填：`gen_ai.agent.name`（必填）、`gen_ai.agent.id`（有稳定资源 id 才填）、`gen_ai.agent.version`、`gen_ai.agent.description`、`gen_ai.request.model`、`server.address` / `port`|
|调用远程 agent|`invoke_agent {agent}`，无 agent 名时退化为 `invoke_agent`|CLIENT|调用别的进程或别的服务的 agent|40 项，形态与 `chat` 同构，多出 `gen_ai.agent.*` 与 `server.*`|
|调用同进程 sub\-agent|`invoke_agent {agent}`|INTERNAL|turn 内派生 sub\-agent|复用「执行骨架」的 `invoke_agent` 属性表，只是位置不同、agent 名不同|
|调用 workflow|`invoke_workflow {workflow}`|INTERNAL|出现多步 workflow 编排|6 项。必须：`gen_ai.operation.name`；条件必填：`gen_ai.conversation.id`、`gen_ai.workflow.name`；可选：`gen_ai.input.messages` / `output.messages`（内容原文，本仓不引入，见「不外泄的内容」）|
|规划|`plan {agent}`，无 agent 名时退化为 `plan`|INTERNAL|出现独立规划阶段|3 项。必须：`gen_ai.operation.name`；条件必填：`error.type`、`gen_ai.agent.name`|

### MCP

|项|值|
|---|---|
|name|`{mcp.method.name} {target}`，target 是工具 / 资源 / prompt 名|
|kind|客户端 CLIENT，服务端 SERVER|
|父|`execute_tool`（工具走 MCP 时）或 `invoke_agent`|

|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|
|`mcp.method.name`|必须|string|MCP 方法名，如 `tools/call` / `resources/read` / `prompts/get`，同时拼进 span name|`tools/call`|
|`error.type`|条件必填|string|失败时的错误分类，取值见「状态与错误」|`tool_error`|
|`gen_ai.tool.name`|条件必填|string|工具调用时的目标工具名|`weather_query`|
|`gen_ai.prompt.name`|条件必填|string|prompt 获取时的 prompt 名|`summarize`|
|`jsonrpc.request.id`|条件必填|string|JSON\-RPC 请求 id；客户端 span 由本端生成，服务端 span 取收到的值|`"42"`|
|`mcp.resource.uri`|条件必填|string|读取资源时的资源 uri|`file:///docs/api.md`|
|`rpc.response.status_code`|条件必填|string|JSON\-RPC 错误响应的 error\.code（如 `"-32602"`）；只有错误响应带码，正常响应不发，不要填 HTTP 状态码|`"-32602"`|
|`gen_ai.operation.name`|可选|string|工具调用时等于 execute\_tool|`execute_tool`|
|`mcp.session.id`|可选|string|MCP 会话 id|`8f2c1d9e4b7a`|
|`mcp.protocol.version`|可选|string|MCP 协议版本|`2025-06-18`|
|`jsonrpc.protocol.version`|可选|string|JSON\-RPC 版本|`2.0`|
|`network.transport`|可选|string|传输层，如 `pipe` / `tcp`|`tcp`|
|`network.protocol.name`|可选|string|应用层协议|`http`|
|`network.protocol.version`|可选|string|应用层协议版本|`1.1`|
|`server.address`|可选|string|服务端地址|`10.12.0.9`|
|`server.port`|可选|int|服务端端口|`8443`|
|`client.address`|可选|string|客户端地址|`10.12.0.7`|
|`client.port`|可选|int|客户端端口|`51234`|

MCP 请求必须透传 W3C `traceparent` / `tracestate`（`mcp.md:43` 的 `_meta` 约定）。不透传的话 MCP server 侧的 span 会成为新 trace 的根，调用链断开。

### 入口

#### RPC 入口（gateway\.request）

入口是 `gateway.request`：网关收到一条 WS JSON\-RPC 请求并处理到完成。用上游通用 RPC server span 承载，不自造 span 类型与 span 名：

- name：`{rpc.method}`，即 `gateway.request`；方法不可识别时退为 `{rpc.system.name}`。

- kind：SERVER，trace 根，子为 `invoke_agent`。

- `rpc.system.name`：必须，JSON\-RPC 2\.0 传 `jsonrpc`。

- `rpc.method`：条件必填，值即方法名（本仓 agent 入口当前只有 `gateway.request`，xiaoaiclaw 侧另有 `chat.send` 等，是同一个约定的不同方法）。

- `rpc.response.status_code`：条件必填，JSON\-RPC 错误响应的 error\.code。

- `error.type`：条件必填。

- `network.*`、`server.address` / `port`、`client.address` / `port`：可选。

WS 长连接是否给每条消息建 per\-message server span，由业务语义决定，协议只规定 name 与 kind。





## 参考资料

对齐基线（属性名的唯一真源）：

|\#|基线|版本 / commit|覆盖|
|---|---|---|---|
|1|[open\-telemetry/semantic\-conventions\-genai](https://github.com/open-telemetry/semantic-conventions-genai)|`9ffc7e0c639be7712e544e3e54331e885dccf84`（2026\-10\-21）|`gen_ai.*`、MCP、GenAI 指标|
|2|[open\-telemetry/semantic\-conventions](https://github.com/open-telemetry/semantic-conventions)|`v1.44.0`|`http.*`、`rpc.*`、`error.type`、`server.*`、`exception.*`|

外部参考：

- [LangSmith: trace with OpenTelemetry](https://docs.langchain.com/langsmith/trace-with-opentelemetry)

- [Vercel: making every harness durable](https://vercel.com/blog/making-every-harness-durable)

- xiaoaiclaw 现网实现：`extensions/diagnostics-otel/src/service.ts`、`span-descriptions.ts`，设计与数据字典见其 `docs/xiaoai/feature-enhance-otel-traces.md`



