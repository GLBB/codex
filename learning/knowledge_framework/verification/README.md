# Verification 与完成判定：从“做完了”到“证明做完了”

## 先记住一句话

> 动作成功，不等于产物合格；产物合格，也不一定等于任务完成。

例如，用户要求“把测试环境网站标题改成‘夏日促销’，确认页面正常后告诉我完成了”。

```text
修改文件成功
    ↓
测试通过
    ↓
部署 API 返回成功
    ↓
浏览器确认页面真的显示新标题
    ↓
如成功标准要求：用户接受结果
    ↓
宣布任务完成
```

每一步都可能出现“看起来成功、实际没有完成”：修改了错误文件，测试没有检查标题，部署到了错误环境，或者部署请求超时但实际上已经产生了副作用。

Verification 要回答三个问题：用户真正想要的结果是什么？什么证据可以证明这个结果已经发生？证据不足或状态未知时，下一步应该是什么？

## 先把目标拆成可检查标准

用户的一句话通常还不能直接拿来验证。先把它拆成可以分别判断的 Success Criteria：

```text
Goal
    把测试环境网站标题改成“夏日促销”，确认页面正常

Success Criteria
    C1：目标代码中的标题已经修改
    C2：项目仍然可以构建，相关测试通过
    C3：测试环境运行的是包含本次修改的 Commit
    C4：浏览器访问测试环境时显示“夏日促销”
    C5：约定的页面健康检查通过

Failure Criteria
    F1：修改或部署到了错误环境
    F2：页面无法访问，或者必要检查稳定失败
    F3：部署状态无法确认，继续操作可能产生重复副作用
```

后面的 Preconditions、Tests 和 Evidence 都应该服务于这些标准。某项检查通过，只能更新它实际覆盖的 Criterion，不能自动把整个 Goal 标为完成。

## 这组教程解决什么问题

Agent 能执行动作，不等于它能证明任务已经完成。Verification 把用户目标、动作结果和终态连接起来：先把要求写成可检查的条件，再收集与条件匹配的证据，最后决定继续、等待、完成还是失败。

```text
Goal / Constraints
        ↓
Success Criteria + Failure Criteria
        ↓
Preconditions ──> Action ──> Postconditions
                                  ↓
                      Artifact / Observation
                                  ↓
                    Evidence / Verification
                                  ↓
              Continue / Human Acceptance / Terminal State
```

这里有三个不能混为一谈的层次：

- **动作成功**：一次工具调用满足自己的 Postconditions；
- **产物合格**：代码、报告、外部资源等通过对应质量检查；
- **任务完成**：所有必要 Success Criteria 都有足够证据，副作用状态明确，且需要的人工验收已经获得。

退出码为零、工具返回 `success`、模型说“已完成”，通常都只能支持其中一小部分判断。

## 推荐学习顺序

1. [Preconditions 与 Postconditions](01-preconditions-and-postconditions.md)：检查动作前后发生了什么。
2. [Tests、Assertions、Type Check 与静态验证](02-tests-assertions-and-type-check.md)：理解每种检查能证明什么、不能证明什么。
3. [Evidence、Grounding 与 Citation](03-evidence-grounding-and-citation.md)：把检查结果连接成可复核的证据链。
4. [Critic、Verifier 与 Evaluator](04-critic-verifier-and-evaluator.md)：区分找漏洞、做判定和评估系统质量。
5. [Side-Effect Reconciliation](05-side-effect-reconciliation.md)：处理动作可能已发生但确认丢失的未知状态。
6. [Human Acceptance](06-human-acceptance.md)：明确授权执行和接受结果不是一回事。
7. [Completion 与 Failure Criteria](07-completion-and-failure-criteria.md)：把各项结果归约成 Complete、Blocked 或 Failed。
8. [完整案例、设计检查与练习](08-complete-case-and-checklist.md)：用复杂的 Webhook 案例综合练习。

初学者先读本 README 中从 Goal 到 Success Criteria 的拆解，再按顺序阅读。第 8 篇是进阶综合案例，不建议作为第一篇。

## 每篇都用同一个问题阅读

阅读每一篇时，只问四件事：

1. 它防止哪一种“误以为完成”？
2. 它检查的是动作、产物，还是用户真正要的结果？
3. 它留下了什么 Evidence？
4. 检查失败或结果未知时，下一步是什么？

