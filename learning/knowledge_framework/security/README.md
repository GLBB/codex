# 安全与治理学习地图

## 这组教程解决什么问题

Agent 不只会生成文字，还可能读取文件、运行命令、访问网络、调用 SaaS、修改代码或发送消息。安全与治理要解决的不是“模型是否聪明”，而是：什么可以被相信、什么可以被执行、谁必须批准、动作最多能影响什么，以及出了问题能否追溯和止损。

本组用一个贯穿案例学习：一个 Agent 根据项目资料生成报告，并可读取工作区、查询内部 API，最后把报告提交到文档系统。案例中的资料可能被注入，API 可能返回敏感数据，提交动作还可能产生外部副作用。

```text
输入与来源 → Trust Boundary → Threat Model
                         ↓
             Policy → Approval → Isolation
                         ↓
       Identity / Credentials → Privacy → Audit
                         ↓
                    可控的副作用
```

## 推荐学习顺序

1. [Trust Boundary：谁能发指令](01-trust-boundary.md)：区分用户指令、系统策略、工具结果和外部资料。
2. [Threat Model：攻击者如何利用 Agent](02-threat-model.md)：用资产、入口、影响和控制分析 Prompt Injection、Exfiltration 与 Supply Chain。
3. [Policy：把安全意图变成可执行规则](03-policy.md)：限制工具、路径、命令、参数和网络目标。
4. [Approval：何时必须停下来询问](04-approval.md)：设计审批等级、审批内容、会话授权和拒绝路径。
5. [Isolation：限制“即使失控也能做什么”](05-isolation.md)：比较 Worktree、Sandbox、Container 与 VM 的边界。
6. [Identity 与 Credentials：动作究竟以谁的身份发生](06-identity-and-credentials.md)：理解用户、Agent、工具、服务身份，以及 Secret、Scope、委托和轮换。
7. [Privacy 与 Audit：少看、少留、可追溯](07-privacy-and-audit.md)：设计最小披露、留存删除和审计事件。
8. [完整案例、检查表与练习](08-complete-case-and-exercises.md)：把所有控制放进一次从读取资料到发布报告的流程。

## 三条主线

```text
信任链
Source → Interpretation → Permission → Action → Side Effect

控制链
Policy → Approval → Isolation → Identity → Credential Scope

证据链
Decision → Input / Tool / Actor → Result → Audit → Review
```

不要把审批当作沙箱，也不要把日志当作权限控制。它们分别降低“未经同意的动作”“动作的影响范围”和“事后无法解释”的风险。

## 学习完成标准

完成本组后，应能：

1. 说明一段文字为什么可见但没有指令权限；
2. 为一个 Agent 画出信任边界和数据流；
3. 把“禁止外传源码”写成可检查的工具、字段和域名规则；
4. 判断哪些动作需要逐次审批，哪些可以预授权；
5. 解释 Worktree、Sandbox、Container 和 VM 解决的不同问题；
6. 为一次外部调用绑定用户、Agent、工具和服务身份；
7. 设计 Secret 不进入模型上下文、日志和结果的路径；
8. 让审计记录足以还原来源、决策、动作、结果和副作用。

---

[返回 Agent 知识框架](../agent_knowledge_framework)
