# A practical guide to building agents 中文精读版

原文 PDF：<https://cdn.openai.com/business-guides-and-resources/a-practical-guide-to-building-agents.pdf>  
本地 PDF：`../references/a-practical-guide-to-building-agents.pdf`  
页数：34 页  
创建时间：2025-04-07

说明：本文按 OpenAI 原 PDF 的章节顺序整理为中文精读版，覆盖核心观点、判断框架、设计模式和工程建议。它不是逐页逐字翻译，也不是原 PDF 的完整中文替代版；需要核对原始措辞、代码和版式时，请以本地 PDF 或官方链接为准。

![Cover image](../assets/a-practical-guide-to-building-agents/image-000.jpg)

## 目录

1. 什么是 Agent
2. 什么时候应该构建 Agent
3. Agent 设计基础
4. 编排模式
5. Guardrails
6. 结论与落地建议

## 引言

大语言模型正在更擅长处理复杂、多步骤任务。推理、多模态和工具使用能力的提升，使一类新的 LLM 系统成为可能：Agent。

这份指南面向正在探索如何构建第一个 Agent 的产品和工程团队。它把 OpenAI 从多个客户部署中获得的经验，整理成可操作的实践建议：如何识别适合 Agent 的场景，如何设计 Agent 逻辑和编排方式，以及如何让 Agent 在生产环境中安全、可预测、有效地运行。

读完这份资料，你应该能开始搭建第一个 Agent 的基础版本，并知道哪些复杂度应该等到真实评估后再逐步加入。

## 什么是 Agent

传统软件可以帮助用户简化和自动化工作流；Agent 更进一步，可以代表用户以较高独立性完成这些工作流。

可以把 Agent 理解为：

- 一个能代表用户独立完成任务的系统。
- 它不仅回答问题，还能推进工作流。
- 它会根据任务状态决定下一步，调用工具，必要时纠正行动。

这里的 workflow 指的是为了达成用户目标而必须执行的一系列步骤，比如解决客服问题、预订餐厅、提交代码变更或生成报告。

不是所有集成 LLM 的应用都是 Agent。简单聊天机器人、单轮 LLM 调用、情感分类器，如果没有让 LLM 控制工作流执行，就不属于 Agent。

一个 Agent 至少具备两个核心特征：

1. 使用 LLM 管理工作流执行和做决策。它能判断工作流是否完成，在必要时主动纠正行动；如果失败，也能停止执行并把控制权交还给用户。
2. 能访问多种工具，用来和外部系统交互，包括获取上下文和执行动作。它会根据当前工作流状态动态选择工具，并始终在明确 guardrails 内运行。

## 什么时候应该构建 Agent

构建 Agent 意味着要重新思考系统如何决策、如何处理复杂度。和传统自动化不同，Agent 特别适合那些确定性规则和传统流程难以覆盖的工作流。

PDF 中用支付欺诈分析举例：传统规则引擎像清单，根据预设条件标记交易；LLM Agent 更像有经验的调查员，能评估上下文、识别细微模式，即使没有触发明确规则，也可能发现可疑行为。

优先考虑那些过去很难自动化的工作流，尤其是以下三类：

| 场景 | 说明 | 示例 |
| --- | --- | --- |
| 复杂决策 | 需要细致判断、处理例外或依赖上下文 | 客服中的退款审批 |
| 难维护规则 | 系统依赖大量复杂规则，更新昂贵且容易出错 | 供应商安全审查 |
| 非结构化数据 | 需要解释自然语言、理解文档或和用户对话 | 处理家庭保险理赔 |

在决定构建 Agent 前，要验证你的场景是否清楚满足这些条件。否则，传统确定性方案可能已经足够。

## Agent 设计基础

最基础的 Agent 由三个组件组成：

| 组件 | 作用 |
| --- | --- |
| Model | 支撑 Agent 推理和决策的 LLM |
| Tools | Agent 可调用的外部函数或 API |
| Instructions | 明确定义 Agent 行为方式的指令和护栏 |

OpenAI Agents SDK 的最小示例大意是：定义一个名为 Weather agent 的 Agent，给它一段说明，并把 `get_weather` 这类工具挂上去。你也可以不用 SDK，直接用其他库或从零实现这些概念。

### 选择模型

不同模型在任务复杂度、延迟和成本上有不同权衡。一个 Agent 工作流里，未必所有步骤都需要最强模型。

