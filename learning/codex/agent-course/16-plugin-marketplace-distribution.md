# 16 Plugin Marketplace：能力怎样被发现、安装、升级与治理

## 从“市场里看得到”不等于“Agent 能调用”开始

第 6 课把 Plugin 定义为 Skills、Hooks、Apps、MCP server 声明和界面 metadata 的分发
容器。但一个 Plugin 从作者目录进入 Agent 的有效能力集合，中间还有市场发现、策略判断、
安装、认证、启用和运行时重建。把这些步骤压成一个 `installed` 布尔值，会让 UI、Agent 和
执行器对当前状态产生不同理解。

先区分五种状态：

```text
Listed        市场 catalog 中存在
Installed     Plugin bundle 已被本地或远端账户安装
Enabled       当前配置和策略没有禁用它
Authenticated 依赖的 App/MCP 身份已经可用
Callable      具体组件已进入本轮有效 catalog，并能通过权限检查执行
```

状态通常沿箭头推进，但不是等价关系：管理员可以让一个已安装 Plugin 失效；一个 Plugin
可以启用，但其中某个 App 尚未登录；一个 Skill 可以被模型看到，但它要求调用的高风险
工具仍可能被 approval 拒绝。

## Marketplace、Plugin 和 Capability 是三层对象

Marketplace 是分发索引，不是一个大 Plugin；Plugin 是版本化安装单元，不是一个大工具；
Capability 才是模型最终使用的 Skill、Hook、App 或 MCP tool。

```text
Marketplace
  -> Plugin entry + source + policy + interface metadata
      -> installed Plugin bundle
          -> Skills
          -> Hooks
          -> Apps / Connectors
          -> MCP server declarations
          -> scheduled task metadata
```

这三层拥有不同的身份：Marketplace 有名称和来源，Plugin 通常用
`<plugin>@<marketplace>` 区分同名包，运行时工具还需要自己的 namespace 和 canonical
tool name。不能拿展示名称代替稳定身份，也不能因为两个市场里的 Plugin 同名就静默覆盖。

## 本地市场与远端目录解决不同问题

本地 Marketplace 可以来自仓库、用户目录或配置的 Git 市场。市场文件描述 Plugin 的名称、
来源、界面信息和策略；具体 Plugin source 可以是本地目录、Git 仓库子目录或 npm package。
本地市场适合团队内分发、离线开发和受控版本固定。

远端目录由服务端提供搜索、全局目录、团队目录和分享状态。产品通常还会区分：

| 目录或搜索范围 | 主要用途 |
| --- | --- |
| Global / Vertical | 官方或垂直领域发现 |
| Workspace directory | 团队批准并发布的 Plugin |
| Shared with me | 明确分享给当前用户或群组的 Plugin |
| Created by me | 当前用户维护或发布的 Plugin |
| Personal search | 用户自己的远端 Plugin |

“Marketplace kind”和“search scope”是不同 API 的过滤维度，不应硬编码成同一枚举。客户端
还要允许远端目录暂时不可用时继续展示已有本地结果，同时明确哪些内容可能过期。

## 完整生命周期不是一个 Install 按钮

一个可审计的生命周期至少包含以下阶段：

```text
add/configure marketplace
  -> list or search summaries
  -> read Plugin detail or preview one remote Skill
  -> evaluate source, install policy and compatibility
  -> install/materialize bundle
  -> authenticate required Apps or MCP servers
  -> rebuild effective Skills/Hooks/Apps/MCP catalogs
  -> invoke explicitly or route implicitly
  -> upgrade/share/uninstall
```

### 管理 Marketplace

`marketplace/add` 把一个 Git 来源规范化、安装到受控位置并写入用户配置；重复添加应该返回
稳定结果，而不是产生第二份副本。`marketplace/upgrade` 更新一个或全部已配置 Git 市场，
并逐市场返回成功与错误。`marketplace/remove` 删除配置和已安装的 Marketplace root，但不应
含糊地声称已经清除了历史对话或外部账户状态。

### 发现与预览 Plugin

`plugin/list` 适合展示市场分组、当前安装/启用状态和策略；`plugin/search` 适合按语义或关键
词发现候选。搜索结果是 discovery metadata，不代表 Plugin 当前已启用。详情页再通过
`plugin/read` 展开描述、Skills、Hooks、Apps、MCP servers 和 scheduled tasks。

