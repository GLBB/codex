# Privacy 与 Audit：少看、少留、可追溯

先问“完成任务真正需要哪些字段”，再决定读取、发送、显示和保存什么。最小披露包括字段过滤、用途限制、访问范围、保留期限和删除能力。

```text
Collect → Minimize → Use → Redact / Aggregate → Retain briefly → Delete
```

日志中的错误堆栈、URL 查询参数、Tool Result 和模型上下文都可能成为隐性泄露路径。审计记录本身也要受访问控制、完整性保护和留存策略约束。

一条可用的审计事件应能回答：来源是什么、谁作出决定、以什么身份、调用了哪个版本的工具、传了什么范围的参数、Policy 和 Approval 结果是什么、隔离环境是什么、结果和副作用是什么、是否发生重试或补偿。可保留 `event_id`、`user_id`、`agent_run_id`、`tool_id/version`、`source_refs`、`policy_decision`、`approval_id`、`target`、参数摘要、结果状态和外部操作 ID，但不要保存 Secret 或客户原文。

## 实践

给一次“读取合同 → 生成摘要 → 提交文档”的流程设计数据清单和审计事件。为每个字段标注 `model-visible`、`external-visible`、`log-visible`、保留期限和删除者。检查日志能否重建动作，又不会重建出客户原文。

---

[上一篇：Identity 与 Credentials](06-identity-and-credentials.md) · [下一篇：完整案例与练习](08-complete-case-and-exercises.md) · [返回学习地图](README.md)
