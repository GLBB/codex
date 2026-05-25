# Building effective agents 中文精读版

原文：<https://www.anthropic.com/engineering/building-effective-agents>  
发布时间：2024-12-19  
图片目录：`learning/assets/building-effective-agents/`

说明：本文是按原文结构整理的中文精读版，用于学习和复盘，不是逐字全文翻译。原文图片已导出并嵌入在对应小节。

![Building effective agents hero](assets/building-effective-agents/00-hero.svg)

## 核心结论

Anthropic 的经验是：成功的 LLM agent 系统往往不是最复杂的系统，而是能用简单、可组合模式解决实际问题的系统。开发者应该先从单次 LLM 调用、检索、上下文示例和清晰工具接口做起，只有当评测证明简单方案不够时，才逐步加入 workflow 或 agent 的复杂度。

Agentic system 可以粗略分成两类：

- Workflow：LLM 和工具沿着预先写好的代码路径运行，适合可预测、可拆分、流程稳定的任务。
- Agent：LLM 动态决定下一步怎么做、调用什么工具、如何根据环境反馈推进任务，适合开放式、步骤数难以预估的任务。

这个区分很重要：并不是所有使用工具的 LLM 应用都需要做成 agent。很多产品场景只需要一个增强过的 LLM 调用，或者一个稳定 workflow。

## 什么时候使用 Agent

构建 LLM 应用时，优先选择能工作的最简单方案。Agentic system 往往用更高的延迟和成本换取更强的任务表现，因此要明确这个交换是否值得。

适合 workflow 的情况：

- 任务路径稳定。
- 子任务边界清楚。
- 你希望系统行为更可预测。
- 失败点可以用程序化检查或固定规则控制。

适合 agent 的情况：

- 任务开放，步骤数事先无法确定。
- 需要模型根据中间结果持续决策。
- 工具调用顺序高度依赖环境反馈。
- 你能接受更高成本，并愿意投入沙箱、评测和护栏。

很多场景里，优化 prompt、加入检索和上下文示例，已经足够。

## 关于框架

框架可以降低起步成本：调用模型、声明工具、解析工具调用、串联多个步骤，这些通用工作通常可以被框架封装。

但框架也会带来额外抽象层，使底层 prompt、模型响应和执行路径变得不透明，排查问题更困难。更稳妥的做法是先理解 API 和基础模式；即使用框架，也要清楚框架底下实际做了什么。

## 构建块：增强型 LLM

增强型 LLM 是 agentic system 的基础单元：在普通模型调用之外，加入检索、工具和记忆。

![The augmented LLM](assets/building-effective-agents/01-augmented-llm.png)

实现重点有两个：

- 能力要贴合具体用例，不要为了“有工具”而堆工具。
- 工具、检索和记忆要为模型提供清楚、稳定、易理解的接口。

Model Context Protocol 这类协议的价值也在这里：它让模型可以用统一方式连接外部工具和数据源。但协议本身不能替代好的工具设计。

## Workflow：Prompt Chaining

Prompt chaining 把任务拆成固定顺序的多个 LLM 调用。每一步处理上一步输出，必要时在中间加入程序化检查。

![The prompt chaining workflow](assets/building-effective-agents/02-prompt-chaining.png)

适用场景：

- 任务可以清晰拆成一串子任务。
- 每个子任务都比原任务更容易。
- 你愿意用额外延迟换更高准确率。

典型例子：

- 先生成营销文案，再翻译成另一种语言。
- 先写文档大纲，检查大纲满足要求后，再根据大纲写正文。

## Workflow：Routing

Routing 先判断输入类型，再把任务交给对应的下游流程、prompt 或工具。

![The routing workflow](assets/building-effective-agents/03-routing.png)

它的好处是隔离关注点：不同类型的问题可以分别优化，不必让一个通用 prompt 处理所有情况。

适用场景：

- 输入可以稳定分成不同类别。
- 不同类别需要不同处理方式。
- 分类本身可以由 LLM 或传统分类器可靠完成。

