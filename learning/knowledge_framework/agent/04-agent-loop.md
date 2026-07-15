# Agent Loop：从输入到状态更新

## Loop 的完整闭环

```text
构建 Context
    ↓
调用 Model
    ↓
解释决策
    ↓
校验并执行动作
    ↓
观察结果并验证完成条件
    ↓
把 Observation、Evidence 和 Progress 写回 State
    ↓
判断完成或进入下一轮
```

Agent Loop 不是简单的 `while` 循环，而是由输入构建、决策解释、动作控制、结果验证和状态转移共同组成。

## 第一阶段：构建本轮输入

### Prompt 与 Instructions

包括系统规则、开发者规则、用户目标、当前任务和输出要求。系统必须保留指令来源与优先级，不能把网页、文件或工具结果中的文字自动当作可信指令。

### Conversation 与 Session State

包括相关历史、已确认选择、未解决问题和当前 Progress。历史过长时可以压缩，但不能借摘要改写 Goal、授权范围或已经发生的副作用。

### Environment 与 Workspace

包括工作目录、文件状态、运行平台、当前分支、进程、可用资源和远程执行环境。环境会变化，关键动作不能永远依赖旧快照。

### Memory、RAG 与 Skills

- Memory 保存跨步骤或跨 Session 的状态与经验；
- RAG 从外部知识源检索证据；
- Skills 按需提供工作方法、知识、脚本和资源。

它们都是上下文来源，不天然拥有更高指令优先级，也不自动获得执行权限。注入前应检查来源、可信度、新鲜度、权限和 Token 预算。

### Available Tools

模型只能从本轮真正暴露的工具中选择。Catalog 应根据模型能力、功能配置、认证、策略和环境过滤。工具已注册进 Runtime，不代表本轮必须让模型看到。

```text
Model Input = Instructions
            + Relevant History
            + Current Task / Progress
            + Environment Snapshot
            + Selected Memory / RAG / Skills
            + Model-visible Tool Contracts
```

## 第二阶段：生成并解释决策

模型输出是候选决策，Agent Orchestrator 需要将其解释为明确类型：

| 决策 | 含义 | 后续处理 |
| --- | --- | --- |
| Final Answer | 模型认为可以返回结果 | 检查完成条件与输出约束 |
| Structured Output | 以机器可读结构表达分类、计划或动作 | 校验结构和业务语义 |
| Tool Call / Tool Selection | 请求读取信息或改变环境 | 进入动作检查与执行 |
| Clarification / User Input | 缺少只有用户能提供的信息 | 保存状态并等待用户 |
| Handoff / Delegation | 移交给其他 Agent、人员或系统 | 传递任务、上下文、权限、预算和验收条件 |

Structured Output 只改善可解析性，不能保证决策正确。Tool Selection 也只表示模型选择了能力，不表示工具已经执行。

流式协议中，自然语言、Tool Call 和完成事件可能分段到达。系统应按协议组装完整决策，不能看到一段文本就猜测 Turn 已结束。

## 第三阶段：校验并执行动作

```text
Tool Call
    ↓
Schema Validation
    ↓
Semantic Validation
    ↓
Policy / Permission / Approval
    ↓
Tool Runtime
    ↓
Sandbox / Local or Remote Executor
```

### Schema 与 Semantic Validation

Schema Validation 检查字段、类型、枚举和必填项。Semantic Validation 检查参数在当前环境中是否合理，例如路径是否越界、资源是否存在、状态是否满足前置条件、查询是否确实只读。

JSON 合法不代表动作安全，也不代表动作一定能成功。

### Policy、Permission 与 Approval

- Policy 根据规则判断允许、拒绝还是需要确认；
- Permission 检查当前身份能否访问目标资源；
- Approval 获取用户或审查器对具体高风险动作的授权。

Approval 不是 Sandbox。用户同意执行一个动作，不代表动作可以突破文件、网络或进程隔离。

### Tool Runtime

Runtime 负责路由、参数解析、调度、并发、超时、取消、结果结构化、截断和错误分类。多个动作只有在没有数据依赖、执行器支持并发且目标资源不会冲突时才可并行。

### Sandbox 与 Remote Executor

动作可以发生在本地进程、Sandbox、Container、VM 或远程执行器。Agent Orchestrator 的位置不等于执行位置。无论动作在哪里发生，都应维持权限、资源、网络、审计和取消边界。

## 第四阶段：观察结果

Tool Result 进入 Loop 后成为 Observation。它至少应表达：

- 对应哪个调用，通常通过 `call_id` 配对；
- 成功、失败、部分成功、拒绝、超时还是取消；
- 返回了什么有界结果，是否被截断；
- 是否产生 Artifact 或外部副作用；
- 错误是否可恢复，重试是否安全。

| 概念 | 含义 |
| --- | --- |
| Observation | Agent 从一次动作中收到的结果 |
| Artifact | 动作产生或修改的持久化对象，如文件、提交或报告 |
| Diff | Artifact 前后变化的可检查表示 |
| Evidence | 支持某个判断或完成条件的可核验证据 |

工具返回“写入成功”是 Observation；实际文件是 Artifact；重新读取 Diff 并通过测试，才构成更强的 Evidence。

## 第五阶段：验证

收到 Observation 后，依次判断：

1. 动作的 Preconditions 和 Postconditions 是否满足；
2. Observation 是否完整、可信并与原调用配对；
3. Artifact 是否真实存在，内容是否符合预期；
4. 测试、断言、状态查询、引用或人工验收是否支持 Success Criteria；
5. 是否出现未预期副作用或新的阻塞项。

Verifier 可以是确定性测试、规则、另一个模型、外部状态查询或人工验收。无论使用哪种方式，完成判定都应回到 Success Criteria。

## 第六阶段：更新 State

将有用信息写回：

- History：本轮决策、调用和有界结果；
- Memory：按写入与遗忘策略保存可复用信息；
- Task / Progress：已完成、进行中、阻塞或待验证；
- Usage：时间、Token、调用次数、费用和重试预算；
- Artifact / Evidence：产物引用、Diff、测试结果和外部操作 ID；
- Checkpoint：最新一致恢复点。

原始输出可能很大或包含敏感信息。系统应分别维护审计使用的原始视图、模型使用的有界视图和用户看到的展示视图。

## 最小但完整的伪代码

```text
state = initialize(goal, success_criteria, task, budgets, deadline)

while not state.is_terminal():
    if enforce_cancel_budget_and_deadline(state) changed state to terminal:
        break

    model_input = build_bounded_context(state)
    decision = parse_and_validate(model(model_input))

    match decision:
        FinalAnswer(answer):
            verify_completion_or_continue(state, answer)

        ToolCall(call):
            authorization = validate_and_authorize(state, call)
            match authorization:
                Authorized:
                    result = execute_with_runtime_and_isolation(call)
                    observation = normalize_and_bound(result)
                    update_and_verify(state, call, observation)
                WaitingForApproval:
                    checkpoint_and_wait(state, call)
                Rejected:
                    record_rejection_and_transition(state, call)

        Clarification(question):
            checkpoint_and_wait(state, question)

        Handoff(target, subtask):
            handoff_with_context_permission_budget_and_criteria(
                state, target, subtask
            )

return terminal_result(state)
```

真实系统还要处理流式事件、并行调用、后台进程、上下文压缩、断线恢复和可观测性，但这些能力都应服从同一状态机，不能形成绕过策略和 State 的旁路。

---

[上一篇：Session、Turn、Checkpoint 与 State](03-session-turn-checkpoint-state.md) · [下一篇：状态转移、恢复与终止](05-state-transitions.md)
