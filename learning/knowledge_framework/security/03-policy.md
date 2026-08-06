# Policy：把安全意图变成可执行规则

Policy 把“不要做危险的事”变成运行时可判断的条件。它应在模型决策之后、工具执行之前生效，不能只写在 Prompt 里。

```text
候选 Tool Call → Schema 校验 → Policy 决策 → Approval（如需）→ Isolation → 执行
```

| 维度 | 示例问题 |
| --- | --- |
| Tool | 是否允许 `read_file`，是否禁止 `send_message`？ |
| Path | 只能读工作区，是否排除 `.env`、SSH 目录和挂载点？ |
| Command | 允许测试命令，是否拒绝 `curl | sh`、删除和提权？ |
| Network | 只能访问包仓库和内部 API，是否禁止任意域名？ |
| Data flow | 哪些字段可以进入外部请求、日志或模型上下文？ |

规则要明确默认值、匹配范围、拒绝理由、例外条件、版本和生效身份。优先使用 allowlist；未知状态应拒绝或暂停。

```text
allow read_file(path ∈ workspace, path ∉ secret_patterns)
allow shell(command ∈ approved_test_commands, cwd = workspace)
deny network(destination ∉ approved_domains)
require approval write_file(path ∉ workspace)
deny send_message(data contains secret_or_customer_record)
```

## 实践

为“分析仓库并生成报告”设计一页 Policy：列出允许读取的路径、允许的命令、允许的网络域名、禁止外传的字段，以及报告提交动作的审批条件。再写三个边界测试：路径穿越、重定向到未批准域名、把 Secret 放进 URL。

---

[上一篇：Threat Model](02-threat-model.md) · [下一篇：Approval](04-approval.md) · [返回学习地图](README.md)
