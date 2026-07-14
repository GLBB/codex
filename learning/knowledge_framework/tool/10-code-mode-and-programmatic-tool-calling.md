# Code Mode 与程序化工具编排

## 在知识框架中的位置

Code Mode 属于 [Agent 知识框架](../agent_knowledge_framework) 中的 **Tool 与行动系统 → 程序化工具编排**。它建立在 Tool Contract、Catalog、Policy 和 Runtime 之上，再由 Agent Loop 决定何时使用：

```text
Model-visible Tool Contract
        ↓
Catalog / Exposure Planning
        ↓
Policy / Approval
        ↓
Direct Tool Call ───────────────┐
        or                      │
Generated Program              │
        ↓                       │
Program Runtime / Code Mode     │
        ↓ nested tool calls     │
Tool Runtime / External System ←┘
        ↓
Bounded Observation
        ↓
Agent Loop continues or stops
```

它不是一种文件、Shell 或浏览器能力，也不是独立 Agent。它改变的是模型**如何编排一组工具**：模型不再为每一步都重新采样，而是生成一段受控程序，让程序在专门 Runtime 中调用允许嵌套的工具。

## 先区分三个概念

### Direct Tool Calling

模型产生一个或多个结构化 Tool Call，Agent Orchestrator 执行它们，再把 Observation 送回模型。模型需要新的语义判断时继续下一轮：

```text
Model → call A → observation A → Model → call B → observation B → Model
```

它适合调用较少、每一步都需要语义判断、需要逐次审批或必须让模型看到完整中间证据的任务。

### Programmatic Tool Calling

这是通用概念：模型生成程序，用循环、分支、并发和数据变换组合多个工具调用。程序的执行环境可以由 Model Provider 托管，也可以由 Agent Harness 提供。

OpenAI Responses API 把其具体能力称为 Programmatic Tool Calling。程序运行在 Provider 提供的隔离 JavaScript Runtime 中，程序发出的工具调用仍要通过协议返回给调用方执行并回传结果。它适合在中间结果进入模型上下文之前完成筛选、聚合和裁剪。

### Code Mode

`Code Mode` 是一些产品和实现采用的名称，不是统一行业协议。Cloudflare 用它描述“让模型编写代码而不是逐项请求操作”的工具使用模式；Codex 也有名为 Code Mode 的具体实现。

本文用：

- **程序化工具编排**表示通用知识节点；
- **Programmatic Tool Calling**表示 Provider API 中常见的实现形态；
- **Codex Code Mode**表示当前仓库中的具体实现。

不要仅凭名字推断程序运行位置、语言、状态生命周期或安全边界。

## 为什么会增加这种模式

### 工具定义会挤占上下文

传统方式常把大量 Tool Definition 放入模型请求。接入几十个 MCP Server 或上千个 API 后，名称、描述和 JSON Schema 会消耗大量上下文，也会增加模型选错工具的机会。

程序化编排可以结合 Namespace、Tool Search 和 Deferred Loading，只向模型或 Program Runtime 暴露当前阶段需要的能力。它不会自动解决目录膨胀，但提供了按需发现并在程序中组合能力的落点。

### 中间结果未必值得进入模型上下文

假设要查询 100 个对象，再找出错误率最高的 5 个。Direct Tool Calling 可能把 100 份原始结果逐次送回模型；程序则可以在 Runtime 中并发查询、抽取字段、排序，只返回 5 条有界结果。

```text
Direct:
100 calls → 100 raw observations → model context → reduce

Programmatic:
program → 100 calls → local filter/reduce → 5 records → model context
```

这里节省的主要是模型往返次数和中间上下文，不代表外部 API 调用本身消失。

### 控制流用程序表达更直接

循环、条件、并发、异常处理、变量复用和结构化转换本来就是编程语言擅长的表达。让模型连续产生几十个 JSON Tool Call，往往比生成一段有界程序更冗长，也更难保证依赖关系。

### 模型已经具备较强代码能力

CodeAct 等研究把可执行代码作为 Agent 的 action space，说明代码可以统一表达推理、工具组合和状态操作。这是 Code Mode 的研究脉络之一，但单篇研究的评测结果不等于所有 Agent 都应该采用 Code Mode。

## 一次调用如何闭环

程序化执行不是“模型生成代码后系统就不再参与”。完整闭环至少包含六个角色或对象：

