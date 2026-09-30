# Agent Trace：工程排障与算法复盘

> 分享页底稿；[index.html](index.html) 用图与按需查看呈现。自研 Agent 接入方案尚待目标环境验收，Codex 仅作源码与样本参照。

## 1. 为什么需要两类 trace

工程 trace 定位执行问题，算法 trace 复盘输入、行动与结果，两者描述同一轮任务。

- **工程 / OTel → Hera：**慢在哪，错在哪；看耗时、错误、重试和跨服务调用。
- **算法 / Session → Langfuse：**依据是什么，结果怎样；看实际输入、工具证据、最终产物和质量评分。

## 2. 工程侧：一轮执行由哪些 OTel Span 组成

### 2.1 执行树

入口 SERVER → 本轮 invoke_agent INTERNAL → 各 Step。每个 Step 下，模型 CLIENT 与工具 INTERNAL 同级；模型传输尝试放在逻辑模型调用下，重试保留各次尝试。

HTML 用可点击的树展示这些关系。Step 是项目自定义；检索、记忆、MCP 与子 Agent 按实际操作增加。

### 2.2 Span 定义：按需查看

采用 gen_ai.html「Span 定义」的双栏方式：左侧选类别，右侧查看属性。完整字段留在浏览器里，正文不再铺开两张大表。

- **标准定义：**Agent 5 项、模型与工具 6 项、MCP 2 项、Provider 特化 5 项；共 18 项、247 条按 Span 分列的属性定义。
- **字段：**类型、要求等级、适用条件与稳定度；说明、枚举、示例按需展开。
- **继承：**Provider 特化补充或覆盖基础字段，kind 与其余属性沿用基础定义。
- **补充：**工程骨架、5 项规范空白与 8 项内容 Schema 单独列出。

标准基线为 GenAI 快照 `e57c543b4889619eb2a05702471937db5119165d`，GenAI / MCP 为 development。内容属性仍按原规范显式开启。

## 3. 算法侧：从 Session 历史到 Langfuse

Session 保存原始交互，Bridge 按身份配对记录，再编码成 Langfuse 可展示的 Span。

### 3.1 记录协议：每条 item 要说清三件事

| 协议部分 | 关键字段 | 用途 |
| --- | --- | --- |
| 归属 | session_id / turn_id / task_id / step_id | 确定对话、任务、Agent 与步骤。 |
| 配对 | invocation_id + attempt_id / execution_id / call_id | 区分模型尝试、工具执行和模型发起的工具调用。 |
| 证据 | kind / occurred_at / payload / evidence | 保存动作、时间、原文、内容来源与完整性。 |

封套还包括 schema_version、source、event_id、sequence、node_id 与 parent_node_id，分别用于版本适配、读取检查点、去重、排序、节点归并与建树。外层由 Agent 记录，payload 保留模型或工具协议原文。

item 类型至少包括 turn.started / finished、step.started / finished、model.requested / completed、tool.started / completed。检索、上下文处理与子任务通过扩展类型定义。

HTML 默认展示三张协议卡，完整封套示例与字段职责折叠查看。

### 3.2 两条记录怎样形成一个节点

流程：**Session items → Adapter 归一化 → Builder 配对并建树 → Mapper 编码 OTLP → Langfuse**。

| 开始与结束记录 | 配对身份 | Langfuse 节点类型 |
| --- | --- | --- |
| turn.started + turn.finished | turn_id + task_id | 根 agent |
| step.started + step.finished | step_id | 普通 span |
| model.requested + model.completed | invocation_id + attempt_id | generation |
| tool.started + tool.completed | execution_id | tool |

开始记录提供输入和开始时间，结束记录提供输出、状态和结束时间；parent_node_id 决定父节点。HTML 的交互图用同色 ID 展示配对依据，不使用 E1、E8 等事件编号。

一次 Turn 共用 traceId；各 node_id 稳定映射为 spanId，parent_node_id 映射为 parentSpanId。Langfuse 通过 langfuse.observation.type 将 OTLP Span 展示为 agent / span / generation / tool，多轮通过 sessionId 分组。

每次模型重试独立生成一个 Generation；没有原生 Step 时派生并标注来源。没有结束记录或关联键时保留不完整状态。

### 3.3 调用之间怎样关联

**模型 M1 返回 call_id=C1 → 工具执行 X1，记录 C1 与发起方 M1/1 → 下一次模型 M2 的实际请求回填 C1，并记录使用的 execution_id=X1。**

call_id 串起信息流，execution_id 区分具体执行；这些关系独立于 Step 下的父子树。工具原返回与模型实际输入分别保存。

实际请求证明本次发送内容；完整上下文需有效快照，历史拼接标为 reconstructed。Turn 终结且记录完整后冻结节点，经 `/api/public/otel/v1/traces` 上报，并设置 `x-langfuse-ingestion-version: 4`。

## 4. 工程与算法 trace 如何互查

两侧保存同一个 turn_id；定位具体调用时，再用 invocation_id + attempt_id 或 execution_id。

工程侧 app.agent.model_call_id 与 Session invocation_id 保存同值，在相同租户、服务与任务范围内查询。

## 5. Langfuse 如何承载大量 Agent trace

摄取、异步处理和分析查询分开，分别应对流量高峰、写入负载与查询压力。

- API 持久化原始事件到 S3，再把事件引用放入 Redis。
- Worker 读取队列和原始内容，异步写入 ClickHouse；处理能力可独立扩容。
- UI / API 查询 ClickHouse 观测数据与 PostgreSQL 项目事务数据。

HTML 用架构图展示路径，再用四个短标签解释削峰、扩容、列存分析和对象存储。

容量示例：**1,000 万 Turn / 日 × 20 节点 / Turn × 未压缩 30 KB / 节点 = 2 亿节点、6 TB / 日**。默认只展示关键数字，详细假设与计算器按需展开。实际承载需在目标部署压测；保留总量另计压缩、复制、索引与附件。

## 验证证据与参考资料

- 4 节点合成样本：已验证插件转换与本地投递。
- 34 节点已有真实 trace：已查询平台结构。
- 自研接入、两侧互查与目标容量：待目标环境验收。

协议、互查与容量的详细设计作为按需参考，不展开为分享页的主线。
