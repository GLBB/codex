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

span 默认不放大体积内容原文；工具入参和成功返回值按「execute_tool」约定默认记录脱敏、限长的副本，完整内容通过引用关联外部存储。

## 设计原则

本文参考 OpenTelemetry GenAI 语义规范设计，优先遵循 GenAI 及相关 OTel 领域规范的 span、属性和状态约定，对齐版本见「参考资料」。

遵循规范可以统一不同 Agent、模型和工具的观测语义，便于跨服务查询与比较；减少接入可观测平台时的字段转换和专有适配，并复用标准插桩、查询和展示能力。

- 规范已定义且语义一致的属性，复用其名称、类型和含义。
- 规范未定义、但本项目确有观测需求的属性，使用 `corojaw.*` 命名空间，并说明含义、取值及采集条件。
- 不改变标准属性的语义来承载项目自定义概念；项目补充或收紧的约定应明确说明。

## 系统架构

```Plaintext
请求入口（agent.request）
→ 执行策略：排队 / 打断 / 取消 / step 级租约（不建 span，用属性与轨迹事件承载）
→ 按需加载或恢复历史：load_session
→ 循环执行 step：
     assemble_context（准备本次模型输入）→ chat（模型请求）→ execute_tool ×N（有 tool_call 时）
     工具结果追加进历史，进入下一 step
→ 历史超预算时触发压缩：compact_context（摘要替换旧历史）
→ 无 tool_call 或到步数上限，给出最终回复
```

## Trace 设计

### Span 分类总览

|组|span|name|示例|kind|描述|
|---|---|---|---|---|---|
|A 执行骨架|turn 执行|`invoke_agent {profile}`|`invoke_agent main`|INTERNAL|一次 turn attempt 的容器，每 turn 恰好 1 个|
|B 上下文|读会话|`load_session`|`load_session`|INTERNAL|实际加载或恢复会话历史时创建|
||组装上下文|`assemble_context`|`assemble_context`|INTERNAL|每次实际准备模型输入，包括预算检查与裁剪|
||压缩上下文|`compact_context`|`compact_context`|INTERNAL|压缩历史并替换执行使用的视图，仅在实际压缩时|
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
|H 入口|请求入口|`agent.request`|`agent.request`|SERVER|接收用户请求，覆盖 Agent 执行和结果交付|

### Span 父子关系

有入口时的标准树。没有入口 span 时 `invoke_agent` 就是根（父 = 当时的 active span，OTel 上下文规则，上游不规定这一层）。

```Plaintext
请求入口 span（agent.request）         接收用户请求
└─ invoke_agent main            [INTERNAL]  一次 turn attempt
   ├─ load_session              [INTERNAL]  本次确实加载或恢复时
   ├─ assemble_context          [INTERNAL]  本次模型输入准备
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
   └─ …下一 step：组装输入 → 模型调用 → 工具执行
```

上图示意加载发生在 turn 内的路径；turn 开始前的加载归属当时的 active span。压缩若由组装触发，`compact_context` 为 `assemble_context` 的子 span。

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

上下文处理分为会话加载、请求组装和历史压缩，分别回答「恢复了哪些历史」「本次模型使用什么输入」「历史如何被压缩」。

`load_session`、`assemble_context`、`compact_context` 均为项目自定义 span，按实际操作创建。字符数按 Unicode 码点统计；无法取得的统计不填写。

#### load\_session

从会话存储读取历史，恢复本次执行需要的消息视图。通常发生在会话首次加载或恢复时；会话常驻内存期间，后续 turn 不重复加载。若实现需要每次请求重新读取，则按实际读取记录。

|项|值|
|---|---|
|name / kind|`load_session`；INTERNAL|
|何时创建|实际读取或恢复历史时；直接沿用已加载的历史时不创建|
|父|发起加载的 active span；加载发生在 turn 开始前时，不强行归入 `invoke_agent`|
|子|实际发生的 Redis、数据库、文件等存储操作|

