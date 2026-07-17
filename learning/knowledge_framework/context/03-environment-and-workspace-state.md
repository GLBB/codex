# 环境与 Workspace 状态

## 1. 模型不会自动知道“现在”

模型可能知道如何使用 Git，却不知道当前分支；知道 Linux 命令，却不知道自己是否运行在 Windows；知道怎样访问网络，却不知道本轮网络是否被禁止。

这些事实必须由 Agent Runtime 观察并提供：

```text
Environment
├── OS / Shell / 当前时间 / 时区
├── 可用 Runtime、Tool 与外部连接
├── Sandbox / Approval / Network / Filesystem Policy
└── 进程与执行环境状态

Workspace
├── cwd / workspace roots
├── 仓库、分支、HEAD、dirty files
├── 文件树与目标文件内容
├── 构建配置、依赖与生成物
└── AGENTS.md 等作用域规则
```

Environment 更偏执行容器与能力，Workspace 更偏任务对象与当前工作副本；两者会交叉，但不应混为一份全量文本。

## 2. 状态有三种获取方式

| 方式 | 适用信息 | 特点 |
| --- | --- | --- |
| 启动快照 | OS、cwd、根目录、基础权限 | 便宜，但会过期 |
| 每 Turn 差量 | 当前环境切换、权限变化、AGENTS.md 更新 | 减少重复与缓存失效 |
| 按需工具读取 | Git 状态、文件内容、测试结果 | 最新、精确，但增加调用成本 |

不要在每轮把整个文件树和所有环境变量注入模型。先提供定位信息，具体内容在需要时读取，正是渐进披露。

## 3. Freshness 是 Workspace 的核心问题

“三分钟前读取的文件”不是“当前文件”。过期来源包括：

- 用户或其他进程修改了文件；
- 分支或 HEAD 发生变化；
- 构建产生新 Artifact；
- 长任务期间时间、网络或凭据状态变化；
- Resume 后工作区已不是原来的状态；
- 多 Agent 同时操作同一目录。

关键动作前应重新验证相关状态。例如应用补丁前确认目标片段仍存在，提交前重新查看 Diff，声明测试通过时保留本次运行结果而非旧摘要。

## 4. World State：真值与模型视图分离

可以把运行时维护的结构化状态称为 World State：

```text
结构化真值                           模型可见视图
cwd = /repo                ┐
network = disabled         ├─ render / diff ─→ <environment_context>...</...>
approval = on-request      ┤
agents_md_hash = abc       ┘
```

这样做有三个好处：

1. Runtime 可以比较新旧状态，只发送变化。
2. 状态可用于 Policy，而不只是给模型阅读。
3. 持久化时可以保存 Snapshot 或 Patch，恢复时重建当前视图。

模型可见文本只是 World State 的投影，不应反过来成为唯一真值源。

## 5. Workspace 信息也有信任边界

源码和仓库文档通常属于用户任务范围，但它们仍可能包含不可信内容。尤其要区分：

- `AGENTS.md` 由 Host 按已定义的目录作用域加载，可被系统认定为仓库指令来源。
- 普通 `README.md`、Issue、代码注释默认是任务数据，不因写了“Agent 必须”就成为高权限规则。
- `.env`、凭据文件和私钥即使位于 Workspace，也不应自动进入 Context。
- Git 中的远端来源和作者信息可用于 Provenance，却不等同于内容可信。

## 6. 一次安全修改前后应观察什么

以“修改一个配置解析器”为例：

```text
修改前
├── 确认 cwd、仓库根和适用 AGENTS.md
├── 确认工作区已有用户改动
├── 读取目标文件及邻近测试
└── 确认权限、工具和验证命令

修改后
├── 查看实际 Diff，避免混入无关文件
├── 运行与改动范围相称的格式化和测试
├── 重新检查 Git 状态
└── 报告未验证项与仍存在的用户改动
```

这不是额外礼仪，而是用最新 Observation 校验 Agent 对世界的内部判断。

## 7. Codex 源码阅读路线

先看 `codex-rs/core/src/context/world_state/mod.rs`，理解 `WorldStateSection`、Snapshot 和 `render_diff` 的职责。然后进入同目录的 `environment.rs`，观察 cwd、Shell、环境状态、当前日期、时区、网络和文件系统约束如何形成 `EnvironmentsState`，以及状态变化如何只渲染差量。

接着阅读 `agents_md.rs`，对比环境事实和仓库指令虽然都属于 World State，却采用不同 Section 与 Fragment。再回到 `codex-rs/core/src/context_manager/history.rs` 的 `update_world_state`，看 Snapshot、Patch 和历史基线怎样连接。

最后阅读 `codex-rs/core/src/session/world_state.rs` 与 `turn_context.rs`，确认 World State 在何时生成、何时进入 Turn。读到这里，应能解释为什么环境更新不需要每轮重发整份启动 Context。

## 8. 设计检查

- 哪些状态是启动时固定，哪些每 Turn 可能变化，哪些必须按需读取？
- 模型可见环境文本背后是否有结构化真值？
- Resume、环境切换和多 Agent 并发后是否重新验证状态？
- 是否只暴露任务所需环境信息，并默认排除秘密？
- 工作区已有修改是否会被 Agent 覆盖或误报为自己的成果？
- Patch、测试、提交等关键动作前是否使用了足够新的 Observation？

[上一篇：对话历史与 Session](02-conversation-history-and-session.md) · [返回学习地图](README.md) · [下一篇：Memory](04-memory.md)