简单的检索或意图分类，可以用更小更快的模型；判断是否批准退款这类高风险复杂任务，可能需要更强模型。

推荐做法：

1. 先用最强模型为所有任务建立性能基线。
2. 用 evals 验证 Agent 是否达到目标准确率。
3. 再逐步把部分任务替换成更小模型，观察是否仍能满足质量要求。
4. 在不牺牲目标质量的前提下，优化成本和延迟。

这可以避免过早限制 Agent 能力，也能帮助你看清小模型在哪些环节可用、在哪些环节会失败。

### 定义工具

工具通过底层应用或系统 API 扩展 Agent 能力。对于没有 API 的老系统，Agent 也可以借助 computer-use 类模型，通过网页或应用 UI 像人一样操作系统。

每个工具都应该有标准化定义，这样工具和 Agent 才能形成灵活的多对多关系。文档充分、测试完整、可复用的工具能提高可发现性，简化版本管理，并减少重复定义。

Agent 常见工具分三类：

| 类型 | 作用 | 示例 |
| --- | --- | --- |
| Data | 获取执行工作流所需的上下文和信息 | 查询交易数据库、读取 CRM、读取 PDF、网页搜索 |
| Action | 和系统交互并执行动作 | 发邮件/短信、更新 CRM 记录、把客服工单转给人工 |
| Orchestration | Agent 本身作为另一个 Agent 的工具 | Refund agent、Research agent、Writing agent |

当工具数量不断增加时，要考虑是否把任务拆分到多个 Agent 中，而不是让单个 Agent 同时面对过多相似工具。

### 配置 Instructions

高质量 instructions 对所有 LLM 应用都重要，对 Agent 尤其重要。清晰指令能减少歧义，改善决策质量，让工作流执行更平稳、错误更少。

实践建议：

| 建议 | 说明 |
| --- | --- |
| 使用已有文档 | 把 SOP、支持脚本、政策文档、知识库文章转成 Agent 可执行的流程 |
| 拆解任务 | 把密集资源拆成更小、更清楚的步骤，降低歧义 |
| 定义清楚动作 | 每一步都对应明确动作或输出，例如询问订单号、调用 API、回复用户固定措辞 |
| 覆盖边界情况 | 预先写明用户信息不完整、提出意外问题、走到条件分支时该怎么办 |

PDF 还建议可以使用更高级模型，从现有帮助中心文档自动生成 numbered instructions。核心思路是：让模型把政策文档转换成无歧义、面向 Agent 的编号步骤。

## 编排模式

有了模型、工具和 instructions 后，就可以考虑编排方式，让 Agent 有效执行工作流。

虽然直接构建复杂自治 Agent 很诱人，但 OpenAI 的客户实践更支持增量路线。先从简单形态开始，再根据失败模式逐步拆分和编排。

编排大致分两类：

1. 单 Agent 系统：一个模型配备合适工具和指令，在循环中执行工作流。
2. 多 Agent 系统：多个协作 Agent 共同分担工作流执行。

### 单 Agent 系统

单 Agent 可以通过逐步增加工具来处理很多任务。这样复杂度更可控，也更容易评估和维护。

![单 Agent 系统图表页](../assets/a-practical-guide-to-building-agents/pages/page-14.png)

所有编排方式都需要一个 `run` 概念，本质是一个循环：让 Agent 持续运行，直到达到退出条件。

常见退出条件包括：

- 工具调用完成。
- 产生某种结构化最终输出。
- 发生错误。
- 达到最大轮数。
- 模型返回不含工具调用的最终回答。

在 Agents SDK 中，`Runner.run()` 会循环调用 LLM，直到触发最终输出工具，或模型返回无需继续调用工具的消息。

为了在不切到多 Agent 框架的情况下管理复杂性，可以使用 prompt template。也就是维护一个灵活的基础 prompt，再把用户信息、政策变量、场景变量注入进去。这样新增场景时，不必重写整个工作流，只需更新变量。

### 什么时候拆成多个 Agent

总体建议是：先最大化单 Agent 能力。多个 Agent 能带来概念隔离，但也会引入更多复杂度和运行开销。很多场景，一个配好工具的单 Agent 已经足够。

当出现以下问题时，再考虑拆分：