|分类|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|---|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|所属会话，生成规则见「关联键」|`3f9a1c8b7d2e4051`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn；加载发生在 turn 开始前且尚未归属具体 turn 时不填写|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
|读取来源|`corojaw.session.read_source`|可获得时填写|string|实际采用的历史来源：`redis`、`inmemory`、`filesystem`|`redis`|
|历史规模|`corojaw.session.message_count`|可获得时填写|int|恢复后的消息条数|`57`|
||`corojaw.session.transcript_chars`|可获得时填写|int|恢复后历史消息的文本字符总数|`48210`|
|状态与错误|`error.type`|失败时必填|string|本次历史加载最终失败的分类|`load_failed`|

失败分类，以下为项目定义：

|失败情况|`error.type`|
|---|---|
|历史读取或恢复超时|`timeout`|
|历史数据无法解析或恢复|`format`|
|历史读取失败，无法取得可用历史|`load_failed`|
|无法分类的失败|`_OTHER`|

#### assemble\_context

将指令、历史消息、当前输入、工具定义及实际召回的信息组装成本次模型调用的输入，并完成预算检查与必要的裁剪。

> TODO：确认项目的上下文分段、ContextProfile、缓存机制、指纹及 watermark 的实际设计，暂不定义相关属性。

|项|值|
|---|---|
|name / kind|`assemble_context`；INTERNAL|
|何时创建|每次实际准备模型调用输入时，包括使用缓存片段完成组装|
|父|发起组装的 active span，通常为 `invoke_agent`|
|子|组装期间实际发生的 `search_memory`、`retrieval`、`compact_context` 等操作|
|结束边界|本次模型输入准备完成，或组装失败|

静态指令可以在 turn 内复用；后续 step 加入工具结果后，仍记录本次输入准备过程。已经取得的检索或记忆结果直接复用，不重复创建对应操作 span。

|分类|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|---|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|所属会话|`3f9a1c8b7d2e4051`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|本次输入所属的主循环 step；独立摘要等调用不填写|`2`|
|输入规模|`corojaw.context.system_prompt_chars`|可获得时填写|int|最终输入中系统与开发者指令的文本字符总数|`38210`|
||`corojaw.context.history_chars`|可获得时填写|int|最终输入中历史消息的文本字符总数，不含本次新增用户输入|`61230`|
||`corojaw.context.tools_chars`|可获得时填写|int|最终输入中工具定义序列化后的字符总数|`22065`|
||`corojaw.context.estimated_input_tokens`|可估算时填写|int|组装完成后，包含指令、消息和工具定义的估算输入 token|`31200`|
|预算与裁剪|`corojaw.context.input_budget_tokens`|设置预算时必填|int|本次实际生效的输入 token 预算，不等同于模型上下文窗口上限|`32000`|
||`corojaw.context.trimmed`|发生裁剪时填写|boolean|本次因预算限制删除消息或截短内容时设为 `true`；不包含摘要压缩|`true`|
|状态与错误|`error.type`|失败时必填|string|本次输入组装最终失败的分类|`input_budget_exceeded`|

失败分类，以下为项目定义：

|失败情况|`error.type`|
|---|---|
|上下文组装超时|`timeout`|
|输入数据或模板不符合要求，无法组装|`format`|
|超过输入预算，且无法通过允许的裁剪或压缩完成组装|`input_budget_exceeded`|
|无法分类的失败|`_OTHER`|

#### compact\_context

将选定的历史片段压缩为摘要或其他压缩表示，并替换本次执行使用的历史视图。

> TODO：确认是否存在后台压缩；若候选生成与安装分离，补充两阶段的 span 边界及关联方式。

|项|值|
|---|---|
|name / kind|`compact_context`；INTERNAL|
|何时创建|实际开始压缩时；仅检查阈值、未执行压缩时不创建|
|父|发起压缩的 active span，如 `invoke_agent`、`assemble_context`|
|子|实际发生的摘要 `chat` 或专用压缩 API 调用|
|结束边界|压缩结果已替换到执行使用的历史视图，或压缩失败|

规模统计针对本次替换的历史片段：before 为原片段，after 为替换它的压缩内容。after 字段在替换成功且统计可获得时填写。