远端 Plugin 还可以在安装前按需读取某个 Skill 正文。这是 Marketplace 层的渐进披露：先看
摘要，再预览确实影响安装判断的内容，不需要先下载整个 bundle。

### 安装、认证与生效

安装前必须再次检查 install policy、availability 和来源身份，不能只信 UI 早先缓存的
“可安装”状态。安装完成也不等于所有能力立即可用：返回的 `appsNeedingAuth` 应驱动后续
登录；`ON_INSTALL` 与 `ON_USE` 认证策略会改变交互时机。

Plugin 生效后，各组件仍走原来的系统：Skill 进入 Skill catalog，Hook 进入 Hook registry，
App/MCP 进入对应连接和工具 catalog。下一次模型请求只能看到当前 Step/Turn 确认生效的
能力快照，不能在半个工具调用中偷偷替换 runtime。

显式调用使用稳定 mention，例如 `plugin://<plugin>@<marketplace>`。自然语言里的展示名称
只适合帮助用户输入，不适合作为唯一定位方式。

### 分享、升级与卸载

分享不只是生成 URL，还要描述 discoverability 和 principal：`LISTED`、`UNLISTED`、
`PRIVATE` 决定发现方式，user/group/workspace 与 reader/editor/owner 决定谁能做什么。客户端
看到 `canPublishToWorkspace` 等能力未知时应该 fail closed，不能把 `null` 当成允许。

升级要区分远端版本和本地 materialized 版本，支持部分失败并保留可运行旧版本。卸载要清理
本地缓存和用户配置，但历史 Item、已经产生的工具结果和外部副作用仍是事实，不能重写。

## Marketplace Policy 是供应链边界

Plugin manifest 来自扩展作者，Marketplace entry 来自分发方，远端 availability 还可能来自
管理员或服务策略。它们是不同来源的声明，组合时至少检查：

| 策略 | 要回答的问题 |
| --- | --- |
| Install policy | 不可安装、可安装，还是默认安装？ |
| Auth policy | 安装时认证，还是首次使用时认证？ |
| Availability | 当前是否被管理员或服务端禁用？ |
| Eligibility | 当前账号或套餐是否满足条件？ |
| Source policy | Local、Git、npm 来源是否允许，路径是否逃逸？ |
| Product policy | 这个 Plugin 是否适用于当前产品表面？ |

安全判断必须在执行时继续存在。Marketplace 审核通过只能说明这个包可以进入分发流程，不能
授予它读取任意文件、访问任意网络或绕过 shell approval 的权限。安装脚本、Plugin Hook、
MCP tool 和 App share action 都应进入各自正常的 permission、sandbox 与 trace 链路。

## 推荐安装也是一种渐进式能力升级

当用户明确要求某个尚未安装的 Plugin 时，可以先向模型暴露一个有界推荐项：名称、短描述
和稳定 Plugin id。Agent 只有在现有工具搜索已经证明能力缺失、推荐项确实匹配且用户意图
明确时，才请求安装。

```text
installed capabilities miss
  -> bounded recommended Plugin metadata
  -> explicit install request
  -> user/client installation flow
  -> refresh effective catalogs
  -> retry the original task with newly available capability
```

这延续了前面的渐进披露原则，也是一种权限升级：模型先知道“可能有这个能力”，只有满足
触发条件后才改变外部安装状态。推荐列表不能被当成已经可调用的工具清单。

## 缓存、一致性和失败恢复

Marketplace 同时面对本地文件、Git、远端服务和本地安装缓存，不可能靠一次强一致事务解决
所有问题。生产实现需要明确每个读操作的 freshness：

- 启动时可以立即使用已有 cache，同时后台刷新远端 catalog。
- 强制刷新只有成功后才替换旧 cache；失败时保留最后可用快照和错误信息。
- 本地与远端副本用稳定远端身份去重，不能只比较显示名称。
- `version` 与 `localVersion` 分开，才能解释“目录有新版，但本地仍运行旧版”。
- 列表加载部分失败时返回有效市场和逐项错误，不让一个坏文件清空全部 catalog。
- 安装、升级和卸载应尽量幂等，并记录 source、version、policy decision 和结果。

这里的核心不是永远返回最新，而是让调用方知道当前拿到的是什么快照、为什么还能使用、
下一步怎样安全刷新。

## 动手实验：模拟团队 Plugin Marketplace