| 信号 | 说明 |
| --- | --- |
| 复杂逻辑 | prompt 里有大量条件分支，模板开始难以扩展 |
| 工具过载 | 工具之间相似或重叠，Agent 经常选错工具 |

工具数量本身不是唯一问题。有些系统能稳定使用 15 个以上命名清楚、职责分明的工具；另一些系统不到 10 个工具就会失败，因为工具定义重叠、参数含糊或描述不清。只有在改善工具名称、参数和描述后仍然不稳定，才更应该拆成多个 Agent。

### 多 Agent 系统

多 Agent 可以有很多设计形态，但 PDF 重点介绍两类广泛适用模式：

| 模式 | 说明 |
| --- | --- |
| Manager | 中央 manager Agent 通过工具调用协调多个专门 Agent |
| Decentralized | 多个平级 Agent 根据专长互相 handoff |

多 Agent 系统可以建模为图：Agent 是节点。Manager 模式下，边代表工具调用；去中心化模式下，边代表把执行权转交给另一个 Agent。

无论用哪种编排方式，原则相同：组件要灵活、可组合，并由清晰结构化 prompt 驱动。

### Manager 模式

Manager 模式用一个中心 LLM 协调一组专门 Agent。Manager 负责判断什么时候把任务委派给哪个 Agent，并把结果整合成统一交互。

![Manager pattern 图表页](../assets/a-practical-guide-to-building-agents/pages/page-18.png)

这种模式适合：

- 希望只有一个 Agent 控制工作流执行。
- 希望用户体验保持统一。
- 专门能力需要按需调用，而不是完全接管对话。

PDF 的例子是翻译任务：manager agent 收到“把 hello 翻译成西班牙语、法语和意大利语”，然后分别调用 Spanish agent、French agent、Italian agent 作为工具，再汇总输出。

### 声明式图和代码优先

有些框架要求开发者提前声明所有节点、边、分支、循环和条件。这样可视化清楚，但当工作流越来越动态复杂时，会变得笨重，也可能要求学习专门 DSL。

Agents SDK 采用更灵活的 code-first 思路：开发者可以直接用熟悉的编程结构表达工作流逻辑，不必提前定义完整图。这更适合动态和适应性强的 Agent 编排。

### Decentralized 模式

去中心化模式中，Agent 可以把工作流执行权 handoff 给另一个 Agent。Handoff 是单向转移：一旦某个 Agent 调用 handoff 函数，系统会立即启动被交接的 Agent，并把最新对话状态转过去。

![Decentralized handoff 图表页](../assets/a-practical-guide-to-building-agents/pages/page-21.png)

这种模式适合：

- 不需要单个 Agent 保持中央控制。
- 某个专门 Agent 接手后应直接和用户互动。
- 任务天然可以由不同专门团队/流程分别处理。

PDF 的客服例子中，Triage agent 先判断用户问题属于技术支持、销售还是订单管理，然后把执行权转给对应 Agent。例如用户问最近采购的交付时间，Triage agent 会转给 Order Management Agent。

必要时，也可以给第二个 Agent 配置 handoff 回原 Agent 的能力。

## Guardrails

良好 guardrails 可以帮助管理数据隐私风险和声誉风险，例如防止系统 prompt 泄露、确保模型行为符合品牌要求。

Guardrails 是任何 LLM 部署的关键组件，但不能替代标准安全工程。它们应该和认证、授权、严格访问控制、常规软件安全措施一起使用。

PDF 建议把 guardrails 看作分层防御：单个护栏通常不够，多个专门护栏组合起来才更稳健。可以把 LLM-based guardrails、基于规则的保护、Moderation API 等组合起来检查输入和输出。

![Guardrails 分层图表页](../assets/a-practical-guide-to-building-agents/pages/page-25.png)

### Guardrails 类型

| 类型 | 作用 | 示例 |
| --- | --- | --- |
| Relevance classifier | 确保 Agent 回答保持在预期范围内 | 把“帝国大厦多高”这类无关输入标记为 off-topic |
| Safety classifier | 检测越狱、prompt injection 等不安全输入 | 用户诱导模型泄露系统指令 |
| PII filter | 防止不必要地暴露个人身份信息 | 检查模型输出是否包含潜在 PII |
| Moderation | 标记仇恨、骚扰、暴力等有害或不合适输入 | 维护安全、尊重的交互 |
| Tool safeguards | 根据工具风险等级决定是否暂停、检查或升级人工 | 写操作、不可逆操作、金融影响大的工具更高风险 |
| Rules-based protections | 用黑名单、长度限制、正则等确定性规则阻断已知威胁 | 禁止词、SQL injection 模式 |
| Output validation | 检查输出是否符合品牌价值和内容要求 | 避免损害品牌完整性的回复 |