|分类|字段|是否必须|值类型|描述|值示例|
|---|---|---|---|---|---|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|所属会话|`3f9a1c8b7d2e4051`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|触发本次压缩的主循环 step；独立压缩任务不填写|`2`|
|触发原因|`corojaw.compaction.trigger`|已知时填写|string|`input_budget`：输入达到预算或压缩阈值；`manual`：显式要求压缩|`input_budget`|
|覆盖区间|`corojaw.compaction.from_seq`|历史具有序号时填写|int|本次计划替换区间的起始序号，包含端点|`120`|
||`corojaw.compaction.to_seq`|历史具有序号时填写|int|本次计划替换区间的结束序号，包含端点|`1024`|
|压缩规模|`corojaw.compaction.messages_before`|可获得时填写|int|原历史片段的消息条数|`96`|
||`corojaw.compaction.messages_after`|替换成功且可获得时填写|int|替换内容的消息条数|`1`|
||`corojaw.compaction.chars_before`|可获得时填写|int|原历史片段的文本字符总数|`182000`|
||`corojaw.compaction.chars_after`|替换成功且可获得时填写|int|替换内容的文本字符总数|`21000`|
||`corojaw.compaction.estimated_tokens_before`|可估算时填写|int|原历史片段的估算 token|`46000`|
||`corojaw.compaction.estimated_tokens_after`|替换成功且可估算时填写|int|替换内容的估算 token；与 before 使用相同估算口径|`5200`|
|状态与错误|`error.type`|失败时必填|string|本次压缩最终失败的分类|`summarization_failed`|

失败分类，以下为项目定义：

|失败情况|`error.type`|
|---|---|
|压缩操作整体超时|`timeout`|
|摘要或压缩服务调用失败|`summarization_failed`|
|压缩结果不符合要求，无法用于替换|`format`|
|压缩结果无法替换到执行使用的历史视图|`apply_failed`|
|无法分类的失败|`_OTHER`|

摘要模型的输入、输出用量记录在子调用中；本 span 的前后规模只用于衡量压缩效果。

后续 `chat` 实际采用压缩后的上下文时，设置 `gen_ai.conversation.compacted=true`。

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

表示一次记忆操作，覆盖记忆库管理、记录搜索与读写。

|项|定义|
|---|---|
|name / op|`{gen_ai.operation.name}`，取值见下表|
|kind|外部调用为 `CLIENT`，同进程记忆系统可用 `INTERNAL`|
|何时创建|每次逻辑记忆调用，批量记录对应一次调用|
|父|发起调用的 active span，如 `assemble_context`、`execute_tool`、`invoke_agent`|
|子|可观测的模型、向量生成、检索、存储或 HTTP 请求 span|

自动重试不另建记忆操作 span。

**操作类型**

|操作|含义|
|---|---|
|`create_memory_store`|创建或初始化记忆库|
|`delete_memory_store`|删除记忆库|
|`search_memory`|搜索记忆记录|
|`create_memory`|明确创建新记忆记录|
|`update_memory`|明确修改已有记忆记录|
|`upsert_memory`|由被调用接口决定创建、更新或合并记录|
|`delete_memory`|删除记忆记录；未指定记录 ID 时，可表示删除指定库中的全部记录|

**属性**

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|本次记忆操作类型|`search_memory`|
||`gen_ai.provider.name`|外部具名服务处理时必填|string|记忆服务 Provider 标识|`memory_service`|
|操作目标|`gen_ai.memory.store.id`|适用时填写|string|被操作的记忆库标识|`user-preferences-store`|
||`gen_ai.memory.record.id`|针对特定记录时必填|string|被操作的记忆记录标识|`mem_123`|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|所属会话，生成规则见「关联键」|`conv_123`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|所属主循环 step；上下文准备或独立维护任务不伪造序号|`2`|
|操作规模|`gen_ai.memory.record.count`|涉及记录且数量可获得时填写|int|搜索时为返回记录数；创建、更新、upsert、删除时为尝试操作的记录数|`3`|
|服务地址|`server.address`|外部服务地址可获得时填写|string|记忆服务地址|`memory.internal`|
||`server.port`|设置地址时填写|int|服务端口|`443`|
|重试|`corojaw.retry.count`|发生重试时填写|int|自动重试次数，不含首次请求|`1`|
|状态与错误|`error.type`|失败时必填|string|最终失败分类，见下表|`timeout`|

**失败分类**

