# 05 Permission、Approval 与 Sandbox：把“能做”限制在“该做”之内

## 安全不是一个确认弹窗

用户让 Agent “清理构建产物”，模型可能提出 `rm -rf target`。即使用户点击允许，命令
中的 target 仍可能因为 cwd、变量或 shell 展开指向错误位置。因此生产系统要组合多层
防线，每层回答不同问题。

| 层 | 回答的问题 | 例子 |
| --- | --- | --- |
| Permission profile | 本轮原则上能访问什么 | 只读、workspace write、网络域名 |
| Exec policy | 这条命令形态如何判定 | allow、prompt、forbidden |
| Approval | 是否需要用户/审查者明确授权 | 请求执行高风险动作 |
| Sandbox | 即使执行，操作系统实际允许什么 | 文件根、网络、进程隔离 |
| Guardian | 自动审查是否发现额外风险 | 数据外发、破坏性范围、授权不足 |

它们是“纵深防御”，不是互相替代。

## 用一条命令走完整链路

模型请求：

```bash
git push origin feature/login-fix
```

运行时可以按这个顺序思考：

1. 解析真实命令段、cwd、环境和请求的额外权限。
2. Exec policy 检查 prefix 规则与危险命令 heuristics。
3. 当前 permission profile 是否允许所需文件和网络能力？
4. Approval policy 是否要求人或 Guardian 审查？
5. 若获准，sandbox 仍只开放批准的边界。
6. 执行结果、拒绝或 sandbox failure 都回填模型并记录 trace。

审批说“可以尝试这个动作”，sandbox 才是“进程事实上碰不到其他东西”的硬边界。

## Permission Profile 是本轮能力快照

Permission profile 不只是 `read-only`/`full-access` 的布尔值。它可以描述文件系统 entries、
网络策略、目标 environment 和 managed constraints。运行时把配置解析成当前 turn 的有效
profile，工具不能自行扩大它。

配置更新通常只影响明确的 environment 或后续 turn。已经开始或完成的副作用不会因为
后来切回 read-only 而消失。设计动态权限时要记录：谁改变、何时生效、作用在哪个 turn
和 environment。

## 项目信任为什么独立存在

仓库中的 `.codex/config.toml`、hooks 或 rules 是项目内容，也可能来自不可信 checkout。
如果进入目录就自动执行，打开恶意仓库本身会成为攻击。

因此项目层可以被发现但处于 disabled 状态，直到用户明确把项目标记为 trusted。信任的
不是“仓库内容永远安全”，而是“允许这个项目配置参与后续解析”；工具动作仍要经过
permission、approval 和 sandbox。

## Exec Policy 不只是字符串前缀判断

规则可以表达：

```starlark
prefix_rule(
    pattern = ["git", "status"],
    decision = "allow",
    match = [["git", "status"], ["git", "status", "--short"]],
    not_match = [["git", "push"]],
)
```

有效 decision 取所有匹配规则中最严格的结果：`forbidden > prompt > allow`。但真实命令
还涉及多个 shell segments、重定向、heredoc、绝对 executable 路径和 shell 展开。解析
不确定时必须保守；不能因为字符串“看起来以 git status 开头”就忽略后面的副作用。

一次审批可以产生有界 amendment，例如以后允许同一明确 command prefix。amendment 要
持久化并立刻更新内存 policy，但不能把 `git status` 的批准扩大成 `git *`。

## Sandbox 的职责是限制爆炸半径

Sandbox 在操作系统层执行边界：Linux 可使用 landlock/bubblewrap，macOS 使用 seatbelt，
Windows 有自己的 sandbox backend。不同平台实现不同，但对 Agent 暴露统一目标：允许的
读写根、网络、环境和进程能力。

Sandbox failure 不是“模型失败”。运行时可以把拒绝原因交给模型，让它改用 workspace
内路径、请求更窄权限或提供手工方案。只有在政策允许时才进入升级审批，不能自动以
unsandboxed 重试。

本课的边界停在“实际执行请求如何获准并进入 sandbox”。进程成功启动以后，谁持有它、
initial yield 为什么不等于 timeout、怎样轮询输出、写 stdin 和保证 shutdown 清理，属于
[第 15 课](15-shell-process-lifecycle.md)的进程生命周期。安全层仍会延伸到进程退出：
sandbox 持续约束进程，deferred network approval 也不能在工具第一次返回时提前结束。

## Guardian 是审查者，不是新的超级用户

Guardian 根据用户授权、动作范围和环境证据评估风险。它应该拥有更小、通常只读的调查
能力，并把 transcript、工具参数和外部内容当不可信证据。

安全关键的自动审查如果超时、模型失败或输出无法解析，应 fail closed：拒绝本次动作并
解释“审查失败”，而不是把 reviewer 故障变成放行通道。Guardian allow 也不能突破
sandbox 或 managed permission profile。

## 动手实验：实现一个五层决策器

为这些动作生成决策 trace：

```text
ls
rg "Session"
rm -rf target
curl https://example.com
git status
git reset --hard
```

输出格式：

```text
action: rm -rf target
permission_profile: workspace
exec_policy: prompt
approval: required
guardian: medium risk, target must be resolved
sandbox: workspace-only
final: ask
```

至少覆盖四个对照：同一命令在 read-only/workspace profile；trusted/untrusted 项目配置；
Guardian 成功/超时；明确 prefix amendment 前后。测试最终决策，还要断言被拒绝时没有
执行副作用。

## 常见误区

- 用户点了确认就可以关闭 sandbox。人可能没看懂真实展开后的目标。
- read-only 命令永远安全。它仍可能读取 secret 并通过网络外发。
- policy allow 等于任意环境允许。managed constraints 仍是上界。
- 项目 trusted 等于项目内容可信。它只允许配置参与，不替代运行时检查。
- Guardian 出错时回退为 allow。安全审查故障必须保守。

## 理解之后再对照 Codex

工具侧组合入口在 `core/src/tools/sandboxing.rs`、`network_approval.rs` 和 shell runtime；
平台 sandbox 位于 `sandboxing/src` 与 `linux-sandbox`。规则语言先读
`execpolicy/README.md`，解析、规则、决策和匹配分别在 `execpolicy/src/parser.rs`、
`rule.rs`、`decision.rs`、`policy.rs`，与 approval/profile/amendment 的组合在
`core/src/exec_policy.rs`。

动态 profile 看 `core/src/config/resolved_permission_profile.rs` 与
`session/turn_context.rs`；项目 trust 看 `config/src/loader/mod.rs`；Guardian 错误到拒绝的
链路在 `core/src/guardian/review.rs` 和相应测试。若要继续追踪获准后的长进程，不要在安全
模块中横向搜索，转到第 15 课，从 `core/src/unified_exec/process_manager.rs` 的
`exec_command` 接着读。

## 本课验收

你应该能：

1. 解释五层安全边界各自防什么，为什么不能少一层。
2. 说明 permission 更新和项目 trust 的生效范围。
3. 为一条包含 shell 展开的命令设计保守决策。
4. 解释 sandbox failure 和 Guardian failure 分别怎样反馈且不自动提权。
