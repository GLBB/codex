# Reasoning Effort 与 Sampling

## 两类控制不要混为一谈

Reasoning Effort 与 Sampling 参数都会影响模型输出，但控制的维度不同：

```text
Reasoning Effort
    更像“给决策过程多少推理预算”

Temperature / top-p / seed 等 Sampling 控制
    更像“怎样从候选分布中选择输出”
```

它们都不是跨 Provider 语义完全一致的标准旋钮。某个 Provider 可能只支持其中一部分，可能对不同模型使用不同取值，也可能忽略不支持的字段。因此所有参数都应经过模型能力目录和 Provider Adapter 归一化。

## Reasoning Effort 是质量、延迟与成本的策略

提高 Reasoning Effort 通常希望模型在复杂约束、多步推导和困难决策上投入更多计算，但不能把它理解成单调的“智力等级”：

- 简单任务使用过高 Effort 可能只增加延迟和成本；
- 缺少事实时，更多推理不能替代检索和工具证据；
- 错误 Prompt 或错误上下文会让模型更认真地沿错误方向推导；
- 某些模型只支持离散档位，某些模型允许扩展值；
- Provider 可能分别计量普通输出 Token 与 Reasoning Token。

一个实用策略是按决策风险分配 Effort：

| 任务 | 建议倾向 |
| --- | --- |
| 格式转换、简单定位 | 低或默认 |
| 多文件修改、约束推导 | 中等 |
| 架构迁移、复杂故障诊断 | 较高 |
| 不可逆、高风险动作判断 | 高 Effort + 独立验证，而不是只提高 Effort |

Effort 可以随阶段变化：探索阶段中等，方案决策较高，机械执行较低，最终 Critique 再提高。阶段变化必须有上限，避免 Agent 自行无限“加大思考”。

## Reasoning Summary 不是完整推理轨迹

Provider 可能返回 Reasoning Summary，用于向用户或 Runtime 提供简要进展。它不等同于模型的完整内部推理，也不应成为唯一审计证据。

审计系统更应该保存：

- 本轮可见输入和能力契约；
- 模型产生的结构化决策；
- Tool Call、Observation 和验证证据；
- 路由、重试、延迟和 Usage；
- 可公开的简要理由。

Summary 可以帮助理解，但真正可验证的是动作和结果。

## Sampling 控制随机性，不保证事实正确

常见 Sampling 参数包括 temperature、top-p、seed、候选数量和停止条件。一般而言：

- 较低随机性适合结构化抽取、代码修改和稳定自动化；
- 较高随机性适合发散创意和候选方案生成；
- temperature 与 top-p 通常不必同时激进调整；
- seed 即使受支持，也不保证跨模型版本、硬件和 Provider 完全复现；
- Structured Output 能约束形状，但不能消除语义随机性。

对 Agent 来说，真正重要的不是单次文本完全相同，而是关键状态转移满足不变量：工具参数有效、Policy 一致、副作用可确认、完成声明有证据。

## 当前 Codex 的一个重要边界

当前 Codex 的 Responses 请求显式处理 Reasoning Effort、Reasoning Summary、Verbosity、Service Tier 和输出 Schema，但没有把 temperature、top-p 作为普通 Turn 请求的主要控制面。因此阅读源码中的 `sampling request` 时，不要误以为它必然包含传统 Sampling 参数；这里的 sampling 更接近“一次模型推理请求”。

这个边界也说明：教程中的 Sampling 是通用知识节点，具体产品不必暴露所有旋钮。减少参数面有时能带来更一致的行为和更简单的能力协商。

## 自适应策略与防振荡

系统可以根据任务复杂度、失败类型或剩余预算调整 Effort，但应遵守：

```text
observe evidence
  → classify failure
  → change one relevant control
  → retry within budget
  → compare outcome
```

解析失败不一定需要提高 Effort，可能只需 Structured Output；Rate Limit 不应通过提高 Effort 解决；缺少上下文应检索或压缩；工具权限拒绝更不能靠再次 Sampling 绕过。

为避免振荡，应记录已尝试的 `(model, effort, prompt version, route)`，限制升级次数，并定义回退条件。没有新证据时反复用同样参数调用模型，通常只是扩大成本。

## Codex 源码阅读路线

先打开 `codex-rs/protocol/src/openai_models.rs`，阅读 `ReasoningEffort`、`ReasoningEffortPreset` 和 `ModelInfo` 中的默认与支持档位。注意 Effort 接受已知值和扩展值，但可选择列表仍来自模型元数据。

接着看 `codex-rs/core/src/config/mod.rs` 中的 `model_reasoning_effort`、`plan_mode_reasoning_effort`、`model_reasoning_summary` 和 `model_verbosity`。这里展示了全局配置与工作模式配置如何影响 Turn，而不是由 Provider 响应临时决定。

然后进入 `codex-rs/core/src/client.rs` 的 `build_reasoning` 与 `build_responses_request`。观察显式 Effort 如何回落到模型默认，Summary 如何受能力字段过滤，Verbosity 和 Service Tier 又如何独立处理。

最后查看 `codex-rs/protocol/src/protocol.rs` 的 Usage、Turn Start/End 相关事件，确认 Reasoning Token、有效 Effort 和总体 Token 怎样进入可观测性。读到 Usage 映射完成即可停止。

## 本篇检查

1. 是否区分推理预算与随机采样？
2. 参数是否经过模型能力和 Provider 语义归一化？
3. Effort 是否按任务风险与阶段分配，而不是永远最高？
4. 是否把缺证据、权限错误和限流错误错误地当作“思考不够”？
5. 是否有升级次数、成本和延迟上限？
6. 可复现性要求是文本完全相同，还是关键状态不变量一致？

---

[上一篇：Streaming](03-streaming.md) · [返回学习地图](README.md) · [下一篇：Planning、Reflection 与 Critique](05-planning-reflection-critique.md)
