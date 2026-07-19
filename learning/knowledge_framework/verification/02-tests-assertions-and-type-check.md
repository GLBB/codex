# Tests、Assertions、Type Check 与静态验证

## 确定性检查也有证明边界

自动化检查的价值在于可重复、可审计，并能把失败定位到具体约束。但“检查通过”只证明被检查的性质：

| 机制 | 主要证明什么 | 通常不能单独证明什么 |
| --- | --- | --- |
| Parser / Schema Check | 输入或产物具有约定结构 | 字段语义和业务正确性 |
| Type Check | 程序满足类型系统表达的约束 | 运行时行为、性能和用户需求 |
| Assertion | 某次执行中的具体不变量成立 | 未覆盖输入上的普遍正确性 |
| Unit Test | 局部组件在样本条件下工作 | 跨组件协议和真实依赖行为 |
| Integration Test | 多组件边界能够协同 | 所有生产环境和异常分布 |
| End-to-end Test | 代表性用户路径可完成 | 隐藏边界条件与长期可靠性 |
| Static Analysis / Lint | 特定代码模式或数据流约束 | 完整功能正确性 |
| Build / Package Check | 产物可编译、链接或打包 | 部署后业务效果 |

因此验证计划应从 Success Criteria 反推检查组合，而不是先运行一个熟悉的命令，再把绿色结果解释成全部完成。

## 从要求建立 Verification Matrix

假设任务是修复跨平台路径处理：

| Success Criterion | 验证方法 | 证据 |
| --- | --- | --- |
| 目标平台都可编译 | 平台构建或交叉检查 | Build 日志、退出码、环境身份 |
| 路径语义正确 | 参数化测试 | 输入与期望输出的完整断言 |
| 现有行为不回归 | 相关 Crate 测试 | 测试集身份、结果与时间 |
| 没有无关修改 | Diff Review | 变更文件和 Hunk |
| 仓库规范满足 | Formatter、Lint、项目脚本 | 命令、版本、结果 |

矩阵暴露“哪个标准尚无验证方法”，也防止十个重复测试给人一种证据很充分的错觉。

## 测试选择应与变更风险匹配

好的顺序通常是：

1. 先运行最接近改动的快速检查，缩短反馈；
2. 再运行受影响组件的集成测试；
3. 共享协议、公共库或跨平台逻辑变更时扩大范围；
4. 高风险副作用使用隔离环境、Dry Run 或测试租户；
5. 无法运行的检查明确记录原因和剩余风险。

不应为了制造绿色结果而静默缩小测试范围，也不应在每次小改动后无差别运行全部昂贵测试。验证强度要由影响面、可逆性和失败代价决定。

## Assertions 要比较真正的不变量

测试容易出现三类弱断言：

- 只断言“没有抛错”，不检查输出或状态；
- 逐字段挑选有利结果，漏掉整体对象的意外变化；
- 对 Mock 的内部实现断言过多，却没有检查公开行为。

更强的做法是比较完整的预期对象、完整协议请求或外部可观察状态。对于 Agent Tool Loop，除了最终文本，还应断言调用了什么工具、参数是什么、调用次数是多少、Output 是否按同一 `call_id` 回写，以及副作用实际发生几次。

## 失败结果也是 Evidence

测试失败不是“验证没有产出”，而是反证或诊断证据。Verifier 应保留：

```text
check identity + command
environment / platform / version
started_at + completed_at
exit status
bounded stdout / stderr or artifact reference
coverage / skipped tests
relation to Success Criterion
```

只保存最后一行错误会丢失环境与检查范围；把无限日志全部注入模型又会破坏 Context 预算。审计记录可以保存完整 Artifact，模型上下文只使用有界摘要与定位信息。

## Flaky、Skipped 与 Stale Result

- Flaky Test 重跑后通过不能抹掉首次失败；应记录重试次数并判断是否为已知不稳定性。
- Skipped、Ignored、Quarantined 不等于 Passed；若它覆盖关键标准，该标准仍缺证据。
- 在修改前运行的结果不能证明修改后的状态；Evidence 必须绑定 Commit、内容 Hash、构建产物或环境版本。
- 缓存命中只有在输入、工具链和环境身份完整时才可复用。

## Codex 仓库中的验证层次

阅读源码时先看与当前主题最近的测试，而不是从整个测试目录搜索。以 Tool Loop 为例，从 `codex-rs/core/tests/suite/` 中一个使用 `test_codex` 和 Responses Mock 的集成测试开始，观察测试如何捕获模型请求、Tool Call 和 Function Call Output。然后看对应 Handler 的 `*_tests.rs`，理解局部语义检查与端到端行为各自覆盖什么。

App Server 对外行为则从 `codex-rs/app-server/tests/suite/` 选择一个 v2 JSON-RPC 测试，沿公开请求、通知和终态读取。到这里应停下来画出测试层级，再决定是否需要展开 Protocol 的序列化测试。

## 本篇检查

1. 每项 Success Criterion 是否至少有一种对应检查？
2. 每个检查的证明边界是否明确？
3. 测试是否断言真实行为、完整状态或协议轨迹？
4. Evidence 是否绑定代码、环境、工具版本和时间？
5. Flaky、Skipped、Cached 和未运行是否被如实表达？
6. 验证范围是否与变更影响面和失败代价匹配？

---

[上一篇：Preconditions 与 Postconditions](01-preconditions-and-postconditions.md) · [返回学习地图](README.md) · [下一篇：Evidence、Grounding 与 Citation](03-evidence-grounding-and-citation.md)