为 `mini-codex-agent` 增加两个市场：`curated` 和 `team`。两者都包含一个同名 Plugin，另有
一个需要 App 登录的 `issue-assistant`。不要实现真实下载，先用内存 catalog 和临时目录
模拟生命周期。

完成以下回放：

1. `plugin/search("issue")` 只返回摘要，尚未把任何 Skill 或 tool 加入模型上下文。
2. `plugin/read` 展示组件和策略；安装前只按需预览一个 Skill 正文。
3. 用 `<plugin>@<marketplace>` 区分同名项，验证展示名称不会造成覆盖。
4. 管理员把 Plugin 标记为不可用后，旧搜索结果不能继续完成安装。
5. 安装返回一个待认证 App；认证前 Plugin 已安装但该 App tool 不可调用。
6. 认证并刷新 catalog 后，下一轮 `tool_search` 才能发现新工具。
7. 模拟远端刷新失败，列表保留旧 cache 并报告 stale/error，而不是返回空市场。
8. 模拟 Marketplace upgrade 部分失败，成功项升级，失败项继续使用旧版本。
9. 卸载后新 Turn 不再看到组件，但历史中的调用和结果保持不变。

输出一条分发 trace，至少包含 marketplace identity、Plugin identity、remote/local version、
discovery source、policy decision、安装状态、认证状态、catalog generation 和最终调用结果。

## 常见误区

- 市场里能搜到，所以工具可调用。搜索、安装、启用、认证和运行时暴露是不同状态。
- Plugin 安装成功，所以所有组件同时成功。每类组件有自己的 loader、错误和权限链路。
- Marketplace 审核代替运行时安全。分发信任不能替代 action-level authorization。
- 一个 `enabled` 字段足够表达状态。它解释不了未安装、未认证、管理员禁用和版本漂移。
- 强制刷新失败时清空旧 cache。短暂网络故障不应摧毁最后可用 catalog。
- 卸载等于删除历史。历史事实、外部副作用和审计记录必须保留。
- Skill market、App market 和 Plugin market 必须各做一套。先区分独立 catalog，再尽量复用
  Plugin 这个组合分发边界。

## 理解之后再对照 Codex

先在 `app-server/README.md` 的 v2 方法列表中查看 Marketplace 和 Plugin 的外部生命周期，
从 `marketplace/add` 读到 `plugin/uninstall` 即可，不必先进入实现细节。协议形状集中在
`app-server-protocol/src/protocol/v2/plugin.rs`；重点比较 `PluginSummary`、`PluginDetail`、
`PluginInstallPolicy`、`PluginAuthPolicy` 和分享相关类型，确认列表状态与详情状态怎样分层。

接着阅读 `core-plugins/src/marketplace.rs` 的 `Marketplace`、`MarketplacePluginSource` 和
`MarketplacePluginPolicy`，理解本地、Git、npm source 与 install/auth policy 怎样进入统一
模型。Marketplace 配置生命周期分别位于 `marketplace_add.rs`、`marketplace_remove.rs` 和
`marketplace_upgrade.rs`；读到它们怎样规范化来源、返回部分错误和更新配置即可停止。

最后沿一个客户端请求纵向验证：App Server 的 `request_processors/marketplace_processor.rs`
处理市场配置，`request_processors/plugins.rs` 与其 `plugins/search.rs` 子模块处理列表、详情、
搜索、安装、分享和卸载。远端 catalog cache、搜索与分享分别位于
`core-plugins/src/remote/catalog_cache.rs`、`remote/search.rs` 和 `remote/share.rs`。只追踪一个
Plugin 的 identity、policy 和状态变化，不要横向扫完整个插件目录。

这些 Plugin 与 Marketplace RPC 仍处于开发阶段；课程用它们理解系统设计和当前实现，生产
客户端应以对应版本的稳定 API 声明为准。

## 本课验收

你应该能：

1. 区分 Marketplace、Plugin、Capability，以及 listed、installed、enabled、authenticated、
   callable 五种状态。
2. 画出搜索、预览、策略检查、安装、认证、catalog 刷新和实际调用的完整链路。
3. 解释 local/remote catalog、版本、缓存、去重和部分失败怎样保持一致性。
4. 设计 Marketplace policy，使分发信任不能绕过运行时权限。
5. 用 trace 和回放证明推荐安装、升级、分享与卸载不会造成静默能力漂移。
