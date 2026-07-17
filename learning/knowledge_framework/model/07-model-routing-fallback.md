# Model Routing 与 Fallback

## Routing 是约束满足，不只是模型排行榜

Model Routing 的第一步不是“选最聪明的模型”，而是排除不满足硬约束的候选：

```text
Candidates
  → capability filter
  → policy / residency / auth filter
  → context and tool compatibility
  → capacity availability
  → cost / latency / quality scoring
  → selected route
```

硬约束包括所需模态、Context Window、Tool Calling、Structured Output、数据地域和安全级别。只有通过硬约束的模型，才能用质量、延迟、成本、缓存命中率和容量做软评分。

路由决策应记录原因和能力快照，否则无法解释一次任务为什么用了某个模型，也无法复盘 fallback 是否合理。

## 静态、规则与动态路由

- 静态路由：用户或产品固定模型，最可预测；
- 规则路由：按任务类型、上下文长度、风险和模态选择；
- 动态路由：基于实时容量、历史质量或轻量分类器评分；
- 分阶段路由：规划、执行、Critique 或压缩使用不同模型。

动态路由要防止任务内容被错误分类。对高风险任务，应优先使用可审计规则和保守默认值，而不是完全依赖另一个不透明模型。

## 四种容易混淆的 Fallback

### 1. Model Fallback

主模型不可用或不满足任务要求时，切换到另一个模型。它会改变决策引擎，必须重新检查 Context、Tool、Schema、Reasoning 和 Policy 兼容性。

### 2. Provider Fallback

模型或等价能力切换到另一服务商。除模型差异外，还会改变认证、数据边界、错误语义、线路字段和合规条件，风险通常大于同 Provider 的 Model Fallback。

### 3. Transport Fallback

逻辑模型与请求语义不变，只从 WebSocket 降级到 HTTPS/SSE 等 Transport。它主要解决连接能力或稳定性，不能被描述成模型切换。

### 4. Metadata Fallback

找不到模型目录项时，为未知 Slug 构造保守的本地能力描述。这只是让客户端仍能构造请求，不代表服务端自动换了模型，也不证明未知模型支持那些能力。

四者应使用不同事件、指标和用户提示。

## Fallback 前必须重新协商

不能只替换请求中的 `model` 字符串。切换后至少重新计算：

- 输入是否超过新 Context Window；
- 新模型是否接受所有输入模态；
- Tool 类型、并行调用与 Schema 是否兼容；
- Reasoning Effort 和 Structured Output 是否需要降级；
- Service Tier、认证和数据策略是否仍有效；
- 原模型产生的 Reasoning Item 或 Provider 私有 Item 能否继续放入上下文。

```text
Failure
  → choose fallback candidate
  → renegotiate full turn contract
  → adapt or compact context
  → record model-switch context
  → retry within budget
```

如果必须丢失能力，应向上层返回明确的 Degradation，而不是静默继续。例如无法保证 Strict Structured Output 时，系统不能仍对调用方承诺同样的机器可解析契约。

## 状态连续性与缓存

模型切换可能造成：

- Provider 侧 `previous_response_id` 不可复用；
- Prompt Cache 失效；
- 隐式服务端会话状态丢失；
- Token 估算和压缩阈值变化；
- 模型专属 Instructions 变化；
- 旧模型输出格式对新模型不可见或不可解释。

因此 Agent 应以可重放的逻辑历史为事实来源，而不是只依赖 Provider 隐式状态。切换时可以加入有界的 Model Switch Context，说明先前模型、当前模型和需要保持的任务状态，但不能重写既有历史。

## Fallback 决策矩阵

| 故障 | 合理动作 | 不合理动作 |
| --- | --- | --- |
| WebSocket Upgrade 不支持 | 降级 HTTPS/SSE | 换模型 |
| 短暂 5xx 或断流 | 有界重试，必要时 Transport Fallback | 无限重放 |
| 模型不支持图像 | 转换模态、换兼容模型或失败 | 静默丢图 |
| Context 超限 | 压缩、裁剪或换大窗口模型 | 原样重试 |
| 权限/Policy 拒绝 | 请求授权或终止 | 换 Provider 绕过 |
| 认证失败 | 刷新凭据或要求登录 | 随机换模型 |
| 容量耗尽 | 等待、换 Tier、模型或 Provider | 立即并发风暴 |

## Codex 源码阅读路线

先打开 `codex-rs/models-manager/src/manager.rs`，阅读 `get_default_model`、`get_model_info` 和模型目录合并逻辑。这里是选择模型与解析元数据的入口。

接着读 `codex-rs/models-manager/src/model_info.rs` 的 `model_info_from_slug`，确认 `used_fallback_model_metadata` 表示未知模型的能力描述兜底，而不是实际 Model Fallback。再看 `codex-rs/core/src/session/code_mode_warning.rs` 如何对这类不确定能力采取保守态度。

然后打开 `codex-rs/core/src/client.rs` 的 `responses_websocket_enabled`、`stream` 和 `try_switch_fallback_transport`，观察 WebSocket 到 HTTPS 的 Session 级 Transport Fallback。不要把这里的 fallback 与模型路由混淆。

最后阅读 `codex-rs/core/src/context/model_switch_instructions.rs` 和 `codex-rs/core/src/session/turn.rs` 中 pre-sampling compaction 对前一模型的处理，再看 `compact_model_fallback.rs`。这些位置展示了模型变化时怎样保留上下文连续性，以及特定压缩路径怎样从旧模型回落到当前模型。到压缩 fallback 的记录函数后停止。

## 本篇检查

1. 路由是否先应用硬约束，再做软评分？
2. Model、Provider、Transport 和 Metadata Fallback 是否分别建模？
3. 模型切换后是否重新协商全部能力？
4. 降级是否改变了对调用方的契约，是否显式报告？
5. Provider 隐式状态丢失后，逻辑历史能否重放？
6. 是否有最大切换次数和防振荡记录？
7. Fallback 是否可能绕过原有 Policy 或数据边界？

---

[上一篇：Planning、Reflection 与 Critique](06-planning-reflection-critique.md) · [返回学习地图](README.md) · [下一篇：Rate Limit、Capacity 与 Retry](08-rate-limit-capacity-retry.md)