### 构建 Guardrails

OpenAI 给出的启发式做法：

1. 先关注数据隐私和内容安全。
2. 根据真实世界边界案例和失败案例逐步增加新的 guardrails。
3. 同时优化安全和用户体验，随着 Agent 演进持续调参。

Agents SDK 把 guardrails 作为一等概念。默认策略是 optimistic execution：主 Agent 会主动生成输出，guardrails 同时运行；如果违反约束，就触发异常或中断。

Guardrails 可以实现为普通函数，也可以实现为专门 Agent，用来执行越狱防护、相关性校验、关键词过滤、黑名单、安全分类等策略。

### 人工介入

人工介入是重要安全机制，尤其适合早期部署阶段。它既能改善真实环境表现，也能帮助发现失败模式、边界案例，并建立评估循环。

Agent 无法完成任务时，应该优雅地把控制权交还给人类：

- 客服场景：升级给人工客服。
- Coding agent：把控制权交还给用户。

常见触发条件有两类：

| 触发条件 | 说明 |
| --- | --- |
| 超过失败阈值 | 达到重试次数或行动次数上限，例如多次无法理解用户意图 |
| 高风险动作 | 敏感、不可逆或高风险行为，例如取消订单、批准大额退款、发起付款 |

在你对 Agent 可靠性还没有足够信心前，高风险动作应保持人工监督。

## 结论

Agent 标志着工作流自动化进入一个新阶段：系统不仅能处理自然语言，还能在不确定性中推理，跨工具执行动作，并以较高自主性完成多步骤任务。

和更简单的 LLM 应用不同，Agent 会端到端执行工作流。因此，它适合复杂决策、非结构化数据和脆弱规则系统这类场景。

要构建可靠 Agent，应从坚实基础开始：

- 选择能满足任务复杂度的模型。
- 定义清楚、可测试、可复用的工具。
- 写出结构化、无歧义的 instructions。
- 按复杂度选择编排模式，从单 Agent 开始，只在需要时演进到多 Agent。
- 在每个阶段加入 guardrails，从输入过滤、工具使用到 human-in-the-loop。

部署不是非黑即白。更稳妥的路线是：从小处开始，用真实用户验证，再逐步扩展能力。只要基础正确、迭代方式合理，Agent 就能创造实际业务价值，不只是自动化单个任务，而是智能、适应性地自动化整个工作流。

## 对个人 Agent 学习的启发

这份 PDF 很适合放在学习路线的早期和中期反复读：

- 阶段 0：用它理解“什么才算 Agent”，以及 Agent 和普通 LLM 应用的边界。
- 阶段 1：参考它的三件套：model、tools、instructions，写最小 Agent。
- 阶段 3：学习 run loop、退出条件、单 Agent 和多 Agent 编排。
- 阶段 6 以后：重点研究 guardrails、工具风险分级、人工介入和生产安全。

和 Anthropic 那篇《Building effective agents》放在一起看，会形成一张很清楚的地图：

- Anthropic 更强调简单模式、workflow 和 agent 的边界。
- OpenAI 这份 PDF 更偏产品和工程落地，强调模型选择、工具定义、instructions、编排和 guardrails。

## 本地资源

| 文件 | 说明 |
| --- | --- |
| `../references/a-practical-guide-to-building-agents.pdf` | 官方 PDF 本地副本 |
| `./a-practical-guide-to-building-agents.zh.md` | 中文精读版 |
| `../assets/a-practical-guide-to-building-agents/` | 从 PDF 导出的图片资源 |
| `../assets/a-practical-guide-to-building-agents/pages/page-14.png` | 单 Agent 系统图表页截图 |
| `../assets/a-practical-guide-to-building-agents/pages/page-18.png` | Manager pattern 图表页截图 |
| `../assets/a-practical-guide-to-building-agents/pages/page-21.png` | Decentralized handoff 图表页截图 |
| `../assets/a-practical-guide-to-building-agents/pages/page-25.png` | Guardrails 分层图表页截图 |
