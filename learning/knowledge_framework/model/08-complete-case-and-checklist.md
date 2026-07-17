# 完整案例、设计检查与练习

## 案例：分析截图并修复跨平台构建错误

用户提交一张 CI 错误截图，要求 Agent 定位问题、修改代码并返回固定结构的结果：

```json
{
  "status": "fixed | blocked",
  "summary": "...",
  "tests": ["..."],
  "remaining_risks": ["..."]
}
```

任务需要图像输入、代码工具、Structured Output、较长上下文和流式进度。Provider 当前偶发容量不足，首选 WebSocket 也可能无法 Upgrade。

## 第一步：形成决策需求

Host 从 Goal 与 Success Criteria 提取硬约束：

```text
must accept image input
must support function/custom tool calling
must support required final JSON schema or an equivalent hard contract
must fit repository context after reserved output budget
must be allowed for source-code data
```

质量、延迟、费用和首 Token 时间是软目标。此时还没有调用模型，也没有选择 fallback。

## 第二步：选择 Provider 与 Model

Model Manager 合并远端目录、缓存和配置覆盖，先过滤不满足图像、Tool 与 Context 的候选，再按质量和容量选择主 Route。选定后保存本轮能力快照：

```text
provider = P1
model = M1
transport = websocket preferred, HTTPS available
input_modalities = [text, image]
parallel_tool_calls = false
structured_output_strict = true
reasoning_effort = high
retry_budget = 3 stream attempts, 20s total wait
```

这份快照随 Turn 固定。目录在后台刷新，不改变正在执行的请求。

## 第三步：构造请求

Host 计算有效 Context 预算，选择任务相关历史与工具，只发送允许模型看到的文件读取、搜索、补丁和测试工具。截图以受支持的 Image Item 编码，最终结果 Schema 放入响应格式控制，而不是只写一句“请返回 JSON”。

```text
Internal State
  → modality-aware history projection
  → bounded tool catalog
  → reasoning / schema normalization
  → provider request
```

认证、Sandbox 权限和未公开工具不会进入模型上下文。

## 第四步：消费 Stream

WebSocket 连接建立后，事件依次到达。UI 可以展示文本进度，但 Runtime 等待完整 Function Call Item：

```text
function_call added
  → arguments delta...
  → item done
  → parse JSON
  → schema + semantic + policy validation
  → execute read-only search
```

Observation 以同一 `call_id` 回写历史，模型继续请求文件读取、补丁和测试。每次工具执行都由 Agent Loop 决定是否需要 follow-up，不由 Transport Consumer 直接递归调用模型。

## 第五步：Reflection 与 Critique

第一次测试失败，错误显示原方案只适用于 Linux。Reflection 根据真实测试输出更新状态：根因假设不完整，需要检查 Windows 路径处理。它修改计划，而不是用更高 Effort 原样重试测试。

修复与测试通过后，Critique 对照 Success Criteria 检查：

- 截图中的原始错误是否被解释；
- 修改是否兼容 Linux、macOS 和 Windows；
- 是否存在超范围 Diff；
- 测试证据是否足以支持 `fixed`；
- 最终 JSON 是否通过 Schema 和语义验证。

若证据不足，返回 `blocked` 或继续获取证据，不能因为 Schema 合法就宣布完成。

## 第六步：处理断线与容量故障

假设第二次 Sampling 中 WebSocket 断流：

1. Stream 状态没有收到 `response.completed`，不能当作成功；
2. 在 Stream Retry Budget 内按退避重试；
3. WebSocket 尝试耗尽后切换 HTTPS/SSE；
4. 逻辑 Model 不变，因此这是 Transport Fallback；
5. UI 收到“正在重连”和“已降级 Transport”的不同事件。

随后 Provider 返回明确容量不足。Router 才考虑 M2：

1. 检查 M2 仍支持 Image、Tool 和最终 Schema；
2. 重新计算 Context Window 与 Reasoning Effort；
3. 若 Provider 状态不能延续，则从逻辑历史重建请求；
4. 插入有界 Model Switch Context；
5. 记录 Route 变化、原因和降级；
6. 在剩余总预算内只尝试一次。