不要先背术语。先把“网站标题”案例中的动作、观察、检查和状态画出来，再把术语贴到相应位置。

## Verification 在 Agent Loop 中的位置

```text
                         ┌──────── Critic ────────┐
                         │                        │
Plan → Model Decision → Action → Observation → Verifier
  ↑                                      │         │
  │                                      ▼         ▼
  └──────── revise / retry ───── Artifact / Evidence
                                                    │
                       Human Acceptance ◄───────────┤
                                                    ▼
                              Complete / Partial / Blocked / Failed
```

Critic 可以指出候选结果的问题，Verifier 负责按契约作判定，Evaluator 则在一批任务上衡量系统质量。它们可以使用模型，但角色由输入、输出和决策权限决定，而不是由“是否另起一个模型调用”决定。

## 四层验证模型

| 层级 | 核心问题 | 典型机制 |
| --- | --- | --- |
| Contract Verification | 输入和动作是否满足局部契约？ | Schema、Preconditions、Postconditions |
| Artifact Verification | 产物是否具备要求的结构和行为？ | Type Check、Tests、Assertions、Diff Review |
| Claim Verification | 结论是否由事实支持？ | Evidence、Grounding、Citation、外部状态查询 |
| Task Verification | 整体目标是否达到并可进入终态？ | Success Criteria、Reconciliation、Human Acceptance |

越靠下层的检查越容易自动化，但不能自动推出上层成立。例如类型检查通过只说明程序满足一组静态约束，不能证明业务需求正确；一条引用存在也不代表它支持回答中的具体 Claim。

## 内容覆盖表

| 知识框架节点 | 对应教程 |
| --- | --- |
| Preconditions / Postconditions | 第 1 篇 |
| Tests / Assertions / Type Check | 第 2 篇 |
| Evidence / Grounding / Citation | 第 3 篇 |
| Critic / Verifier / Evaluator | 第 4 篇 |
| Side-Effect Reconciliation | 第 5 篇 |
| Human Acceptance | 第 6 篇 |
| Completion / Failure Criteria | 第 7 篇 |
| 综合运用、源码阅读、设计验收 | 第 8 篇 |

## 与其他知识部分的边界

- 第一部分定义 Goal、Success Criteria、Agent Loop 和状态转移；本部分解释如何用证据驱动这些转移。
- 第三部分讲 RAG 如何取得外部知识；本部分关注最终 Claim 是否忠于证据，以及 Citation 能否被核查。
- 第四部分讲工具调用与运行时；本部分从动作前后契约、副作用对账和任务完成角度检查工具结果。
- 第十部分的 Evaluation 关注跨样本、跨版本的系统质量；本部分中的 Verifier 首先服务于单次任务的运行时判定，第 4 篇会说明两者如何衔接。
- 安全策略决定“动作是否允许”，Verification 决定“动作或任务是否达到要求”。允许执行不等于执行正确。

## 一张最小心智模型

```text
Goal
  ↓ 拆成
Success Criteria / Failure Criteria
  ↓ 约束
Preconditions → Action → Postconditions
                           ↓
                    Observation / Artifact
                           ↓
                         Evidence
                           ↓
              Pass / Fail / Unknown / NotApplicable
                           ↓
       Continue / Retry / Reconcile / Accept / Complete
```

其中：

- **Precondition**：做之前必须成立什么；
- **Postcondition**：做完之后实际应该看到什么；
- **Evidence**：证明某个标准成立或失败的材料；
- **Verifier**：依据标准和证据作出判断；
- **Reconciliation**：副作用不确定时，去外部系统重新核对；
- **Completion**：所有必要标准满足后，才允许宣布完成。

## 学习完成标准

完成本组教程后，应能回答：

1. Preconditions、Postconditions 和 Success Criteria 分别约束什么范围？
2. 测试通过、类型正确和业务完成为什么不能相互替代？
3. Observation、Artifact、Evidence、Claim 和 Citation 如何连接？
4. Critic、Verifier 和 Evaluator 的输入、产物与权限有何不同？
5. 写操作响应丢失后，为什么不能直接重试？
6. Approval、Human-in-the-loop 和 Human Acceptance 有什么区别？
7. 部分完成、阻塞、失败、取消和超时应怎样表达？
8. 如何从每项 Success Criterion 追溯到验证方法和证据？
