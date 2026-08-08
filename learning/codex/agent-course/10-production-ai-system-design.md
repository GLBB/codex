# 10 生产级 Agent 系统设计：协议、网关、稳定性、成本与排障

## 从需求而不是架构图开始

设计“团队 Coding Agent 平台”前，先问：谁使用、能操作哪些仓库、任务最长多久、允许哪些
副作用、怎样判定成功、故障时能否恢复。没有这些约束，画出的框图只会堆满热门组件。

一个可讨论的基线：

```text
Client / IDE
  -> Auth / Quota
  -> App Server Protocol
  -> Thread / Session Runtime
  -> Context Builder <-> Memory / RAG
  -> Model Gateway
  -> Tool Orchestrator
  -> Permission / Approval / Sandbox / Guardian
  -> Local or Remote Environment
  -> Trace / Metrics / Replay / Eval
```

下面逐层解释每个边界为什么存在。

## App Server：把客户端与运行时解耦

客户端关心 thread、turn、item 和流式进度，不应直接持有 core 的锁、模型 client 或 process
handle。v2 协议可以提供：

```text
thread/start | resume | read | list | fork
turn/start | steer | interrupt
item/started | delta | completed
turn/completed
```

关键语义：请求被接受不等于任务完成；客户端持续消费 notifications。`thread/read` 不启动
runtime，`includeTurns` 显式控制历史成本；长历史用 opaque cursor 分页。

协议设计要稳定版本、明确 optional/null、限制响应大小，并对 model input、工具参数和
敏感结果做脱敏。Thread/Turn id 也是跨日志、trace 和客户端事件的关联主键。

## 本地与远程 Environment

App Server 与 exec-server 可以不在同一台机器或同一 OS。上层选择 `environmentId`，目标
environment 报告自己的 cwd、shell、文件系统和 sandbox 能力：

```text
Agent decision: run tests
  -> selected environment: windows-ci
  -> target shell: powershell
  -> target cwd: file URI / native path
  -> remote execution events
```

不能用 App Server 的 `/bin/bash` 或路径规则解释 Windows 命令。网络断开时还要区分环境
从未启动、连接中、暂时断开和未知 id；恢复策略不能让一次客户端重试重复副作用。

## Model Gateway：统一入口但不隐藏语义

网关负责 provider 鉴权、模型路由、quota、重试、成本和观测。路由可以考虑任务类型、
上下文长度、能力、延迟和预算。

重试是最容易出事故的部分：模型 sampling 通常可在明确边界重试；已经执行的工具副作用
不能因为网络超时就自动重放。系统需要 idempotency key、call id 和“模型请求重试”与
“工具动作重试”的严格分离。

熔断时可以降级到备用模型，但要验证它支持所需 tool schema、context window、图片或
结构化输出。降级不是换个 model name 就完成。

## 结构化输出失败怎样恢复

工具参数或 JSON 输出要经过 schema validation。解析失败可以给模型一次有界修复机会：

```text
invalid output
  -> record parser error
  -> return concise schema feedback
  -> retry at most once
  -> still invalid: fail this step explicitly
```

危险工具的顺序应是 validation -> policy/approval -> execution。先审批一段无效或含糊参数，
再让 parser “猜着修”，会使用户批准的内容与真实动作不一致。

业务状态永远高于模型文本。模型说“部署成功”，没有 deployment tool result 就不能把状态
标成成功。

## 成本和延迟要按因果分解

Agent 慢通常不是单一“模型慢”：

| 成本来源 | 观察指标 | 常见优化 |
| --- | --- | --- |
| 模型轮数 | requests/turn | 更清晰工具结果、重复调用检测 |
| Context | input tokens、cache hit | 稳定 prefix、压缩、按需工具发现 |
| 工具 | latency/tool、并发度 | 安全并行、缓存只读查询 |
| RAG | recall、rerank latency | 缩小候选、分层检索 |
| Multi-Agent | child count、总 tokens | 只拆独立任务、限制输出 |
| 重试 | retries by reason | 分类错误、幂等边界 |