优先使用记忆服务或客户端已定义的低基数错误码；没有适用错误码时，使用以下项目分类。

|失败情况|`error.type`|
|---|---|
|操作超时|`timeout`|
|无效凭据或权限不足|`auth`|
|请求被限流|`rate_limit`|
|服务容量不足|`overloaded`|
|请求或响应格式不符合协议|`format`|
|无法分类的失败|`_OTHER`|

查询原文与记忆内容不放入 span，通过内容引用记录。

### 工具

#### execute\_tool

表示一次逻辑工具调用，从工具执行入口开始，到结果交付、失败或终止结束。

|项|定义|
|---|---|
|name / kind / op|`execute_tool {gen_ai.tool.name}`；INTERNAL；`execute_tool`|
|何时创建|每次逻辑工具调用；并行调用分别创建|
|父|发起调用的 active span，如 `invoke_agent`、外层 `execute_tool`|
|子|工具内部可观测的模型、记忆、检索、存储或网络调用|

同一逻辑调用的内部自动重试不另建 `execute_tool` span；Agent 再次决定调用工具时，创建新的 span。

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|固定为 `execute_tool`|`execute_tool`|
|工具定义|`gen_ai.tool.name`|必须|string|注册工具的稳定名称|`weather_query`|
||`gen_ai.tool.description`|可获得时填写|string|工具职责描述|`查询指定城市的天气`|
||`gen_ai.tool.type`|可获得时填写|string|工具执行形态，含义见下表|`function`|
||`corojaw.tool.idempotent`|可获得时填写|boolean|工具是否幂等|`true`|
|执行关联|`gen_ai.tool.call.id`|模型或 Provider 提供时填写|string|模型或 Provider 提供的工具调用 ID，原样记录|`call_abc`|
||`gen_ai.agent.name`|可获得时填写|string|发起本次调用的 Agent profile 名|`main`|
||`gen_ai.conversation.id`|有会话时填写|string|所属会话，生成规则见「关联键」|`conv_123`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|所属主循环 step，并行工具沿用相同序号|`2`|
|执行结果|`corojaw.tool.cancelled`|因主动取消而结束时填写|boolean|调用方主动取消导致本次调用结束时设为 `true`；超时触发的内部取消不属于此类|`true`|
||`corojaw.tool.result_known`|调用结束时填写|boolean|是否能确认业务执行结果；确认未执行或结果已明确时为 `true`，可能已执行但结果不明时为 `false`|`false`|
||`corojaw.tool.truncated`|交付结果被截断时填写|boolean|Agent 运行时在工具结果交付阶段按输出限制截断内容时设为 `true`；不包含后续上下文组装时的裁剪|`true`|
|调用内容|`gen_ai.tool.call.arguments`|入参可获得时默认填写|object / JSON string|脱敏后的工具入参；超过采集上限时截断|`{"city":"北京"}`|
||`gen_ai.tool.call.result`|执行成功且有结果时默认填写|object / JSON string|脱敏后的工具返回值；超过采集上限时截断|`{"temperature":20}`|
|采集状态|`corojaw.tool.arguments.truncated`|入参采集副本被截断时填写|boolean|遥测中记录的入参不完整时设为 `true`|`true`|
||`corojaw.tool.result.truncated`|返回值采集副本被截断时填写|boolean|遥测中记录的返回值不完整时设为 `true`|`true`|
|重试|`corojaw.retry.count`|发生重试时填写|int|当前逻辑调用的内部自动重试次数，不含首次执行|`1`|
|状态与错误|`error.type`|失败时必填|string|最终失败分类，见下表|`timeout`|

**工具执行形态**

以下为 `gen_ai.tool.type` 的标准示例值，不作为封闭枚举。

|值|含义|示例|
|---|---|---|
|`function`|模型返回调用参数，由调用模型的应用执行工具并回填结果|Agent 应用执行天气查询函数|
|`extension`|外部 API 已集成到 Agent 执行平台，由平台调用并将结果交给模型|平台执行 API 扩展|
|`datastore`|用于访问、查询外部数据的工具|知识库查询工具|

**失败分类**

`error.type` 取值见下表；对应 OTel 领域规范另有规定时，遵循该规范。

