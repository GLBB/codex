# Codex 可观测性专项

这个专项集中研究 Codex 的观测数据从哪里产生、怎样关联、如何展示，以及怎样用于排障、评测和行为分析。阅读目标是能够沿着一次真实请求，对照源码解释日志、协议事件、OTel spans、持久化 rollout 和 Rollout Trace 分别保存了什么。

## 已有文档

当前独立专题：[云端 Agent Trace 信息展示：大纲与框架](agent-trace-display/README.md)。按工程 OTel 展示、算法展示、demo 核对和两套 trace 双向关联逐步完成。

| 文档                                                                       | 解决的问题                                                                                 |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| [可观测性导读](observability-guide.md)                                     | 建立日志、反馈、协议事件、OTel、持久化 rollout、Rollout Trace 和 analytics 的总体地图      |
| [Trace、GenAI、Rollout 与 Trajectory](trace-genai-rollout-trajectory.md)   | 对照当前 GenAI 规范与 Codex 插桩，解释瀑布图、数据流、ID 关联和任务轨迹                    |
| [Codex Harness：实现分析与可观测方案](codex-harness-observability-plan.md) | 沿任务、请求视图、工具和恢复边界分析 harness，设计围绕业务对象与证据的查看体验             |
| [Langfuse 本地搭建与 Codex 接入](langfuse-local-action-plan.md)            | 本地部署、原生 OTel 与 session plugin 对照、实际验收及千万级用户容量分析                   |
| [用 Langfuse 看懂 Codex](langfuse-trace-reading-guide.md)                  | Session Plugin 与原生 trace 的技术机制、噪音来源、实际任务分析、attributes 和 CLI 阅读教程 |
| [Langfuse 最佳实践中文译文](langfuse-best-practices.zh-CN.md)              | 官方关于 trace 范围、树结构、命名、输入输出和属性的完整正文译文，以及 Codex 对照           |
| [Rollout Trace：从生成到 Langfuse 导入](rollout-to-langfuse-tutorial.md)   | 跟读诊断 bundle 与 session JSONL 的产生、插件解析、OTLP 导出，并用最小样例练习导入与对账   |
| [四种 Trace：定位、必要性与价值](trace-roles-and-value.md)                 | 区分会话恢复、Agent 行为视图、诊断运行证据和原生性能链路，解释互补与可替代边界             |
| [Rollout Trace README 中文译文](rollout-trace.zh-CN.md)                   | 完整翻译本地诊断追踪的设计、bundle 布局、语义图、多智能体关联与 reducer 不变量             |
| [云端 Agent Trace 展示调研报告](agent-trace-research-2026-09.html)         | 面向领导和同事的 HTML：工程与算法展示分层、Codex/DSH/demo 对照、规模判断及待确认问题     |
| [云端 Agent Trace 展示技术方案](agent-trace-technical-proposal-2026-09.html) | 面向方案评审的 HTML：Java/Rust 采集边界、Hera/Langfuse 架构、数据契约和分阶段验收       |
| [云端 Agent Trace 调研工作台](agent-trace-worklog.md)                    | 本轮子任务、证据版本、已知条件和后续验证清单                                           |
| [Demo 观测清单与两套 Trace 对照](agent-trace-display/demo-observability-mapping.md) | 核对 Java demo 的 spans、上下文/请求快照、消息、时序、指标和反馈，区分已有采集与算法平台承载建议 |
| [工程 Trace 与算法 Trace 如何互查](agent-trace-display/trace-cross-lookup-design.md) | 用共享 turn/request/调用身份关联 Hera 与 Langfuse，说明整轮查询、精确匹配及双向跳转 |

第二篇固定了 Codex 与 GenAI 规范的阅读版本，并包含源码对照表、关系图和调用时间线。规范仓库已 clone 到 `/home/goulei1/code/semantic-conventions-genai`，可以与 Codex 源码并排阅读。

第三篇以当前 Codex harness 为研究对象，核对 `StepContext`、任务生命周期、工具并发、事件出口和诊断归约，并记录现有 Viewer 的实时刷新与 Prompt 展示边界。第四篇配套实际 Langfuse 环境，验证两种采集路径的展示内容与边界。

想先学会使用 Langfuse，可以直接从第五篇的安装任务实战开始：同一轮任务在插件中有 34 个节点，在原生项目中有 16,586 个节点。按问题选择证据后，再读第六篇理解怎样设计有用的 trace。真实统计附有[离线证据摘要](assets/langfuse-install-turn-evidence.json)，官方译文保留固定来源版本和 MIT 许可。

想先明确为什么保留多种记录、遇到问题该看哪条路径，读[四种 Trace 的定位与价值](trace-roles-and-value.md)。文章区分执行事实与展示能力，用同一排障场景解释各条路径的作用，并给出源码阅读入口。

想跟清楚数据从 Codex 到 Langfuse 的完整路径，读[生成与导入教程](rollout-to-langfuse-tutorial.md)。先辨认两种 rollout 文件，再沿源码跟到上传边界，最后使用人工 JSONL 样例练习导入。教程同时标明诊断 bundle 尚需适配器，以及实际二进制的能力检查与本地录制验证方法。

## 建议学习路线

### 1. 先建立观测地图

