# Langfuse 最佳实践：一条好的 Trace 应该是什么样？

本文是 Langfuse 官方《What does a good trace look like?》的正文中文译文，用于研究与学习。翻译核对日期：2026-09-29。原文：[Best Practices](https://langfuse.com/docs/observability/best-practices)；固定源文件：[langfuse-docs / best-practices.mdx](https://github.com/langfuse/langfuse-docs/blob/1624429fcc881945b8ecd6e52ac908d06a9bbbfa/content/docs/observability/best-practices.mdx)，该文件提交时间为 2026-09-22。网站和本地实例后续可能变化，具体行为要结合所用版本核对。

原文所属文档仓库采用 MIT 许可：Copyright (c) 2022-2025 Langfuse GmbH。随本文保留[完整许可声明](assets/langfuse-docs-LICENSE.txt)。正文保留全部章节、说明、示例和原图链接，将网站专用组件转换为普通 Markdown；不包含网站导航和反馈组件。译者补充集中在最后一节，不属于原文。

---

## 一条好的 Trace 应该是什么样？

你已经在 Langfuse 中看到 trace 出现，但怎样判断埋点是否做得好？下面介绍几项可以检查和优化的内容。

Trace 结构不只是展示样式问题，Langfuse 的很多功能都依赖它：

- [LLM-as-a-judge 评估器](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)通过 observation 的名称和类型选择目标，并读取其输入和输出。
- [仪表盘](https://langfuse.com/docs/metrics/features/custom-dashboards)按 trace 和 observation 名称筛选、聚合指标。
- [数据集实验](https://langfuse.com/docs/evaluation/experiments)比较不同运行的 trace 输入与输出。
- Trace 列表的已保存视图会引用名称和属性。

结构良好的 trace 可以加快今天的调试；稳定的名称与有意义的输入输出，则能让应用持续演进时，评估器、仪表盘和实验继续正常工作。

## 一条 Trace 的范围是什么？

Langfuse 的[数据模型](https://langfuse.com/docs/observability/data-model)有三个分组层级：observations 代表单独步骤，通过 `trace_id` 归到 trace 中；多个 traces 又可以通过 `session_id` 归到 session 中。

一条 trace 代表应用中一个可以独立理解的工作单元。典型例子包括：

- 聊天机器人的一轮交互：用户发来消息，应用检索上下文、调用 LLM，再返回回答。
- Agent 的一次运行：Agent 收到任务，进行推理、调用工具，并产出结果。
- 流水线的一次执行：收到文档，切分、生成 embedding，再存储。

如果多个这样的工作单元连续发生，例如多轮对话，或多个 Agent 的运行共同形成一份最终报告，就应该使用 [sessions](https://langfuse.com/docs/observability/features/sessions)。每个工作单元有自己的 trace，session 将它们串起来。对于聊天机器人，这意味着每一轮一个 trace，整段对话一个 session：你无法预先知道对话何时结束，而按轮拆分可以让 trace 保持较小，并便于在 session 视图中浏览。

Langfuse 界面会将 trace 展示为 trace 树和 [Agent 图](https://langfuse.com/docs/observability/features/agent-graphs)：

![Trace 树，原文示例](https://langfuse.com/images/docs/faq/good-trace-tree.png)

![Agent 图，原文示例](https://langfuse.com/images/docs/faq/good-trace-agent-graph.png)

## 检查 Trace 树

点击一条 trace 后，可以看到 trace 树。下面几项值得检查。

### 是否出现了正确的步骤？

树中应该能够看到 LLM 调用、工具调用及其他重要步骤，而且它们应该使用正确的 [observation 类型](https://langfuse.com/docs/observability/features/observation-types)。

例如：

- LLM 调用应该显示为 `generation`。这很重要，因为 generation 可以携带[费用、token 用量和模型信息](#在-generation-上记录模型token-和费用)。
- 工具调用应该显示为 `tool`。这样创建 [LLM-as-a-judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge) 评估器时，就能筛选工具调用 observations。

框架集成通常会自动设置这些类型。如果手工埋点，可以通过 Python 的 `as_type` 参数或 JS/TS 的 `asType` 参数指定。完整类型列表见 [observation 类型文档](https://langfuse.com/docs/observability/features/observation-types)。

### 嵌套关系是否正确？

工具调用应该嵌套在负责组织该步骤的 `agent` 或 `span` [observation](https://langfuse.com/docs/observability/data-model#observations-traces-and-sessions) 下，与发起该工具调用的 `generation` 同级。这样树就能说明每个动作属于哪个步骤，而不是把工具调用孤立地挂在 trace 根部。

> 框架集成通常会自动处理好这件事。如果手工埋点，请参阅[嵌套 observations](https://langfuse.com/docs/observability/sdk/instrumentation#nesting-observations)。

**注意不要把多次 LLM 调用合成一个节点。** Agent 循环中的每次模型调用都应该有自己的 `generation`，并与它请求的 `tool` 调用交替出现。避免用一个父 generation 包住整个循环，而且只记录最终输出，否则将无法：

- 看出 Agent 收到每次工具结果后做了什么决定。
- 看出每个决定背后的[思考内容](#是否采集了思考内容)。
- 看出哪个工具调用使 Agent 的上下文窗口大幅增长，这对优化费用很有帮助。

**用一个 generation 包住整个循环：**只能看到汇总费用与最终输出。

![整个 Agent 循环折叠为一个 generation，原文示例](https://langfuse.com/images/docs/faq/good-trace-agent-collapsed-generation.png)

**每次模型调用各有一个 generation：**可以看到每个步骤后的思考内容、token 和费用。

![Generation 与工具调用交替出现，原文示例](https://langfuse.com/images/docs/faq/good-trace-agent-interleaved-generations.png)

### 是否采集了思考内容？

推理模型在回答或调用工具之前，会产生**思考**，也称 **reasoning**。应该为树中的每个 generation 采集思考内容。这类数据对调试很有帮助，可以用来理解 Agent 为什么做出某个决定，例如为什么调用特定工具或接口。

### 有没有不需要的噪音？

树中的每个 observation，并不一定都能帮助你理解应用做了什么。HTTP [observations](https://langfuse.com/docs/observability/data-model#observations-traces-and-sessions)、数据库查询和框架内部步骤，常常会增加杂乱程度，却没有提供有意义的洞察。如果这类 observations 干扰了 trace 树，可以[将它们过滤掉](https://langfuse.com/faq/all/unwanted-http-database-spans)。

![Trace 树中的噪音 observations，原文示例](https://langfuse.com/images/docs/faq/good-trace-noisy-spans.png)

## 选择好的名称

Observation 和 trace 的名称会用在很多地方：

- 配置 [LLM-as-a-judge 评估器](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)时，按名称指定目标 observations。
- 在[仪表盘](https://langfuse.com/docs/metrics/features/custom-dashboards)中，按 observation 名称筛选、聚合指标。
- 在 trace 列表中，通过名称快速判断每个步骤做什么。

因为这些地方都引用名称，应该把命名当作 API 来维护：名称一旦改变，匹配旧名称的评估器、仪表盘查询和已保存筛选条件，就会悄悄失去匹配对象。因此要认真选择名称，并尽量保持稳定。

**使用主动表达。** 根据执行的动作命名，并把动词放在前面，例如 `classify-intent`、`retrieve-context`、`generate-response`、`summarize-results`。这样 trace 树读起来就像一份应用执行过程的描述，也便于筛选具体步骤。

**不要把动态值放进名称。** 使用 `process-order`，而不是 `process-order-8945` 或 `generate-response-retry-2`。名称应该标识操作，而不是某一次执行；否则每条 trace 都产生新名称，便无法分组、筛选或选定目标。运行相关的值应放在 [metadata](https://langfuse.com/docs/observability/features/metadata) 中。这也符合 OpenTelemetry 对 span 名称采用低基数的建议。

> 尽量不要用 AI 模型名给 observation 命名，例如 `gpt-4o`、`claude-sonnet`。一旦换模型，引用这些名称的筛选器、评估器和仪表盘都会失效。Generation 已经有单独的 model 属性，应该使用它。

## 选择有意义的输入与输出

通常建议操作具有输入和/或输出。如果一个 observation 两者都没有，可以问自己：它是否真的有用，是否可以去掉？

**根 observation** 最值得认真处理：trace 级别的输入和输出由它派生，会显示在 trace 列表里，被评估器读取，也会在[数据集实验](https://langfuse.com/docs/evaluation/experiments)中跨运行比较。应该设置成评审者一眼就需要看到的内容。例如聊天机器人以用户消息作为输入、助手回答作为输出，而不是把函数参数的原始 JSON 整块放进去。需要调试用的原始 payload 时，可以放进 [metadata](https://langfuse.com/docs/observability/features/metadata)。

对于**最常查看的 observations**，也值得花更多精力设置。你很可能会在 trace 和 session 页面创建预先筛选好的视图；这些视图筛出的 observations 会被查看得最多。对它们，可以问自己：**为了快速判断一条 trace/session，我需要一眼看到什么？**

![展示输入与输出的 trace 列表，原文示例](https://langfuse.com/images/docs/faq/good-trace-tracing-table-io.png)

`GENERATION` observations 的典型输入输出包括：

- 聊天机器人：用户消息作为输入，助手回答作为输出。
- RAG 流水线：用户查询与生成的回答。
- 分类任务：待分类文本与预测标签。

> 多数输入输出可以渲染为带角色标签、易读的对话，而不是原始 JSON。如果显示为原始 JSON，可以检查格式：它应当是标准 OpenAI 格式的消息列表，每条消息包含 `role` 和 `content`。只有当工具调用位于 assistant 消息的 `tool_calls` 数组中，而且每次调用的 `arguments` 是 JSON 编码的字符串，例如 `"{\"location\": \"Paris\"}"`，工具调用才会渲染为卡片。

如果输入输出意外显示为空，请参阅[为什么 trace 的 input 和 output 为空？](https://langfuse.com/faq/all/empty-trace-input-and-output)

## 有用的属性

Observations 带有一些可能对你的使用场景有帮助的属性，可以进一步用于筛选、评分和创建仪表盘。

### 用 Metadata 补充上下文

[Metadata](https://langfuse.com/docs/observability/features/metadata) 是每个 observation 上灵活的键值存储。适合放置有用的上下文，但这些内容不属于名称或输入输出。实践中有用的例子包括：

- **评估上下文**：标准答案、预期行为，或 [LLM-as-a-judge 评估器](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge)需要的其他上下文，而这些内容并非实际输入输出的一部分。评估器可以在变量映射中引用 metadata 字段。
- **请求上下文**：内部请求 ID、处理该请求的 API 路由或应用版本、实验分组或已启用的功能开关。用于与其他系统关联 trace，并按发布变更筛选。
- **检索上下文**：RAG 步骤的数据源、检索到的片段数、查询的索引等。可以帮助调试检索结果为什么不理想。
- **原始 payload**：完整请求/响应对象。这些对象放在 input/output 中会干扰阅读，但偶尔调试又需要它们。
- **标注上下文**：人工审核时，metadata 为标注人员提供更多信息，帮助做出更好的判断。

在 Langfuse 界面中可以按 metadata 的键筛选，方便查找具有特定特征的 traces。

### 在 Generation 上记录模型、Token 和费用

如果希望了解 LLM 使用费用，并按模型、用户或功能拆分，需要在 `generation` observations 上记录三类信息：

- **模型名称**：Langfuse 用它查询[模型价格表](https://langfuse.com/docs/model-usage-and-cost)。名称不匹配时，就无法自动计算费用。
- **用量明细**：输入 tokens、输出 tokens，以及可选的缓存 tokens。仪表盘中的 token 用量视图依赖这些数据。
- **费用明细，可选**：需要覆盖 Langfuse 自动价格时，例如存在定制价格协议，可以显式传入费用。

大多数[集成](https://langfuse.com/integrations)会自动采集这些信息。如果手工埋点，请参阅 [token 和费用追踪文档](https://langfuse.com/docs/observability/features/token-and-cost-tracking)。

可以在 Langfuse 界面的 `GENERATION` observation 上看到这些属性。

![Generation 属性，原文示例](https://langfuse.com/images/docs/faq/good-trace-generation-attributes.png)

### 用 Tags 表达业务维度

[Tags](https://langfuse.com/docs/observability/features/tags) 支持按业务关注的维度筛选和拆分指标。好的 tags 能回答这样的问题：“来自 `web` 和 `api` 的用户，其延迟有什么差异？”

Tags 的一个特性是：**不可变，必须在创建 observation 时设置。** 因此适合表示提前知道的信息，例如请求来源和所属功能，不适合表示后来才确定的事情。

如果需要根据事后确定的内容给 traces 分类，例如 [LLM-as-a-judge](https://langfuse.com/docs/evaluation/evaluation-methods/llm-as-a-judge) 的评估结果，应该使用 [scores](https://langfuse.com/docs/evaluation/overview)。

### 将 Prompt 与 Trace 关联

如果在 Langfuse 中[管理 prompts](https://langfuse.com/docs/prompt-management)，可以[把它们关联到 generations](https://langfuse.com/docs/prompt-management/features/link-to-traces)。这样就能看到某条 trace 使用了哪个 prompt 版本，并追踪不同 prompt 版本的指标变化。迭代 prompt、比较表现时尤其有用。

### 设置 Environment

设置 [environment](https://langfuse.com/docs/observability/features/environments) 属性，例如 `production`、`staging`、`development`，避免测试 traces 混入生产仪表盘与评估。

### 用 User ID 追踪用户

设置 [user ID](https://langfuse.com/docs/observability/features/users)，可以把 traces 与特定用户关联，从而使用 Langfuse 的用户视图。适合回答以下问题：

- 哪些用户的使用费用最高？
- 不同用户的输出质量有什么差异？
- 某个用户的使用模式是什么？

### 用 Session ID 将相关 Traces 分组

如果应用中的多个 traces 在逻辑上属于同一个过程，就应把它们归入一个 [session](https://langfuse.com/docs/observability/features/sessions)。这样可以使用 session 回放视图，按顺序看到完整交互。

适用情形包括：

- 聊天机器人：每条用户消息创建一条新 trace，整段对话属于一个 session。
- 多个 Agent 共同产出最终结果，例如五个 Agent 协作生成报告。
- 工作流跨越多个请求，期间需要人工介入。

如果应用只是单次请求/单次响应，调用之间没有连续性，通常不需要 sessions。

![Sessions 视图，原文示例](https://langfuse.com/images/docs/faq/good-trace-sessions-view.png)

---

## 译者补充：如何应用到当前 Codex 环境

以下是本地研究结论，与上面的官方译文区分开。

原文“采集思考内容”应理解为记录模型/接口实际对外提供、且应用能够合法获得的 reasoning 内容或摘要，不能据此推断能够访问隐藏思维链。Codex 插件记录的是 rollout 中可用的内容；看到摘要不是看到全部内部推理。

原文建议丢弃没有输入输出的节点，是围绕 AI 调试和评估视图的设计建议。运行时 span 即使没有业务正文，也可能为耗时、等待和错误定位提供证据。对当前环境，应保留必要运行边界，并降低日常视图中的内部事件噪音。

| 官方原则                             | 当前 Codex 对照                                        | 学习或改进动作                          |
| ------------------------------------ | ------------------------------------------------------ | --------------------------------------- |
| 一轮工作一个 trace，多轮一个 session | 插件按 turn 建 AGENT，thread ID 作为 sessionId         | 从 session 选具体 turn 阅读             |
| 每次模型调用单独一个 generation      | 插件按解析出的 step 展示；原生的类型映射还包含内部函数 | 核对 name 和边界，不只数 GENERATION     |
| 清晰的输入输出                       | 插件 Input 是 transcript 重建视图                      | 用于行为分析；原始 wire 请求另找证据    |
| 过滤无关内部节点                     | 本轮原生约 80% 是 receiving/handle_responses           | 先聚合、按问题展开；采集降量单独设计    |
| 模型、tokens、费用放在 generation    | 插件较完整；原生 usage 在事件处理 span                 | 核对归属、缓存子集和价格，避免重复统计  |
| 使用 metadata、tags 与 scores        | 插件已有 turn、step、系统片段等属性                    | 选择能回答问题的字段；后验质量用 scores |
| 稳定命名与 prompt 版本关联           | 插件步骤名稳定，但不自动创建受管理 prompt              | 迭代 prompt 时额外配置版本关联          |

完整实例、技术机制、15 步上下文变化、时间统计局限与 CLI 教程见[用 Langfuse 看懂 Codex](langfuse-trace-reading-guide.md)。此处的建议没有自动修改插件、埋点或新增评分。