| 对象 | 职责 |
| --- | --- |
| Model | 选择 Direct Tool Call 或生成程序 |
| Agent Orchestrator | 组装请求、推进 Turn、维护预算和停止条件 |
| Program Runtime | 解析并执行受控程序，维护程序局部状态 |
| Nested Tool Catalog | 规定程序内部允许调用哪些工具 |
| Policy / Tool Runtime | 对每个嵌套调用继续审批、路由、执行和审计 |
| Observation | 把程序终态或有界中间状态交回模型 |

典型流程是：

```text
1. Agent builds model-visible specs and nested-tool specs
2. Model emits generated program
3. Agent or Provider starts a program execution
4. Program requests nested tool A/B/...
5. Each nested call passes policy and tool routing
6. Results return to program-local state
7. Program returns, yields, fails or is cancelled
8. A bounded result becomes the model observation
```

必须为外层程序调用和每个嵌套工具调用保留可关联的 ID。否则无法判断结果属于哪个 Cell、哪次嵌套调用，也无法在超时或恢复后核对副作用。

## 一个最小示例

下面是假设 Runtime 暴露了 `list_orders` 和 `get_order` 两个只读工具的示意程序。实际名称、参数和返回类型由当前 Nested Tool Definition 决定：

```js
const orders = await tools.list_orders({ status: "failed", limit: 100 });
const details = await Promise.all(
  orders.items.map((order) => tools.get_order({ order_id: order.id })),
);
const top = details
  .filter((order) => order.retryable)
  .sort((left, right) => right.amount - left.amount)
  .slice(0, 5)
  .map(({ id, amount, error_code }) => ({ id, amount, error_code }));

text(top);
```

程序完成了四件事：先取得候选集合，并行补齐详情，在程序局部状态中筛选和排序，最后只通过 `text(...)` 输出 5 条记录。`Promise.all` 只适用于彼此独立、Executor 允许并发的只读调用；如果后一步依赖前一步的副作用，必须保持顺序。

Codex Code Mode 的 `exec` 接收原始 JavaScript，而不是 Markdown 代码块或 JSON 字符串。工具通过全局 `tools` 对象暴露；Runtime 不因此获得 Node、通用文件系统或任意网络能力。需要长时间运行时，外层调用可能先 Yield，模型随后通过 `wait` 继续等待或终止对应 Cell。

## 两种执行边界

### Provider Hosted Program Runtime

程序在 Model Provider 管理的隔离环境中执行。Provider 需要通过 API 暴露程序、嵌套 Tool Call 和程序结果等事件；Agent Orchestrator 仍可能负责执行自定义 Function Tool。

优点是模型服务可以原生管理程序执行及其事件；代价是运行时能力、生命周期和可观测性受 Provider 协议约束。

### Agent Harness Program Runtime

程序在 Agent Harness 管理的本地进程、Sandbox、Container 或远程执行环境中运行。Codex Code Mode 属于这一类：Codex 提供 Program Runtime，并把嵌套 Tool Call 重新交给自身 Tool Router。

“由 Harness 管理”不等于“必定在用户本机执行”。当前 Codex 同时存在进程内和进程持有的远程 Session 抽象，因此要按实际 Session Provider 判断物理位置。

| 维度 | Provider Hosted | Agent Harness Managed |
| --- | --- | --- |
| 程序由谁启动 | Model Provider | Agent Orchestrator / Harness |
| 协议是否必须表示程序事件 | 是 | 不一定跨 Provider API |
| 嵌套工具执行者 | Provider 或调用方 | Harness 的 Tool Router / External Service |
| Runtime 配额 | Provider 能力约束 | Harness 配置和执行环境约束 |
| 运行位置 | Provider 基础设施 | 本地或远程 Execution Environment |

## Catalog 与 Exposure 是第一道边界

模型能直接调用某工具，不代表生成的程序也应该调用它。程序可能在一次执行中循环或并发触发大量操作，因此需要独立规划 Nested Tool Catalog。

Codex 的 Exposure 可以帮助表达这种差异：

- `Direct`：可直接暴露，并可在满足其他条件时进入 Code Mode；
- `Deferred`：先保留在候选目录，发现后再暴露；
- `DirectModelOnly`：模型可以直接调用，但不进入 Code Mode；
- `Hidden`：不对模型暴露。