|失败情况|`error.type`|
|---|---|
|工具执行超时|`timeout`|
|无权限执行工具或访问目标资源|`auth`|
|工具参数不符合要求|`invalid_argument`|
|工具报告执行失败|`tool_error`|
|无法分类的失败|`_OTHER`|

调用方主动取消不标记为错误，通过 `corojaw.tool.cancelled=true` 记录。

**内容采集**

- 工具入参和成功返回值默认采集，记录前脱敏。
- 入参、返回值分别设置大小上限，并限制单个 span 的内容总量。
- SDK 和后端支持结构化属性时记录对象，否则序列化为 JSON string。
- 超限时裁剪对象中的字符串、数组等内容，保留合法 JSON 结构。
- 采集截断仅作用于遥测副本，不改变实际执行参数、工具结果及模型输入。
- 需要完整内容时，通过内容引用关联外部存储。

#### 工具调用变体

以下三类是 `execute_tool` 的专化，复用其公共属性和失败分类。同一次调用只创建一个工具 span。

|变体|使用场景|示例|
|---|---|---|
|Skill 装载|将 skill 指令加载到 Agent 上下文|`load_skill`|
|Skill 资源读取|读取 skill 中的参考资料、脚本或其他资源|`read_skill_resource`|
|命令执行|执行普通命令或 skill 脚本|`exec_command`、`bash`|

**Span name**

基础名称为 `execute_tool {工具名}`，按可获得的信息追加后缀：

|变体|追加规则|示例|
|---|---|---|
|Skill 装载|有 skill 名时追加 skill 名，否则保留基础名称|`execute_tool load_skill code-review`|
|Skill 资源读取|有资源名时追加“skill 名＋资源名”；只有资源名则只追加资源名；无资源名则保留基础名称|`execute_tool read_skill_resource code-review references/policy.md`|
|命令执行|优先追加“skill 名＋资源名”；其次只追加资源名；没有资源名时追加可执行文件名；均不可获得则保留基础名称|`execute_tool bash code-review scripts/check.sh`|

资源读取和命令执行不单独追加 skill 名。资源名使用 skill 相对路径，完整命令、参数和绝对路径不拼入 span name。

**追加属性**

|分类|字段|适用变体|填写条件|类型|描述 / 示例|
|---|---|---|---|---|---|
|Skill 信息|`gen_ai.skill.name`|三类|关联 skill 且名称可获得|string|Skill 名，如 `code-review`|
||`gen_ai.skill.description`|三类|关联 skill 且描述可获得|string|Skill 职责描述|
||`gen_ai.skill.source.uri`|三类|关联 skill 且来源可获得|string|Skill 来源，如 `file:///skills/code-review/SKILL.md`|
|资源信息|`gen_ai.skill.resource.name`|资源读取、命令执行|关联命名资源且名称可获得|string|Skill 相对资源路径，如 `scripts/check.py`|
|进程信息|`process.executable.name`|命令执行|工具直接执行单个进程且名称可获得|string|实际启动的可执行文件名，如 `python3`|
||`process.executable.path`|命令执行|工具直接执行单个进程且路径可获得|string|实际可执行文件路径，如 `/usr/bin/python3`|
|执行结果|`process.exit.code`|命令执行|工具报告单个命令或进程的退出码|int|实际退出码，如 `0`|

执行 `bash -lc "git status"` 时，实际启动的是 `bash`，不能仅从命令文本中提取 `git` 作为可执行文件名。工具执行多个命令或后台进程尚未结束时，不伪造单个退出码。

### Agent 编排

#### 创建 Agent（create_agent）

表示一次独立的 Agent 创建操作，例如为新用户创建专属助手，或向远程服务创建托管 Agent。普通运行对象初始化不单独记录；执行已有 Agent 使用 `invoke_agent`。

