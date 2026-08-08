# 11 学习验收：把“我懂了”变成可验证的项目证据

## 为什么要单独有一课做验收

看懂文章时产生的熟悉感，不等于能独立设计和排障。真正掌握一个 Agent 概念，至少能完成
五层表达：定义边界、画出数据流、解释取舍、处理失败、拿出运行证据。

本课不是再教新术语，而是把前面课程产出组成一份可以演示、复盘和面试表达的作品集。

## 先准备证据，而不是准备答案

你的 `mini-codex-agent` 或源码阅读笔记至少应包含：

1. 一次成功 Agent Loop 的事件 trace。
2. Thread/Session/Turn/Item 状态图和一次 resume 记录。
3. 三个工具的 schema、成功结果、错误结果与上限。
4. Context Inspector 的预算报告和一次 compact 前后对比。
5. Approval/Sandbox 拒绝且没有副作用的证据。
6. MCP 或 Skill 的渐进加载例子。
7. deferred tool discovery 与 App namespace 例子。
8. PreToolUse、PermissionRequest、PostToolUse hook 的回放。
9. Multi-Agent mailbox、follow-up 与 interrupt 的状态记录。
10. 一个长进程从 initial yield、poll 到 exit/shutdown 的 trace。
11. Plugin 从 Marketplace 搜索、策略判断、安装认证到能力生效的 trace。
12. 至少十个 regression cases。

没有项目证据时，回答很容易停在定义；有证据后，你可以说“这是我怎样实现、怎样失败、
怎样被测试抓住的”。

## 第一关：两分钟讲清核心链路

不用看笔记，用白板画：

```text
用户输入
  -> Thread/Turn
  -> Context + Tools
  -> Model Stream
  -> Tool Call
  -> Permission/Sandbox
  -> Tool Result
  -> 下一次 Model Request
  -> Final Item + Persistence + Trace
```

讲解必须包含：一次 turn 为什么有多次模型请求；tool call 为什么不等于已执行；错误如何
回填；何时停止；哪些状态跨进程保留。

如果两分钟内只能罗列模块，回到第 1、2、3 课，用同一个 query 重新串链路。

## 第二关：现场诊断一个失败案例

案例：Agent 声称读过 README，但 trace 没有文件工具调用，最终答案还引用了错误安装命令。

按顺序回答：

1. 先核对哪几个事实？
2. 是工具选择、context、RAG 还是 UI 显示问题？
3. 需要补哪些 trace 字段？
4. 修复后写什么 regression case？
5. 哪个指标能监控同类问题？

合格答案不能只说“优化 prompt”，而要从可观察证据定位到具体层。

## 第三关：做四个架构取舍

### 是否使用 Agent

固定审批流程优先 Workflow；路径开放、需要工具反馈时用 Agent。说明不使用另一方案的
具体理由。

### 是否使用 Multi-Agent

只有独立并行、上下文隔离或独立验收带来收益时才拆分。给出子任务边界、通信成本和失败
恢复，不能只说“planner/coder/tester”。

### 能力做成什么扩展

外部执行接口选 MCP，工作方法选 Skill，分发组合选 Plugin，安全不变量留在 core 或受管
policy。给一个反例说明错误选择会造成什么问题。

### 怎样分发 Plugin

区分 Marketplace、Plugin 和 Capability，再说明 listed、installed、enabled、authenticated、
callable 五种状态。设计一次市场搜索、安装策略拒绝、App 待认证、catalog 刷新和卸载回放，
证明 Marketplace 审核与安装成功都不能绕过运行时权限。

## 第四关：安全桌面演练

用户要求“把构建产物上传到公开链接”。你需要依次说明：

- payload 中可能有什么敏感数据；
- 用户授权是否覆盖具体内容和目的地；
- permission profile 与 network policy；
- exec policy/approval/Guardian 决策；
- sandbox 怎样限制实际动作；
- Hook 或 Plugin 为什么不能绕过这些边界；
- Guardian 超时后为什么拒绝。

再改变一个条件：用户明确指定某个无敏感信息的文件和目的地。说明哪些风险结论变化，
哪些硬边界不变。

## 第五关：系统设计压力测试

设计一个支持本地与远程环境的团队 Agent 平台，并应对：

1. 模型 provider 30 秒不可用。
2. 远程 Windows environment 在工具执行中断线。
3. 客户端停止消费流式事件。
4. 单个用户启动 50 个子 Agent。
5. RAG 返回包含 prompt injection 的文档。
6. 长进程已返回 `session_id`，此时客户端取消 turn 或 remote environment 断线。

每个故障都回答：用户看到什么、系统保留什么状态、能否重试、怎样避免重复副作用、trace
记录什么、怎样加入 eval。

## 25 个概念问题的使用方法

[覆盖矩阵](interview-coverage-matrix.md)列出课程覆盖方向。不要逐题背答案；每题按五分制：

| 分数 | 表现 |
| --- | --- |
| 1 | 只会复述定义 |
| 2 | 能举例，但边界含糊 |
| 3 | 能画模块和数据流 |
| 4 | 能解释失败、取舍和安全 |
| 5 | 能展示项目 trace、测试或源码证据 |

通过建议：25 题至少 20 题达到 4 分；Agent Loop、Tool、Shell Process、Context、RAG、
安全、Plugin Marketplace、Eval、Multi-Agent 各至少一题达到 5 分。低分题不要先重读全文，
先做对应实验，再回来解释。

## 最终十分钟演示

按这个顺序演示 `mini-codex-agent`：

```text
1 分钟：需求和非目标
2 分钟：一条 query 的主链路
2 分钟：状态、context 和工具契约
2 分钟：权限、sandbox 与失败恢复
1 分钟：MCP/Skill/Plugin Marketplace/Hook 扩展
1 分钟：Multi-Agent 与远程环境
1 分钟：trace、replay、eval 和下一步
```

演示中主动触发一次工具错误和一次权限拒绝。只展示 happy path 不能证明系统可生产化。

## 常见误区

- 能回答术语就算掌握。没有失败实验，很难理解边界。
- 展示代码量而不是行为证据。Agent 项目价值在不变量和可恢复性。
- 每题都硬套 Codex 设计。先解释一般原理，再用 Codex 作为一个实现证据。
- 把“没有做”藏起来。清楚说明非目标和生产差距更可信。

## 源码证据怎样使用

需要源码证据时，每个结论只选最小入口：Agent Loop 用
`core/src/session/turn.rs`，状态用 `thread_manager.rs` 与 protocol v2，工具用
`core/src/tools`，context 用 `core/src/context_manager`，Memory 用 `memories`，安全用
`sandboxing` 与 `execpolicy`，MCP/Skills/Hooks 分别用 `codex-mcp`、`core-skills`、`hooks`，
Plugin Marketplace 用 `core-plugins` 与 App Server v2 `plugin.rs`。

证据形式是“这个类型/测试证明了什么”，不是“我读过这个目录”。

## 本课验收

你完成本课时应该有：

1. 一次十分钟演示录像或演讲提纲。
2. 六个压力场景的恢复方案。
3. 25 题评分表和每道 5 分题的项目证据链接。
4. 一份“教学版与生产 Codex 还差什么”的诚实清单。