适合设为 Direct-only 的典型能力包括需要逐次用户交互、不能嵌套执行，或其结果必须直接进入模型上下文的工具。Namespace 级 Allowlist、Denylist 只是规划条件之一，最终还要同时考虑工具类型、Feature、Provider 能力和 Policy。

## 程序局部状态不等于模型上下文

Program Runtime 中的变量、工具原始结果和日志属于程序局部状态。只有经过选择的最终结果或 Yielded Observation 才进入模型上下文：

```text
External result
    ├── raw diagnostic → internal telemetry
    ├── program value  → program-local state
    └── bounded result → model context
```

这一区分正是程序化编排能够降低上下文消耗的原因，也带来新的验证要求：如果程序过度过滤，模型可能失去判断所需证据。设计输出时应明确：

- 最终字段和排序规则；
- 最大记录数和 Token 数；
- 原始结果的可追溯引用；
- 截断、缺失和部分失败标记；
- 哪些来源或引用必须保留为原生 Provider Item。

## Policy、Approval 与 Sandbox 不能省略

Code Mode 是新的调用路径，不是绕开安全控制的捷径。每个嵌套 Tool Call 都应继续经过适用的 Policy、Hook、Approval 和 Tool Runtime。

至少需要限制：

- 可嵌套的工具和 Namespace；
- 单个程序的运行时间、内存和输出；
- 嵌套调用总数、并发数和重试次数；
- 文件、网络、凭据和外部服务权限；
- 动态代码能够使用的语言特性和系统 API；
- 用户取消、Turn 结束和 Session 关闭后的清理；
- 写操作的幂等键、状态查询与部分副作用处理。

程序运行在 Sandbox 中，不代表它调用的外部工具没有副作用；工具已经通过 Schema 校验，也不代表循环调用的次数安全。

## 何时使用，何时不用

| 场景 | 建议 | 原因 |
| --- | --- | --- |
| 批量读取后筛选、聚合 | Programmatic | 原始结果可留在 Runtime |
| 多个无依赖查询 | Programmatic | 可并发并减少模型往返 |
| 有明确停止条件的循环 | Programmatic | 控制流适合用程序表达 |
| 单次查询或单个写操作 | Direct | 引入 Program Runtime 收益很小 |
| 每一步都要理解自然语言结果再决定 | Direct | 需要新的模型语义判断 |
| 每次写入都需要用户审批 | Direct 优先 | 审批边界更清晰 |
| 必须返回 Provider 原生引用或产物 | 取决于协议 | 程序转换可能丢失原生语义 |
| 高风险且难以幂等的副作用 | Direct 或禁止 | 批量和重试会放大风险 |

可以用一个简单判断：

```text
能否先写出有界、确定的控制流？
    ├── 否 → Direct Tool Calling
    └── 是
        ├── 中间数据是否很大、调用是否很多？
        │       ├── 否 → Direct 通常更简单
        │       └── 是 → 考虑 Programmatic
        └── 是否包含逐次审批或高风险副作用？
                ├── 是 → 拆分阶段或保持 Direct
                └── 否 → Programmatic 候选
```

## 生命周期与失败语义

程序执行可能立即完成，也可能在预算时间内未结束。实现通常需要区分：

- `Result`：程序正常完成，产生最终结果；
- `Yielded`：程序仍在运行，先返回中间状态和可等待的 Cell ID；
- `Terminated`：被取消、超时或主动终止；
- Script Error：程序自身解析或运行失败；
- Nested Tool Error：某个嵌套调用失败，程序可能处理或传播；
- Runtime Failure：Program Runtime 或通信通道失败。

`Yielded` 不能被当成完成；取消外层 Tool Call 也不能只停止等待而放任程序和嵌套工具继续运行。对于已经发起的外部写操作，还要记录其 Operation ID，恢复时先查询状态，不能盲目重放整个程序。

## Codex 当前实现的阅读路线

以下路线用于验证概念，不要求先用全文搜索拼接流程：

