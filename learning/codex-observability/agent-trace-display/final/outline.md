# Agent Trace 分享页：成果大纲

交付物：[最终 HTML](index.html) · [说明底稿](manuscript.md)

## 呈现原则

面向同事快速理解：每节先用一句话说明目的，再用图呈现关系；字段、协议与实现细节按需查看。

## 1. 为什么需要两类 trace

- 一句话说明工程排障与算法复盘的目的。
- 两张视角卡：耗时 / 错误 / 重试，与实际输入 / 工具证据 / 结果 / 评分。
- 本节不放任务案例。

## 2. 工程侧：一轮执行由哪些 OTel Span 组成

- 可点击的执行树：入口 → Agent → Step → 模型、工具；模型下展示传输尝试。
- 移除“树上每类 Span 记录什么”和“属性和语义约定对照”两张大表。
- 参照 gen_ai.html「Span 定义」：左侧按类别选择，右侧显示单项定义与属性。
- 保留 18 项标准定义、247 条属性定义，字段说明和取值按需展开；Provider 继承、工程骨架、规范空白与内容 Schema 分列。

## 3. 算法侧：从 Session 历史到 Langfuse

- 三张卡说明 Session 记录协议：归属、配对、证据；完整封套与 item 类型折叠查看。
- 流水线图：Session → Adapter → Builder / Mapper → Langfuse。
- 交互映射图：选择 Turn、Step、模型、工具；用相同 ID 高亮展示两条记录如何形成一个 Span。
- 信息流图：模型发起 call_id → 工具 execution_id → 下一次请求回填；明确父子树与信息流的不同职责。
- 输入来源、OTLP 上报、重试与派生 Step 的细节按需查看。

## 4. 工程与算法 trace 如何互查

- 一句话说明共用 turn_id 与更细的调用 ID。
- Hera ⇄ 共享业务身份 ⇄ Langfuse。
- 补一句 model_call_id 与 invocation_id 同值及查询作用域。

## 5. Langfuse 如何承载大量 Agent trace

- 一句话说明摄取、处理、查询的分工。
- 架构图呈现 API、S3、Redis、Worker、ClickHouse、PostgreSQL 和 UI 的路径。
- 四个简短能力标签与三个容量数字；计算器按需展开。
- 标明容量为示例，实际承载待压测。

## 按需参考

验证证据、协议、互查与容量的详细设计放在参考入口，不重复展开为分享页正文。HTML 的交互使用合成示例，自研接入与规模验收仍需目标环境验证。