从可观测性导读开始，为日志、协议事件、指标、链路、恢复材料和运行证据分别写出一个适用问题。接着打开 `codex-rs/core/src/session/mod.rs` 的 `Session::send_event`，确认同一业务事件如何影响多个出口。此时先停在出口边界，不必进入每个 recorder 的内部。

### 2. 跟读一次 turn 的 spans

打开 `codex-rs/app-server/src/app_server_tracing.rs`，看 RPC 的上下文入口；再读 `codex-rs/core/src/tasks/mod.rs` 的任务 span 与 `codex-rs/core/src/session/turn.rs` 的 sampling 和流式处理。目标是区分 RPC 受理、turn task、模型调用和事件处理的生命周期。

读到工具分发时，选择 MCP 或 unified exec 一条路径继续，记录工具返回与底层资源结束的区别。配合第二篇的示意瀑布图理解并行与等待；真实 trace 的时间与结构以实际数据为准。

### 3. 与 GenAI 语义约定对照

在 GenAI 仓库中读 `docs/gen-ai/gen-ai-spans.md` 和 `gen-ai-agent-spans.md`，再对照 Codex 的 `SessionTelemetry::record_responses`。分别核对操作边界、必填属性、推荐属性和内容采集，避免用 exporter 可用性替代语义检查。

随后比较 `gen-ai-metrics.md`、`gen-ai-token-metrics.md` 与 Codex 的 `codex-rs/otel/src/metrics/names.rs`。重点检查单位、counter/histogram 类型、inference/turn 粒度和缓存 token 的子集关系。

### 4. 区分历史恢复与数据图归约

先读 `codex-rs/rollout/src/recorder.rs` 与 `codex-rs/core/src/session/rollout_reconstruction.rs`，理解会话恢复。再读 [Rollout Trace 中文译文](rollout-trace.zh-CN.md)，对照 `codex-rs/rollout-trace/README.md`；随后进入该 crate 的 `src/raw_event.rs`、`src/model/mod.rs` 与 `src/reducer/conversation.rs`，理解本地诊断录制和逻辑模型输入重建。

完成这一阶段后，应能解释为什么终端原始输出、JS 收到的结果和下一次模型请求里的工具结果可以不同，以及为什么 reducer replay 不等于重新执行 Agent。

### 5. 用真实样例形成专项产出

选择一个规模较小的任务，保留执行版本、配置、成功标准和样例来源。使用现有观测工具采集证据，写出包含真实时间线、关联 ID、模型输入边界与验证结果的复盘。若进一步提取 trajectory，先定义任务与 step 的边界，再选择数据投影。

可以先跟读[Langfuse 实战教程](langfuse-trace-reading-guide.md)中的同一轮任务，完成文末四个自测，再对照[官方最佳实践译文](langfuse-best-practices.zh-CN.md)检查自己采集的 scope、nesting、name、input/output 和 attributes。

## 后续专题方向

以下是后续研究方向，目前尚未分别形成独立文档：

| 方向                         | 预期产出                                                     |
| ---------------------------- | ------------------------------------------------------------ |
| Trace context 与跨进程传播   | app-server、core、MCP、exec-server 的传播图与断链案例        |
| Span 生命周期与异步执行      | 流式响应、并行工具、代码 cell、长进程的真实瀑布图            |
| Logs、metrics、trace 的关联  | 用统一关联键完成一次故障定位，说明各类证据的范围             |
| GenAI 语义约定适配           | 按固定规范版本维护差异矩阵，设计逻辑操作与 metrics 映射      |
| Rollout Trace 录制与 reducer | 从 raw events 到模型可见输入和 runtime graph 的逐例分析      |
| Prompt 与内容采集            | 区分逻辑输入、传输增量、compaction checkpoint 与原始 payload |
| Trajectory 与评测            | 明确任务样本、step、成功标准、来源引用和不完整记录的处理     |
| Viewer 与诊断体验            | 将时间线、模型输入和运行资源关联，支持从问题回到原始证据     |

## 实践工具与配套阅读

| 入口                                                                                     | 用途                                          |
| ---------------------------------------------------------------------------------------- | --------------------------------------------- |
| [本地 Grafana OTEL LGTM](../../tools/observability/README.md)                            | 收集并查看 OTel logs、metrics 和 traces       |
| [Codex Trace Viewer](../../tools/codex-trace-viewer/README.md)                           | 查看当前分支的 Rollout Trace 图与原始 payload |
| [Rollout Trace 格式说明](../../codex-rs/rollout-trace/README.md)                         | 核对 bundle、事件、语义图和 reducer 的契约    |
| [Codex Query 处理流程](../codex/query-processing-flow.md)                                | 回到用户请求的完整执行链                      |
| [历史、Rollout 与恢复](../codex/core-source-guide/07-history-rollout-recovery.md)        | 补充会话历史重建的源码阅读                    |
| [工程化、测试与可观测性](../codex/deep-research/12-engineering-testing-observability.md) | 从整体工程体系理解观测与验证                  |

新增专项文章时，注明源码和规范版本，明确区分真实测量、示意数据和设计建议，并补充到本页索引。源码导航按文件、函数、数据类型及其关系组织；每个实验记录要写清捕获范围与证据能够支持的结论。