优化必须经过 eval。删掉一半 context 能降低成本，但也可能让 Agent忘记权限或验收条件。

## 稳定性：限流、熔断、降级之外还有背压

一个用户可以启动多个长 turn，每个 turn 再 spawn Agent 和工具进程。只限制 HTTP QPS 不够，
还要限制组织并发、每 thread active turn、子 Agent 数、模型 token、工具进程和输出 buffer。

客户端消费 event 太慢时需要背压或有界队列；不能无限堆积增量。取消要从协议传到 sampling、
tool runtime 和 remote environment，并明确哪些执行允许完成清理。

单个 Shell 进程内部怎样保存、轮询、drain 输出和终止，在
[第 15 课](15-shell-process-lifecycle.md)完成。本课站在平台层继续追问：每个 Session 和组织
允许多少进程，remote environment 断开时状态是否已知，重连能否从 output sequence 继续，
以及何时可以安全重试而不重复副作用。

## 一次线上错误的排查顺序

用户说“Agent 修改错文件”，按事实链排查：

```text
1. 找 thread/turn 和用户原始输入
2. 检查有效 cwd、environment 和 permission profile
3. 查看本轮模型实际 context 与 tool specs
4. 查看 tool call 参数及 pre-tool hook 修改
5. 查看 approval/Guardian/sandbox decision
6. 查看真实 tool result 与文件 diff
7. 检查后续模型如何解释结果
8. replay 复现并添加 regression case
```

不要先改 prompt。先确认错误发生在 context、模型选择、参数变换、权限、runtime 还是 UI
展示。

## 动手实验：做一份有数字的系统设计

选择业务场景，为它写：

```text
用户与成功标准:
入口协议和事件:
Thread/Turn 持久化与分页:
本地/远程 environments:
模型路由与降级:
Context / RAG / Memory 预算:
工具与副作用幂等性:
Permission / Sandbox:
并发与背压:
Trace / Metrics / Eval:
故障恢复:
```

至少给出三个数字，例如：每组织 20 个 active turns、每 turn 最多 8 次 sampling、单工具
结果 16 KB。再用“provider 故障、remote environment 断开、客户端停止消费事件”三个事故
检验设计，而不是只画 happy path。

## 常见误区

- 网关自动重试所有请求。工具副作用可能被重复执行。
- 只要有 WebSocket 就解决流式。仍需顺序、重连、背压和 terminal semantics。
- 降级模型一定兼容。工具、多模态和 schema 能力可能不同。
- 增加更多 context 能提高正确率。无关信息会增加成本和选择噪声。
- 线上答错先调 prompt。没有 trace 时只是猜。

## 理解之后再对照 Codex

App Server 生命周期和 v2 API 先看 `app-server/README.zh-CN.md`，协议类型位于
`app-server-protocol/src/protocol/v2/thread.rs`、`turn.rs`、`environment.rs`；环境选择在
`core/src/environment_selection.rs`。模型 client/retry 在 `core/src/client.rs`、
`client_common.rs`、`responses_retry.rs`。

Context、工具与 trace 分别对应 `core/src/context_manager`、
`core/src/tools/orchestrator.rs`、`core/src/tools/tool_dispatch_trace.rs`，系统观测入口见
`otel/README.md` 和 `rollout-trace/README.md`。

进程级证据先用第 15 课定位 `core/src/unified_exec`；平台级远程执行再看
`exec-server/src/client.rs`、`client_recovery.rs` 和 server process handler。这样能先分清本地
状态机，再判断网络协议在哪些边界增加了不确定性。

选一条故障链跨模块验证，比按 crate 顺序阅读更接近真实系统设计。

## 本课验收

你应该能：

1. 解释 App Server、core 和 remote environment 分别拥有哪部分状态。
2. 设计不会重复工具副作用的 retry/idempotency 边界。
3. 用指标把一次慢请求分解到模型、context、工具、RAG 或 Multi-Agent。
4. 从 trace 到 replay/eval 完成一次线上问题闭环。