1. 打开 `codex-rs/core/src/tools/spec_plan.rs`，从 `build_tool_router` 阅读工具规划，重点看 Code Mode 如何影响模型可见 Specs、Nested Tool Specs 和 `DirectModelOnly`。
2. 打开 `codex-rs/tools/src/code_mode.rs`，阅读普通 `ToolSpec` 如何转换成 Code Mode 的 `ToolDefinition`，以及 Namespace 名称如何规范化。
3. 打开 `codex-rs/core/src/tools/code_mode/execute_spec.rs`，观察 Codex 怎样把 Code Mode 暴露为模型可调用的 `exec` Freeform Tool；到生成描述和 Nested Tool 声明后暂停，不必立即深入 Schema 渲染细节。
4. 继续阅读 `codex-rs/core/src/tools/code_mode/execute_handler.rs`。从原始 JavaScript 输入到 `ExecuteRequest`，再到 Cell 初始响应，这是一条外层执行主链。
5. 打开 `codex-rs/core/src/tools/code_mode/mod.rs`，阅读 `CodeModeService` 的 Session 初始化、`execute`、`wait`、`terminate` 和 `shutdown`，建立 Session 与 Cell 生命周期。
6. 打开同目录的 `delegate.rs`，观察 Program Runtime 发出的 `CodeModeNestedToolCall` 如何重新进入 Tool Router。到 Policy、Hook 和调用结果回传关系清楚后停止，再按需跟进具体 Handler。
7. 最后查看 `codex-rs/code-mode-protocol/src/runtime.rs` 与 `session.rs`，用协议类型核对 `ExecuteRequest`、`RuntimeResponse`、`CellId` 和 Session Delegate 的边界。

当前实现把 `exec` 与 `wait` 作为 Code Mode 的模型可见入口，执行 JavaScript，并支持 Cell Yield 后继续等待。功能和类型仍可能演进，因此学习重点应是 Catalog、Session、Nested Dispatch 和 Observation 的关系，而不是记住某个字段名。

## 如何测试和评估

只测试“代码能够运行”不够。至少要覆盖：

1. Nested Tool Catalog 不包含 `DirectModelOnly` 和被排除的 Namespace；
2. 每个嵌套调用仍经过 Policy、Hook、Approval 和审计；
3. 顺序依赖不会被错误并发，无依赖批量调用受并发上限约束；
4. Yield、Wait、Cancel、Timeout 和 Session Shutdown 能关闭对应 Cell；
5. 大结果在进入模型上下文前被有界裁剪，同时保留截断信息；
6. 嵌套调用失败、脚本异常和 Runtime 崩溃具有不同错误类别；
7. 写操作在响应丢失或恢复后不会被盲目重复；
8. 相同任务与 Direct Tool Calling 对比成功率、延迟、Token、调用数和可审计性。

评估 Code Mode 不能只看 Token 是否减少。程序生成错误可能减少模型轮次却降低成功率；过度并发可能降低延迟却触发 Rate Limit；过度裁剪可能降低上下文成本却丢失证据。

## 是否已经形成行业共识

“让模型生成程序来编排工具”已经是明确的行业设计方向，但还不是统一标准：

- OpenAI 提供 Programmatic Tool Calling；
- Anthropic 提供 Programmatic Tool Calling，并讨论通过代码执行扩展 MCP；
- Cloudflare 使用 Code Mode 这一名称；
- CodeAct 等研究探索 Executable Code Actions。

已经趋同的是问题判断：大工具目录、大中间结果和多轮工具往返需要更高效的编排方式。尚未统一的是名称、编程语言、Runtime 所在位置、状态是否持久、嵌套调用协议以及权限模型。

因此应把它描述为：

> 程序化工具编排是一种正在形成共识的 Agent 设计模式；Code Mode 是其中一个常用但未标准化的名称。它补充而不是取代 Direct Tool Calling。

## 公开资料

- [OpenAI：Programmatic Tool Calling](https://developers.openai.com/api/docs/guides/tools-programmatic-tool-calling)
- [Anthropic：Programmatic Tool Calling](https://platform.claude.com/docs/en/agents-and-tools/tool-use/programmatic-tool-calling)
- [Anthropic：Code execution with MCP](https://www.anthropic.com/engineering/code-execution-with-mcp)
- [Cloudflare：Code Mode](https://developers.cloudflare.com/agents/tools/codemode/)
- [CodeAct：Executable Code Actions Elicit Better LLM Agents](https://arxiv.org/abs/2402.01030)

阅读外部资料时，应把产品能力映射回本文的通用问题：程序在哪里运行、哪些工具可嵌套、结果进入哪里、谁实施 Policy，以及失败后由谁恢复。
