# Model 与决策系统学习地图

## 这组教程解决什么问题

模型不是一个只接收字符串、返回字符串的黑盒。Agent 要稳定使用模型，至少要同时处理四层契约：

```text
任务契约：本轮要做什么，什么结果才算完成
能力契约：模型能接收什么、能产生什么、有哪些限制
线路契约：请求、Item、事件、错误怎样编码和配对
运行契约：怎样选择模型、控制成本、限流、重试和降级
```

它们共同构成 Model 与决策系统：

```text
Goal / State / Policy
          │
          ▼
  Decision Requirements
          │
          ▼
Model Catalog + Provider Capability
          │
          ▼
  Negotiated Turn Contract
          │
          ├── Context / Modality
          ├── Tools / Structured Output
          ├── Reasoning / Service Tier
          └── Streaming / Retry Policy
          │
          ▼
 Provider Request → Event Stream → Candidate Decision
          │                              │
          └──── Observation / Critique ──┘
```

“能力协商”在多数 Agent 系统里并不一定是一轮独立握手。更常见的做法是：从模型目录、Provider 配置、用户配置和运行时状态中解析出有效能力，再只把兼容的字段与工具放进请求。协商的结果应是一个可审计的本轮契约，而不是散落在代码里的条件判断。

## 推荐学习顺序

1. [Model Provider 与 API Protocol](01-provider-api-protocol.md)：分清 Provider、Model、Wire API、Transport 和 Agent Runtime。
2. [能力协商：Context、Modality、Tool、Structured Output 与 Streaming](02-capability-negotiation.md)：学习如何从能力目录构造有效请求。
3. [Streaming：从增量事件恢复完整决策](03-streaming.md)：理解事件流、终态、取消、断线和重复边界。
4. [Reasoning Effort 与 Sampling](04-reasoning-effort-and-sampling.md)：理解推理预算、随机性、延迟、成本和可复现性。
5. [Planning、Reflection 与 Critique](05-planning-reflection-critique.md)：把三类决策机制放回 Agent Loop，而不是把它们当作模型魔法。
6. [Model Routing 与 Fallback](06-model-routing-fallback.md)：设计选择、切换、降级和恢复策略。
7. [Rate Limit、Capacity 与 Retry](07-rate-limit-capacity-retry.md)：建立错误分类、退避、幂等和容量控制。
8. [完整案例、设计检查与练习](08-complete-case-and-checklist.md)：沿一条端到端链路串起本部分。

初学者应按顺序阅读。已经实现过模型客户端的读者，可以先读第 2、6、7 篇，再用第 8 篇检查系统边界。

## 三条阅读主线

阅读任何 Agent 的 Model 层时，同时跟踪三条链：

```text
选择链
Task → Requirements → Candidate Models → Capability Filter
     → Policy / Cost / Latency Score → Selected Route

协议链
Prompt / Tools / Controls → Provider Request → Stream Events
                          → Response Items → Agent Decision

恢复链
Error → Classification → Retry Same Route / Change Transport
      → Change Tier / Change Model / Ask User / Fail
```

只看协议链，会忽略为什么选这个模型以及失败后怎么办；只看选择链，会忽略切换模型时上下文和工具协议是否仍兼容；只看恢复链，则容易把所有错误都错误地归入“重试”。

## 内容覆盖表

| 知识框架节点 | 对应教程 |
| --- | --- |
| Model Provider / API Protocol | 第 1 篇 |
| Context Window / Modality | 第 2 篇 |
| Tool Calling | 第 1、2 篇 |
| Structured Output | 第 2 篇 |
| Streaming | 第 2、3 篇 |
| Reasoning Effort / Sampling | 第 4 篇 |
| Planning / Reflection / Critique | 第 5 篇 |
| Model Routing / Fallback | 第 6 篇 |
| Rate Limit / Capacity / Retry | 第 7 篇 |
| 综合设计与验收 | 第 8 篇 |

## 学习完成标准

完成本组教程后，应能回答：

1. Provider、Model、API Protocol 和 Transport 为什么不能混为一谈？
2. 能力协商为什么不是“把所有参数都发给 Provider”？
3. Context Window 的标称值、有效输入预算和自动压缩阈值有什么区别？
4. Tool Calling 和 Structured Output 分别约束动作与最终结果的哪一部分？
5. 为什么收到若干文本 Delta 不等于收到一个完整响应？
6. Reasoning Effort 与 temperature、top-p 等 Sampling 参数控制的是不是同一件事？
7. Planning、Reflection 和 Critique 应在什么证据边界上运行？
8. 模型切换、传输降级和模型元数据兜底有什么不同？
9. 哪些错误适合重试，哪些错误重试只会放大故障？
10. 如何证明一次 fallback 没有破坏上下文、工具调用和副作用的一致性？