典型例子：

- 客服中把一般咨询、退款请求、技术支持路由到不同流程。
- 把简单常见问题交给低成本模型，把困难或罕见问题交给更强模型。

## Workflow：Parallelization

Parallelization 让多个 LLM 调用并行工作，再由程序聚合结果。它主要有两种形态：

- Sectioning：把任务拆成互相独立的子任务并行处理。
- Voting：用多个调用处理同一任务，通过多视角或投票提高可靠性。

![The parallelization workflow](assets/building-effective-agents/04-parallelization.png)

适用场景：

- 子任务天然可以并行，能节省时间。
- 需要多个独立判断来降低误判。
- 复杂任务包含多个评价维度，每个维度最好单独关注。

典型例子：

- 一个模型处理用户请求，另一个模型做安全或内容筛查。
- 多个评审 prompt 同时审查代码漏洞。
- 多个判断器从不同角度评估内容是否违规。

## Workflow：Orchestrator-Workers

Orchestrator-workers 模式中，一个中心 LLM 根据任务动态拆分工作，分配给多个 worker LLM，再综合结果。

![The orchestrator-workers workflow](assets/building-effective-agents/05-orchestrator-workers.png)

它和 parallelization 的外观相似，但关键差异是：子任务不是提前写死的，而是 orchestrator 根据输入临时决定。

适用场景：

- 任务复杂，事先无法预测需要哪些子任务。
- 不同输入需要完全不同的拆分方式。
- 需要一个中心角色负责分解、调度和汇总。

典型例子：

- Coding agent 需要根据需求决定改哪些文件、怎么改。
- 搜索任务需要从多个来源收集信息，并判断哪些信息相关。

## Workflow：Evaluator-Optimizer

Evaluator-optimizer 模式中，一个 LLM 负责生成答案，另一个 LLM 负责评价并给反馈，系统在循环中逐步改进结果。

![The evaluator-optimizer workflow](assets/building-effective-agents/06-evaluator-optimizer.png)

适用场景：

- 评价标准清晰。
- 迭代改进能带来可观察收益。
- 人类反馈能明显改善结果，并且模型也能给出类似反馈。

典型例子：

- 文学翻译：生成器先翻译，评价器指出语气、细节、语义问题。
- 复杂搜索：评价器判断已有信息是否充分，是否需要继续搜索。

## Agent：自主循环

Agent 在能力成熟后才更有价值：模型需要能理解复杂输入、计划、可靠使用工具，并能从错误中恢复。

![Autonomous agent](assets/building-effective-agents/07-autonomous-agent.png)

一个典型 agent 会从用户指令或交互澄清开始。任务明确后，它会独立规划和执行，并在关键节点或遇到阻碍时回到人类那里请求判断。

执行期间，agent 必须持续从环境获得真实反馈，例如工具结果、测试结果、代码执行结果。否则它很容易在自己的推理里越走越偏。

适合 agent 的场景：

- 问题开放，无法硬编码固定路径。
- 步骤数和工具顺序事先未知。
- 环境反馈对下一步决策至关重要。
- 你对模型决策有一定信任，并且能提供沙箱、护栏和停止条件。

Agent 的风险也更高：成本增加、错误可能累积，所以需要广泛测试、沙箱执行和合适的人工检查点。

## Coding Agent 的高层流程

![High-level flow of a coding agent](assets/building-effective-agents/08-coding-agent-flow.png)

Coding agent 特别适合 agent 模式，因为软件开发天然提供反馈闭环：

- 代码是否正确可以通过测试验证。
- Agent 可以根据测试结果迭代。
- 问题空间相对结构化。
- 输出质量可以被客观指标部分衡量。

但测试只能验证功能的一部分。真实工程里，仍然需要人类审查设计、维护性、系统约束和长期影响。

## 不要把模式当教条

这些模式不是固定模板，而是常见构件。实际系统里可以组合它们：例如先 routing，再在某个分支里使用 prompt chaining；或者让 coding agent 内部用 evaluator-optimizer 评审补丁。

