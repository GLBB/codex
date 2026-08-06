# Identity 与 Credentials：动作究竟以谁的身份发生

一次外部动作至少涉及：发起请求的 User、负责决策的 Agent、实际调用的 Tool，以及接受请求的 External Service。审计和授权不能把它们压成一个用户名。

```text
User intent → Agent decision → Tool execution → Service authorization
```

用户身份说明“谁提出了目标”，不自动说明 Agent 可以做什么；Agent 身份说明“哪个运行实例作出决策”；工具身份说明“哪个组件执行”；服务身份和租户说明“外部系统最终认可谁”。

凭据应只在运行时需要时注入，不进入模型上下文；Scope、Audience、Tenant 和有效期最小化；委托链保留原始用户；支持撤销、轮换和过期。

例如，给报告 Agent 一个只能读取分析库的短期 Token，不给它通用云 Token；提交报告使用独立的 Broker 身份，且绑定用户、报告版本和目标文档。

## 实践

为贯穿案例画 Credential Flow：谁申请 Token、谁保存、谁注入、Token 能访问哪些数据、何时过期、泄露后如何撤销。然后检查模型可见的每个字符串，确认不会出现 Secret、完整 Authorization Header 或可重放 URL。

---

[上一篇：Isolation](05-isolation.md) · [下一篇：Privacy 与 Audit](07-privacy-and-audit.md) · [返回学习地图](README.md)
