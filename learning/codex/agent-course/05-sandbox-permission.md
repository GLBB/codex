# 05 Sandbox 与 Permission：让 Agent 安全地行动

## 本课目标

Coding agent 能读文件、改文件、跑命令、访问网络。没有安全边界，它就是一个不受控的自动化脚本。本课学习四层边界：

- Approval：是否需要用户批准。
- Sandbox：进程能访问哪些文件、网络和系统能力。
- Exec policy：哪些命令形态被允许。
- Guardian：让另一个审查者评估危险动作。

## Step 1：先给命令分级

把命令按风险分成四类：

| 类型 | 例子 | 默认策略 |
| --- | --- | --- |
| 只读 | `ls`, `pwd`, `rg` | allow |
| 局部写入 | `apply_patch`, format | allow 或 ask |
| 高风险写入 | `rm`, `chmod`, `git reset` | ask 或 deny |
| 外部影响 | network, deploy, credential | ask 或 deny |

这不是 Codex 的完整策略，只是帮助你进入源码前先建立风险模型。

## Step 2：阅读工具侧安全入口

打开：

1. `codex-rs/core/src/tools/sandboxing.rs`
2. `codex-rs/core/src/tools/network_approval.rs`
3. `codex-rs/core/src/tools/handlers/shell.rs`
4. `codex-rs/core/src/tools/runtimes/shell.rs`

找这几个问题：

- 执行前如何决定是否需要 approval？
- 网络权限如何处理？
- sandbox 失败后是否会重试？
- 结果如何告诉模型和用户？

## Step 3：阅读 sandbox 实现

打开：

1. `codex-rs/sandboxing/src/manager.rs`
2. `codex-rs/sandboxing/src/bwrap.rs`
3. `codex-rs/sandboxing/src/landlock.rs`
4. `codex-rs/sandboxing/src/seatbelt.rs`
5. `codex-rs/linux-sandbox/src/linux_run_main.rs`

观察不同平台或机制：

- macOS seatbelt。
- Linux landlock/bubblewrap。
- 网络策略。
- 读写路径策略。

## Step 4：阅读 exec policy

打开：

1. `codex-rs/execpolicy-legacy/README.md`
2. `codex-rs/execpolicy-legacy/src/policy.rs`
3. `codex-rs/execpolicy-legacy/src/valid_exec.rs`
4. `codex-rs/execpolicy-legacy/src/default.policy`

思考：为什么只看命令字符串不够？参数、路径、重定向、shell 展开都会影响真实行为。

## Step 5：动手练习

给 `mini-agent` 加一个命令审批器：

```text
classify(command):
  if command starts with ["ls", "pwd", "rg"]:
    return allow
  if command contains ["rm", "git reset", "chmod"]:
    return ask
  if command needs network:
    return ask
  return deny
```

然后对这些命令写出决策和理由：

```bash
ls
rg "Session"
rm -rf target
curl https://example.com
git status
git reset --hard
```

## Codex 对照源码

- `codex-rs/core/src/tools/sandboxing.rs`
- `codex-rs/core/src/tools/network_approval.rs`
- `codex-rs/sandboxing/src/manager.rs`
- `codex-rs/sandboxing/src/bwrap.rs`
- `codex-rs/sandboxing/src/landlock.rs`
- `codex-rs/sandboxing/src/seatbelt.rs`
- `codex-rs/linux-sandbox/src/linux_run_main.rs`
- `codex-rs/execpolicy-legacy/src/policy.rs`
- `codex-rs/core/src/guardian`

## 推荐资料

- [bubblewrap](https://github.com/containers/bubblewrap)
- [Docker security](https://docs.docker.com/engine/security/)
- [Linux namespaces](https://man7.org/linux/man-pages/man7/namespaces.7.html)
- [seccomp](https://man7.org/linux/man-pages/man2/seccomp.2.html)
- [Linux capabilities](https://man7.org/linux/man-pages/man7/capabilities.7.html)

## 验收标准

你完成本课时，应该能回答：

- Approval、Sandbox、Exec policy、Guardian 分别解决什么问题？
- 为什么“问用户批准”不能替代 sandbox？
- 为什么 sandbox 失败的错误要回填给模型？
- 一个工具新增执行能力时，要补哪些安全检查？