关键原则是评测驱动：只有当复杂度能被指标证明带来收益时，才值得加入。

## 三条实践原则

1. 保持设计简单。
2. 让 agent 的计划、步骤和状态尽可能透明。
3. 像设计人机界面一样认真设计 agent-computer interface，也就是工具接口、参数、文档、错误提示和测试样例。

越接近生产，越要愿意减少抽象层，回到基础组件，确保行为可理解、可调试、可维护。

## 附录要点：Agent 的实践场景

### 客服

客服 agent 有天然优势：它既需要对话，又需要操作。它可以查客户数据、订单历史、知识库，也可以发起退款、更新工单等动作。

适合的原因：

- 支持过程本来就是多轮对话。
- 工具能接入真实业务数据和动作。
- 解决结果相对容易定义。
- 可以加入人工监督和明确成功标准。

### 编程

编程场景的优势是反馈清楚。Agent 可以读问题、改代码、运行测试、根据失败信息继续迭代。SWE-bench 这类基准也说明，coding agent 可以从 PR 描述出发解决真实问题。

但工程质量不等于测试通过。代码风格、系统约束、兼容性、安全边界和可维护性仍然需要审查。

## 附录要点：给工具做 Prompt Engineering

工具定义和普通 prompt 一样需要精心设计。模型不是只看工具名字，它会根据描述、参数、返回格式和错误信息来决定如何使用工具。

设计工具格式时，优先选择模型容易写对的形式：

- 给模型足够空间先思考，不要让它一开始就被复杂格式困住。
- 使用模型在互联网文本中常见的格式。
- 避免让模型承担额外格式负担，例如精确计算 diff chunk 行数，或在 JSON 字符串里大量转义代码。

设计工具接口时，可以把它当作给初级工程师写 docstring：

- 名称、参数和描述要一眼看懂。
- 写清边界、示例、输入格式和常见错误。
- 多个工具相似时，尤其要让差异明确。
- 用大量真实样例测试模型怎么调用工具。
- 通过参数设计减少误用，例如要求绝对路径而不是相对路径。

原文里一个很有工程味的例子是：在 SWE-bench agent 中，团队发现模型在切换工作目录后容易错用相对路径，于是把工具改成要求绝对路径，问题就显著减少。

## 对 Codex 学习的启发

结合这个仓库里的学习路线，可以把本文放在三个位置反复读：

- 阶段 0：理解 workflow 和 agent 的边界，不要把所有 LLM 应用都叫 agent。
- 阶段 1：写最小 agent loop，先把工具调用、环境反馈、停止条件跑通。
- 阶段 3 以后：学习 harness、权限、沙箱、上下文、事件流和评测，这些才是生产级 agent 的主要复杂度。

对 coding agent 来说，最值得带走的观点是：

- 工具接口质量比大而全的 prompt 更重要。
- 测试结果是 agent 的 ground truth。
- 透明计划、检查点和沙箱是让 agent 可用可信的基础。
- 框架可以提速，但生产系统必须能看到真实 prompt、响应、工具调用和错误路径。

## 图片清单

| 文件 | 内容 |
| --- | --- |
| `assets/building-effective-agents/00-hero.svg` | 原文首图 |
| `assets/building-effective-agents/01-augmented-llm.png` | The augmented LLM |
| `assets/building-effective-agents/02-prompt-chaining.png` | The prompt chaining workflow |
| `assets/building-effective-agents/03-routing.png` | The routing workflow |
| `assets/building-effective-agents/04-parallelization.png` | The parallelization workflow |
| `assets/building-effective-agents/05-orchestrator-workers.png` | The orchestrator-workers workflow |
| `assets/building-effective-agents/06-evaluator-optimizer.png` | The evaluator-optimizer workflow |
| `assets/building-effective-agents/07-autonomous-agent.png` | Autonomous agent |
| `assets/building-effective-agents/08-coding-agent-flow.png` | High-level flow of a coding agent |