|项|定义|
|---|---|
|name / kind / op|`create_agent {gen_ai.agent.name}`；远程创建为 `CLIENT`，同进程创建为 `INTERNAL`；`create_agent`|
|何时创建|每次独立创建可管理的 Agent 实体时|
|父|发起创建调用的 active span|
|子|实际发生的存储、HTTP 等调用 span|

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|调用身份|`gen_ai.operation.name`|必须|string|固定为 `create_agent`|`create_agent`|
||`gen_ai.provider.name`|远程标准形态必填|string|托管 Agent 服务的 Provider 标识；本项目同进程扩展无 Provider 时不填写|`gcp.vertex_ai`|
|Agent 定义|`gen_ai.agent.name`|应用提供时填写|string|被创建 Agent 的名称|`research`|
||`gen_ai.agent.description`|应用提供时填写|string|Agent 职责描述|`检索资料并生成研究报告`|
||`gen_ai.agent.version`|应用提供时填写|string|Agent 版本|`1.0.0`|
||`gen_ai.request.model`|可获得时填写|string|创建请求指定的模型|`model-name`|
|创建结果|`gen_ai.agent.id`|适用时填写|string|托管服务分配的稳定 Agent 资源 ID；不使用临时实例 ID，本地业务 ID 的记录方式另行定义|`agent_123`|
|服务地址|`server.address`|远程创建且地址可获得时填写|string|被调用的远程 Agent 服务地址，不含协议和路径|`agents.example.com`|
||`server.port`|设置远程服务地址时填写|int|被调用的远程 Agent 服务端口，如 HTTPS 使用 `443`|`443`|
|状态与错误|`error.type`|失败时必填|string|创建操作的低基数错误分类，无法分类时为 `_OTHER`|`timeout`|

#### 调用同进程 Agent（invoke_agent）

参考「Agent 执行骨架」的 `invoke_agent` 定义；子 Agent 使用自身名称，父节点为发起调用的 active span。

#### 调用远程 Agent（invoke_agent）

调用其他进程或服务中的 Agent 时，使用 GenAI `invoke_agent` 客户端规范，kind 为 `CLIENT`，name 为 `invoke_agent {gen_ai.agent.name}`，名称不可获得时为 `invoke_agent`。

#### 调用 Workflow（invoke_workflow）

略。

#### 规划（plan）

略。

### MCP

表示一次 MCP 请求或通知。发起方记录 `CLIENT` span，接收方记录 `SERVER` span；角色按本次消息方向判断，MCP 服务端主动发起请求时也属于发起方。

|项|定义|
|---|---|
|name|`{mcp.method.name} {target}`；target 使用工具名、prompt 名等低基数标识，没有合适目标时仅使用方法名|
|kind|发起方 `CLIENT`，接收方 `SERVER`|
|调用边界|请求从发起到响应接收完成；通知不等待业务响应|
|客户端父节点|发起调用的 active span|
|服务端父节点|从 MCP 消息中提取的远程上下文；已有传输上下文通过 Link 关联|

已有 `execute_tool` span 完整覆盖同一次 MCP 工具执行时，优先补充 MCP 属性，避免重复创建工具执行 span。

**属性**

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|调用身份|`mcp.method.name`|必须|string|MCP 方法名|`tools/call`|
||`gen_ai.operation.name`|工具调用时填写|string|固定为 `execute_tool`；其他操作不填写|`execute_tool`|
|操作目标|`gen_ai.tool.name`|工具调用时必填|string|被调用的工具名|`weather_query`|
||`gen_ai.prompt.name`|获取 prompt 时必填|string|被获取的 prompt 名|`summarize`|
||`mcp.resource.uri`|请求涉及资源 URI 时填写|string|目标资源 URI，不默认拼入 span name|`file:///docs/api.md`|
|协议关联|`jsonrpc.request.id`|请求携带非空 ID 时填写|string|当前请求 ID 的字符串表示；通知或 ID 为 null 时不填写|`"42"`|
||`mcp.session.id`|属于 MCP 会话时填写|string|MCP 会话标识|`8f2c1d9e4b7a`|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|项目补充：所属对话|`conv_123`|
||`corojaw.turn.id`|属于 turn 时必填|string|所属逻辑 turn|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
||`corojaw.step.seq`|属于 step 时必填|int|所属主循环 step|`2`|
|协议版本|`mcp.protocol.version`|可获得时填写|string|MCP 协议版本|`2025-11-25`|
||`jsonrpc.protocol.version`|不为 `2.0` 时填写|string|JSON-RPC 版本|`2.0`|
|传输信息|`network.transport`|可获得时填写|string|实际传输方式|`tcp`、`pipe`|
||`network.protocol.name`|适用时填写|string|小写应用层协议名|`http`|
||`network.protocol.version`|可获得时填写|string|应用层协议版本|`1.1`|
|服务地址|`server.address`|适用且可获得时填写|string|服务端地址|`mcp.example.com`|
||`server.port`|地址已填写且端口可获得时填写|int|服务端端口|`443`|
|客户端地址|`client.address`|服务端可获得时填写|string|发起请求的客户端地址|`10.12.0.7`|
||`client.port`|服务端可获得时填写|int|客户端端口|`51234`|
|响应结果|`rpc.response.status_code`|收到或返回 JSON-RPC 错误码时填写|string|JSON-RPC `error.code`，不是 HTTP 响应码|`"-32602"`|
|状态与错误|`error.type`|操作判定失败时必填|string|按下述错误规则填写|`tool_error`|

