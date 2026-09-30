# Agent Trace 信息展示：工作骨架

## 任务目标

回答两套 trace **展示什么、怎样展示、如何采集、如何互查**，并核对同事 demo 的观测内容与 Langfuse 的承载能力。最终用一条 Agent 执行样本串起结论，形成适合分享的调研与技术方案。

## 行动思路

按“**要回答的问题 → 页面效果 → 所需数据 → 采集位置 → 样本核验**”展开。先看工程侧和算法侧，再核对 demo、打通标识，最后评估 Langfuse 容量。过程资料用 Markdown；最终分享稿仍可采用 HTML。

## 大纲

### 1. 工程侧：OpenTelemetry trace

- 设计：一次请求的 span 树、关键字段、错误/重试/耗时口径；Java、Rust、下游服务如何传播 context。
- 展示：Hera 中的瀑布图、慢点与错误定位、执行步骤下钻。
- 验证：选成功、慢调用、失败样本，检查链路是否完整且能定位问题。

### 2. 算法侧：Agent trace

- 已有材料：[面向算法效果诊断与迭代的 Agent Trace 方案](agent-trace-design.md)，包含 Session 内容、决策与信息流、任务评价、Codex 案例、自动导入 Langfuse 和实验闭环。
- 接入实现：[云端 Agent Session 自动导入 Langfuse：组件实现方案](session-langfuse-bridge-design.md)，说明不同历史格式的适配、统一事件、节点聚合、OTLP 上报、事务恢复及投递对账，附完整协议样例。
- 设计：围绕任务完成、行动选择、证据获取与使用、上下文保持、协作质量，组织 Session → Turn → Step → 模型/工具轨迹。
- 展示：从任务结果和评分定位相关决策，查看实际模型输入输出、工具结果、上下文变化与版本；标明内容来源和缺失范围。
- 实现：服务端记录 Session 与实际交互，自动映射为 Langfuse observations，关联业务验收、人工审阅与评测结果。
- 验证：从 bad case 提出有证据的改进假设，形成固定评测样本，比较基线与候选版本的质量、失败类型和消耗。

### 3. Demo 对照

- 已有源码核对：[Demo 观测清单与两套 Trace 承载对照](demo-observability-mapping.md)。列出采集出口、逐项覆盖、关联键、算法平台映射，以及重试快照、客户端模拟 span、统计口径等边界；运行样本与远端摄取验收待做。
- 逐项列出 demo 已采集的 span、指标、system prompt、上下文、模型请求/响应、工具、客户端时序。
- 标注每项在工程/算法视图中的展示位置与覆盖状态：完整、部分、缺失；以源码和样本为证据。

### 4. 两套 trace 的标识与互查

- 已有材料：[工程 Trace 与算法 Trace 如何互查](trace-cross-lookup-design.md)。从两侧共享 `turn_id` 的最小方案开始，说明 request ID 的语义、调用与重试的精确匹配、字段映射及双向跳转。
- 明确 OTel `trace_id`/`span_id`，业务 `session_id`/`turn_id`/`step_id`/调用 ID，以及 Langfuse ID 的关系。
- 给出 Hera → 算法视图、算法视图 → Hera 的具体查询和深链；验证重试、一对多与异步场景。

### 5. Langfuse 能否承载大量算法 trace

- 已有论证：[每天千万 Agent 请求：Langfuse 架构与大内容 Trace 容量分析](langfuse-agent-trace-capacity.md)。以全量采集为基线，说明 context、工具输入输出、reasoning 的数据放大、异步摄取与存储查询分工、正文保存方式及容量验收；目标部署压测待做。
- 说明摄取、队列、Worker、ClickHouse、对象存储和查询的数据路径与瓶颈。
- 按峰值 turn/s、节点数/turn、原文大小、保留期与查询并发建立负载模型。
- 用摄取成功率、积压、可见延迟、查询延迟和成本压测后，给出有条件的容量结论；架构可扩展不等于当前部署已达标。

## 执行顺序

1. 已确认本骨架与展示重点。
2. 完成工程侧设计和展示样例：[OpenTelemetry Trace 设计方案](otel-trace-design.md)。**设计稿已完成；自研 Agent 与 Hera 验收待做。**
3. 算法侧：[Agent Trace 效果方案](agent-trace-design.md)与[Session 自动导入组件方案](session-langfuse-bridge-design.md)。**效果与接入设计稿已完成；组件开发、自研 Agent 服务接入、业务评价标准及效果验收待做。**
4. 完成 [demo 逐项覆盖的源码核对](demo-observability-mapping.md)。**源码对照已完成；真实调用样本与远端摄取验收待做。**
5. 完成[两套 Trace 互查设计](trace-cross-lookup-design.md)。**设计稿已完成；下一项是核验业务 ID 契约、字段检索并用真实样本演示双向互查，补齐 demo 运行证据。**
6. 完成 [Langfuse 架构与容量分析稿](langfuse-agent-trace-capacity.md)。**按每天千万请求的容量模型与架构论证已完成；真实负载测量、目标部署压测与分享稿汇总待做。**

已有[调研报告](../agent-trace-research-2026-09.html)和[技术方案](../agent-trace-technical-proposal-2026-09.html)仅作为资料来源；本专题按上述重点重新组织。
