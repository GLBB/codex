# 云端 Agent Trace 展示调研工作台

更新：2026-09-30。本文记录本轮任务范围、证据和待定项，供后续迭代；面向汇报的成品见[调研报告](agent-trace-research-2026-09.html)和[技术方案](agent-trace-technical-proposal-2026-09.html)。

## 交付与任务清单

| 子任务 | 交付物 / 证据 | 状态 |
| --- | --- | --- |
| T1 梳理诉求、术语、汇报口径 | 两份 HTML 的摘要、数据分层和决策表 | 已完成 |
| T2 核对 OTel GenAI 规范与 Codex 源码 | `trace-genai-rollout-trajectory.md`、本轮源码对照 | 已完成；规范仍为 Development |
| T3 核对 Codex 两种 rollout 与模型可见输入 | `rollout-to-langfuse-tutorial.md`、本轮源码对照 | 已完成；需用真实样本做精确度复核 |
| T4 分析同事的 Java demo | `/mnt/d/code/cloud-native-agentic-loop-demo` 源码；调研报告矩阵 | 已完成静态审阅，未运行 demo |
| T5 评估 Hera + Langfuse 的展示分工与容量 | 本地 Langfuse 实测、官方扩容/采样/保留文档、容量公式 | 已完成方案级评估；生产容量待压测 |
| T6 设计分阶段落地和验收 | 技术方案 HTML 的架构、字段契约、阶段及验收门槛 | 已完成条件式方案 |
| T7 按自研 Agent 实际链路验证 | 一次 turn 的真实请求、跨服务 trace、内容关联与脱敏验证 | 待自研 Agent 环境和负责人提供信息 |
| T8 DSH 对照 | DeepSeek Harness `639ed015`；Session telemetry / OTel / 投影源码与文档 | 已完成静态审阅 |
| T9 容量/权限定案 | 峰值 turn/s、payload p50/p95/p99、内容范围、Hera 接口 | 14 天保留和模型原文入 Langfuse 均为待评审假设；其余待确认与压测 |
| T10 Java/Rust 边界 | Java 外层 Agent、Rust 内层 SDK 的事件归属与 context 传播 | 已按同进程 FFI 目标形成设计；实现阶段核对 JDK 版本与 C ABI |

## 本轮已核实的事实

- 本仓库 Codex HEAD：`4bf76c22ff10a47d423817508f6fee5c18d20990`；GenAI 规范本地固定版本：`e57c543b4889619eb2a05702471937db5119165d`；Java demo HEAD：`98742947adc8a3425ca78085ea720dd86d5c021d`。
- demo 位于 Windows D 盘，已通过 `/mnt/d/code/cloud-native-agentic-loop-demo` 直接审阅，无须复制。Trace 页面以本地 `trace.jsonl` 为数据源，Context / Raw LLM 面板另读 debug 快照文件。
- demo 当前配置 `otel.traces.enabled=true`、OTLP 导出 `false`、`debug.enabled=true`。`TracingConfig` 用 `SimpleSpanProcessor`；`TraceController` 按请求读取全部本地 span 文件。两者适合本地演示，不是云端高吞吐实现。
- debug 事件有 `ContextSnapshot`、`LlmRequestRecord`、`LlmCallRecord` 三类：system prompt、历史、模型请求 JSON、responseText、stopReason、toolNames、usage/error。是否包含提供商未暴露的推理内容，不能由这些字段推断。
- demo 的 OpenAI/Anthropic 成功路径只在 usage 存在时写 `LlmCallRecord`；`responseText` 被截为前 2,000 字符，工具调用只保存名称。因此它已证明请求可见，不证明完整响应或工具调用参数可见。
- Codex 持久化 rollout 用于会话恢复；`ContextManager::record_annotated_items` 对 live history 的工具输出截断与持久化原文分离，`for_prompt` 还会做归一化。诊断 Rollout Trace 可记录模型请求和运行时 payload，用于区分模型可见内容与执行证据。产品级准确对账仍要在最终请求边界捕获。
- 本地 Langfuse 曾对同一 Codex turn 收到 34 个插件语义节点和 16,586 个原生 OTel 节点；这是一个样本，不能外推为固定倍数或生产吞吐。详见[实测摘要](assets/langfuse-install-turn-evidence.json)。
- DeepSeek Harness 已 clone 到 `/home/goulei1/code/deepseek-harness`，HEAD 为 `639ed015397290b3745d163aafe02ffee4aa3f84`。其权威 Session log 与 telemetry 采集分开；Session OTel 上传为 logs 通道，不等于通用 OTel trace；默认反馈触发捕获，按 `(session.id, session.format_version, event.seq)` 去重。独立通道有 4,000,000 字节请求上限，交接是尽力而为。参考仓库 `docs/subsystems/session-telemetry.zh.md`、`docs/subsystems/otel.zh.md`、`packages/session/session-telemetry-otel/README.zh.md`。
- 自研项目目标架构：Java 外层 Agent、Rust 内层 SDK、同进程 FFI（具体使用 JNI 或 Java FFM 待 JDK 版本与接口确定），无计划采用现成 Agent 框架，云端容器部署；峰值未知。不需要等待 Rust demo 才设计 trace。模型原文入 Langfuse、保留 14 天是用户提出的方案假设，尚未公开讨论或批准；需算法、数据与平台团队按真实案例和成本确认。
- Java FFM API 自 JDK 22 正式提供 `java.lang.foreign`，可通过 C ABI 调 Rust 导出的函数；这不等于自动跨语言传播 OTel context。FFI 参数仍需显式传 `traceparent` 与业务 ID。参考 [Oracle JDK 22 官方文档](https://docs.oracle.com/en/java/javase/22/core/foreign-function-and-memory-api.html)。

## 待产品、算法、平台确认

1. 算法团队的最小检视单元：用户 turn、单次模型请求、工具调用、子 Agent，及是否需要可复现的完整 wire request/response。建议先用真实 bad case 联合验收。
2. 模型可见的“思考”范围：只展示 provider 实际返回的 reasoning summary/显式字段；隐藏推理不可凭 trace 还原。
3. 内容采集授权：14 天及模型原文入 Langfuse 是待评审方案假设；由算法团队确认是否需要每次全量原文、system prompt、工具原始结果与多模态，数据负责人确认谁可查看、如何删除。
4. 容量参数：DAU、每 DAU turn/day、steps/turn、工具数、峰均比、payload 分位数和多模态比例。
5. Hera 是否提供 OTLP 接口、尾采样、指标/日志关联、trace URL 深链、租户隔离和保留策略。
6. Java 目标 JDK 版本、FFM/JNI 选择、Rust C ABI 及模型 provider adapter 的实际归属。

## 下一次验证的最小样本

选一个含 2 次模型调用、1 次工具调用、一次上下文裁剪/压缩的自研 Agent turn。记录同一组 `session_id`、`turn_id`、`step_id`、`inference_id`、`tool_call_id`，对比实际出站请求、算法视图、Hera span 与 Langfuse generation；检查长度/hash、token、工具输入输出、错误、链接、脱敏和丢失标识。再选一个失败样本复核。