若 M2 不支持 Strict Structured Output，而调用方要求机器自动消费，则应失败，不能静默改成 Prompt-only JSON。

## 第七步：完成与审计

最终完成记录应包含：

- 有效模型、Provider、Transport 与能力快照；
- Context、Reasoning、Usage、延迟和重试次数；
- Tool Call/Output 配对和验证证据；
- Reflection 导致的计划变更；
- Transport 与 Model Fallback 的独立事件；
- 最终结构化结果及其 Schema 验证状态。

这使系统能回答“为什么选 M1”“为什么切到 M2”“是否重复执行工具”“fixed 由什么证据支持”。

## 设计检查表

### Provider 与协议

1. Provider、Model、Wire API 和 Transport 是否独立建模？
2. Provider Adapter 是否隔离认证、Header、错误和私有字段？
3. Typed Item、Call ID 和终态是否完整处理？

### 能力协商

4. 是否保存 Turn 级能力快照？
5. Context 是否包含输出预留、工具开销和压缩阈值？
6. Modality、Tool、Schema 和 Streaming 是否分别协商？
7. Unknown 能力是否采用保守策略？

### 决策质量

8. Reasoning Effort 是否按风险与阶段分配？
9. Planning、Reflection 和 Critique 是否各有明确产物？
10. 完成声明是否由外部证据而不是模型自评支持？

### 路由与恢复

11. 路由是否先满足硬约束，再优化软目标？
12. Model、Provider、Transport、Metadata Fallback 是否区分？
13. 模型切换后是否完整重新协商并重建上下文？
14. Request、Stream 和 Agent Retry 是否共享总预算？
15. 状态未知的副作用是否有对账路径？

### 可观测性

16. 是否记录选择理由、有效能力、Usage、延迟和错误分类？
17. 是否能按 Provider、Model、Tier、Transport 和 Tenant 聚合指标？
18. 是否能重放逻辑历史，而不依赖 Provider 私有会话状态？

## 练习

### 练习一：画出请求投影

选择一个已有 Agent，分别列出 Internal Turn State 和实际 Provider Request。标出哪些字段被过滤、转换或新增，并解释每项变换由哪条能力或安全规则决定。

### 练习二：设计能力矩阵

为三个假想模型建立矩阵，覆盖 Context、Image、Tool 类型、Strict Schema、Streaming、Reasoning 和 Service Tier。给出“截图修复”“批量抽取”“低延迟问答”三个任务的路由结果。

### 练习三：构造断流状态机

分别处理断线发生在 `response.created` 前、Tool Arguments 中途、Tool Call 完整后和 Provider 托管工具执行后。说明每种情况能否安全重放，以及需要什么 ID 或对账证据。

### 练习四：审计一个 fallback

给定主模型 Context 为 200K、备用模型为 64K 的场景，设计压缩、模态、Tool 和 Structured Output 的重新协商步骤。明确哪些降级必须通知调用方。

### 练习五：限制 Evaluator–Optimizer

为一个代码生成任务定义最多三轮的 Generate–Critique–Revise 协议。写出 Rubric、每轮允许获得的新证据、无进展判断和最终失败表达。

## 源码综合阅读路线

从 `codex-rs/models-manager/src/manager.rs` 解析模型开始，经 `protocol/src/openai_models.rs` 建立能力快照，再到 `core/src/session/turn.rs` 的 `build_prompt`。随后进入 `core/src/client.rs` 的请求构造和 Transport 选择，转到 `codex-api/src/sse/responses.rs` 的事件解析，最后回到 `session/turn.rs` 的 Tool、Observation 与 follow-up 循环。

第二遍阅读时加入恢复支线：从 `model-provider-info/src/lib.rs` 的 Retry 配置进入 `core/src/responses_retry.rs`，再分别查看 `client.rs` 的 Transport Fallback、`models-manager/src/model_info.rs` 的 Metadata Fallback，以及 `context/model_switch_instructions.rs` 和压缩模块中的模型切换处理。读完后，应能画出选择链、协议链和恢复链，而不是只记住文件列表。

---

[上一篇：Rate Limit、Capacity 与 Retry](07-rate-limit-capacity-retry.md) · [返回学习地图](README.md)