工具入参、返回值及其采集截断标记复用 `execute_tool` 的定义，不在重复的 span 中再次记录。stdio 调用不伪造网络协议和地址。

**错误规则**

|情况|客户端 span|服务端 span|
|---|---|---|
|JSON-RPC 错误响应|标记错误，`error.type` 为错误码字符串|按下述错误码规则判断|
|工具结果 `isError=true`|标记错误，`error.type=tool_error`|标记错误，`error.type=tool_error`|
|超时或传输失败|标记错误，使用 `timeout` 等适用分类|按本端实际操作结果判断|

以下 JSON-RPC 错误码不作为服务端错误；其他错误码应作为服务端错误：

|错误码|含义|
|---|---|
|`-32700`|解析错误|
|`-32600`|无效请求|
|`-32601`|方法不存在|
|`-32602`|参数无效，包括请求的工具不存在|
|`-32002`|资源不存在|

`rpc.response.status_code` 仍记录这些错误码。span 标记为 `ERROR` 且有 JSON-RPC 错误消息时，description 使用脱敏后的错误消息。

**上下文传播**

通过 MCP 消息的 `params._meta` 注入和提取 OTel 上下文：

- `traceparent`：关联本次 MCP 调用。
- `tracestate`：存在时传播。
- `baggage`：启用时按配置传播。

接收方优先使用消息上下文作为远程父节点；仅传播 HTTP header 不能保证 MCP 消息级关联。

### 入口

#### 请求入口

> TODO：待二次分析，确认请求入口与 Agent 执行的覆盖边界，以及 steer、异步执行场景下的 span 关联和生命周期。

表示一次用户请求的完整处理过程，覆盖请求接收、Agent 执行和最终结果交付。

|项|定义|
|---|---|
|name|`agent.request`|
|kind|`SERVER`，表示接收外部请求|
|调用边界|从接收请求开始，到 Agent 执行结束并交付结果，或请求失败、取消结束|
|父|有效的上游 trace context；没有时创建新 trace|
|子|`invoke_agent` 及请求处理过程中实际发生的其他调用|

|分类|字段|是否必须|类型|描述|示例|
|---|---|---|---|---|---|
|请求标识|`corojaw.request.id`|必须|string|本次请求的唯一标识，贯穿入口及后续执行|`req_123`|
|请求内容|`corojaw.request.query`|可获得时默认填写|string|用户本次输入，脱敏、限长后记录|`帮我分析今天的错误日志`|
|采集状态|`corojaw.request.query.truncated`|query 采集副本被截断时填写|boolean|遥测中的 query 不完整时设为 `true`|`true`|
|执行关联|`gen_ai.conversation.id`|有会话时填写|string|所属对话|`conv_123`|
||`corojaw.turn.id`|所属 turn 确定后填写|string|本次请求关联的逻辑执行|`01J9ZK3Q7X5B2M8N4C6D0E1F2G`|
|状态与错误|`error.type`|请求最终失败时必填|string|本次请求最终失败的分类|`timeout`|

`corojaw.request.id` 标识一次输入请求，`corojaw.turn.id` 标识一次逻辑 Agent 执行；steer 场景下，两次请求可能关联同一个 turn。

`agent.request` 和 `corojaw.request.*` 为项目定义；query 是用户原始请求，不等同于经过上下文组装后的模型输入。

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



