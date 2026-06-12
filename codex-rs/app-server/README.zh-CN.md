# codex-app-server 中文说明

`codex app-server` 是 Codex 用来支撑富客户端界面的接口，例如 Codex VS Code 扩展。

本文是 `README.md` 的中文翻译版。协议方法名、字段名、命令和 JSON 示例中的 key 保持英文，便于和代码、schema、原文互相对照。

## 目录

- [协议](#协议)
- [消息 Schema](#消息-schema)
- [核心概念](#核心概念)
- [生命周期概览](#生命周期概览)
- [初始化](#初始化)
- [API 概览](#api-概览)
- [常见示例](#常见示例)
- [事件](#事件)
- [审批](#审批)
- [Skills](#skills)
- [Apps](#apps)
- [认证接口](#认证接口)
- [实验性 API Opt-in](#实验性-api-opt-in)

## 协议

类似 MCP，`codex app-server` 使用 JSON-RPC 2.0 消息进行双向通信。在线上传输时，`"jsonrpc":"2.0"` 头会被省略。

支持的传输方式：

- stdio：`--stdio` 或 `--listen stdio://`，默认方式，使用一行一条 JSON 的 JSONL。
- websocket：`--listen ws://IP:PORT`，每个 websocket text frame 对应一条 JSON-RPC 消息。目前是实验性/不受支持。
- unix socket：`--listen unix://` 或 `--listen unix://PATH`，通过 `$CODEX_HOME/app-server-control/app-server-control.sock` 或自定义 socket 路径进行 websocket 连接，使用标准 HTTP Upgrade 握手。
- off：`--listen off`，不暴露本地传输接口。

使用 `--listen ws://IP:PORT` 时，同一个监听器还会提供基础 HTTP 健康检查：

- `GET /readyz`：监听器开始接受新连接后返回 `200 OK`。
- `GET /healthz`：请求没有 `Origin` 头时返回 `200 OK`。
- 任何带 `Origin` 头的请求都会被拒绝，返回 `403 Forbidden`。

websocket transport 当前仍是实验性且不受支持，不要在生产负载中依赖它。

unix socket transport 面向本地 app-server 控制平面客户端。`codex app-server proxy` 默认会打开到 `$CODEX_HOME/app-server-control/app-server-control.sock` 的一个原始流连接，也可以通过 `--sock PATH` 指定路径，并在该 socket 与 stdin/stdout 之间转发字节。被代理的流包含 websocket HTTP Upgrade 握手以及后续 websocket frames。

日志与 tracing：

- `RUST_LOG` 控制日志过滤和详细程度。
- 设置 `LOG_FORMAT=json` 会将 app-server tracing 日志以 JSON 形式输出到 `stderr`，每行一个 event。

背压行为：

- server 在传输入口、请求处理和输出写入之间使用有界队列。
- 当请求入口饱和时，新请求会被拒绝，JSON-RPC 错误码为 `-32001`，消息为 `"Server overloaded; retry later."`。
- 客户端应把这个错误视为可重试，并使用带 jitter 的指数退避。

## 消息 Schema

可以用下面命令导出当前 Codex 版本对应的 TypeScript schema 或 JSON Schema：

```bash
codex app-server generate-ts --out DIR
codex app-server generate-json-schema --out DIR
```

输出内容和执行命令时使用的 Codex 版本严格对应，因此生成文件会和该版本协议保持一致。

## 核心概念

API 暴露三个顶层概念，用来表示用户和 Codex 的一次交互：

- **Thread**：用户和 Codex agent 之间的一段对话。一个 thread 包含多个 turn。
- **Turn**：一次对话回合，通常从用户消息开始，以 agent 消息结束。一个 turn 包含多个 item。
- **Item**：turn 中的用户输入或 agent 输出，会被持久化，并作为未来对话上下文的一部分。示例包括 user message、agent reasoning、agent message、shell command、file edit 等。

使用 thread API 创建、列出或归档对话；使用 turn API 驱动对话；通过 turn notifications 流式接收进展。

## 生命周期概览

1. 每条连接初始化一次：打开 transport 连接后，立即发送带客户端元数据的 `initialize` 请求，然后发送 `initialized` notification。握手完成前，该连接上的其他请求都会被拒绝。
2. 启动或恢复 thread：调用 `thread/start` 开启新对话；继续已有对话时调用 `thread/resume`；从已有对话分支时调用 `thread/fork`。`thread/start` 和 `thread/fork` 都支持 `ephemeral: true`，表示临时内存 thread。
3. 开始 turn：发送用户输入时调用 `turn/start`，传入目标 `threadId` 和用户输入。可选字段可以覆盖 model、cwd、sandbox policy、实验性 `permissions` profile、approval policy、approvals reviewer 等。该请求会立即返回新的 turn 对象；真正开始运行时 app-server 会发送 `turn/started`。
4. 流式事件：`turn/start` 后，继续读取 JSON-RPC notifications。客户端会收到 `item/started`、`item/completed`、`item/agentMessage/delta`、工具进度等事件。这些事件表示模型流式输出和命令、工具调用、reasoning notes 等副作用。
5. 完成 turn：模型完成后，或通过 `turn/interrupt` 中断后，server 会发送 `turn/completed`，包含最终 turn 状态和 token usage。

## 初始化

客户端必须在每条 transport 连接上先发送一次 `initialize` 请求，然后用 `initialized` notification 确认。server 会返回：

- 面向上游服务的 user agent 字符串；
- server 的 Codex home 目录 `codexHome`；
- 描述 app-server 运行目标的 `platformFamily` 和 `platformOs`。

初始化前发送后续请求会得到 `"Not initialized"` 错误；在同一连接上重复初始化会得到 `"Already initialized"` 错误。

`initialize.params.capabilities` 支持按连接关闭部分 notification：通过 `optOutNotificationMethods` 提供精确方法名列表。匹配是精确匹配，不支持通配符或前缀。未知方法名会被接受并忽略。

基于 `codex app-server` 构建的应用应通过 `clientInfo` 标识自身。

`clientInfo.name` 会用于 OpenAI Compliance Logs Platform 中的客户端识别。如果你正在开发面向企业使用的新 Codex 集成，应联系 OpenAI 将其加入已知客户端列表。

官方 VS Code 扩展示例：

```json
{
  "method": "initialize",
  "id": 0,
  "params": {
    "clientInfo": {
      "name": "codex_vscode",
      "title": "Codex VS Code Extension",
      "version": "0.1.0"
    }
  }
}
```

带 notification opt-out 的示例：

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "my_client",
      "title": "My Client",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true,
      "optOutNotificationMethods": ["thread/started", "item/agentMessage/delta"]
    }
  }
}
```

## API 概览

### Thread 相关

- `thread/start`：创建新 thread，发送 `thread/started`，并自动订阅该 thread 的 turn/item 事件。请求包含 `cwd` 且解析后的 sandbox 是 `workspace-write` 或 full access 时，app-server 还会把该项目标记为受信任并写入用户 `config.toml`。
- `thread/resume`：按 id 重新打开已有 thread，后续 `turn/start` 会追加到该 thread。
- `thread/fork`：复制已有 thread 的存储历史，创建一个新的 thread id。如果源 thread 正在 turn 中，fork 会记录等同于 `turn/interrupt` 的中断标记。
- `thread/list`：分页列出存储的 rollouts，支持 cursor pagination，以及 `modelProviders`、`sourceKinds`、`archived`、`cwd`、`searchTerm` 等过滤条件。
- `thread/loaded/list`：列出当前已加载到内存中的 thread id。
- `thread/read`：读取一个已保存 thread，但不 resume。可通过 `includeTurns` 请求包含 turn 历史。
- `thread/turns/list`：实验性接口；分页读取已保存 thread 的 turn 历史，不 resume thread。
- `thread/turns/items/list`：实验性接口；为按 turn 获取完整 items 预留。目前 API shape 存在，但 app-server 会返回 unsupported-method JSON-RPC 错误。
- `thread/metadata/update`：更新 sqlite 中存储的 thread metadata，目前支持持久化 `gitInfo`。
- `thread/settings/update`：实验性接口；更新已加载 thread 的下一轮设置，不启动 turn，也不添加 transcript item。
- `thread/memoryMode/set`：实验性接口；设置 thread 的持久化 memory eligibility 为 `"enabled"` 或 `"disabled"`。
- `memory/reset`：实验性接口；清空当前 `CODEX_HOME/memories` 目录，并重置 sqlite 中的 memory stage 数据，同时保留已有 thread memory modes。
- `thread/goal/set`：为 materialized thread 创建或更新单个持久化 goal。
- `thread/goal/get`：读取 materialized thread 的当前 goal；没有 goal 时返回 `goal: null`。
- `thread/goal/clear`：清除 materialized thread 的当前 goal。
- `thread/archive`：把 thread 的 rollout 文件移动到 archived 目录，并尝试移动其 spawned descendant thread rollouts。
- `thread/delete`：硬删除 active 或 archived thread 以及 spawned descendant threads。
- `thread/unsubscribe`：取消当前连接对某个 thread 的 turn/item 事件订阅。若这是最后一个 subscriber，server 会在该 thread 30 分钟内无 subscriber 且无活动后卸载它。
- `thread/name/set`：设置或更新 thread 的用户可见名称。
- `thread/unarchive`：把 archived rollout 文件移回 sessions 目录。
- `thread/compact/start`：触发 thread 对话历史压缩。
- `thread/shellCommand`：针对 thread 运行用户发起的 `!` shell 命令。该命令不继承 thread sandbox policy，而是以 full access unsandboxed 方式运行。
- `thread/backgroundTerminals/clean`：实验性接口；终止 thread 的所有后台终端。
- `thread/backgroundTerminals/list`：实验性接口；列出已加载 thread 的后台终端。
- `thread/backgroundTerminals/terminate`：实验性接口；按 app-server `processId` 终止一个后台终端。
- `thread/rollback`：从 agent 的内存上下文中丢弃最近 N 个 turns，并在 rollout 中持久化 rollback marker。
- `thread/inject_items`：向已加载 thread 的模型可见历史中追加原始 Responses API items，但不启动用户 turn。

### Turn 相关

- `turn/start`：向 thread 添加用户输入并开始 Codex generation。响应包含初始 `turn` 对象，并流式发送 `turn/started`、`item/*` 和 `turn/completed` notifications。
- `turn/steer`：向已经 in-flight 的普通 turn 添加用户输入，而不启动新 turn。review 和 manual compaction turns 会拒绝 steer。
- `turn/interrupt`：按 `(thread_id, turn_id)` 请求取消正在运行的 turn。成功时响应 `{}`，该 turn 最终状态为 `interrupted`。

### Realtime 与 Review

- `thread/realtime/start`：实验性接口；启动 thread 级 realtime session，可选择 text 或 audio 输出，也可通过 WebRTC transport 创建 session。
- `thread/realtime/appendAudio`：向 active realtime session 追加音频输入 chunk。
- `thread/realtime/appendText`：向 active realtime session 追加文本输入。
- `thread/realtime/stop`：停止 thread 的 active realtime session。
- `review/start`：启动 Codex 自动 reviewer。响应形式类似 `turn/start`，并通过 item notifications 发送 review mode 进入/退出事件和最终 agent message。

### 命令、进程与文件系统

- `command/exec`：在 server sandbox 下运行单个命令，不启动 thread/turn，适合工具和校验。
- `command/exec/write`：向正在运行的 `command/exec` session 写入 base64 解码后的 stdin bytes，或关闭 stdin。
- `command/exec/resize`：按 `processId` 调整 PTY-backed `command/exec` session 的大小。
- `command/exec/terminate`：按 `processId` 终止正在运行的 `command/exec` session。
- `command/exec/outputDelta`：流式 `command/exec` session 的 stdout/stderr base64 chunk notification。
- `process/spawn`：实验性接口；在 app-server 所在主机上启动独立进程，不使用 Codex sandbox。
- `process/writeStdin`：向 `process/spawn` session 写入 stdin 或关闭 stdin。
- `process/resizePty`：调整 PTY-backed `process/spawn` session 大小。
- `process/kill`：终止 `process/spawn` session。
- `process/outputDelta`：`process/spawn` session 的 stdout/stderr base64 chunk notification。
- `process/exited`：`process/spawn` session 退出时发送的 notification。
- `fs/readFile`：读取绝对路径文件，返回 `{ dataBase64 }`。
- `fs/writeFile`：把 base64 编码的 `{ dataBase64 }` 写入绝对路径。
- `fs/createDirectory`：创建绝对路径目录，`recursive` 默认 `true`。
- `fs/getMetadata`：返回路径 metadata，包括 `isDirectory`、`isFile`、`isSymlink`、`createdAtMs`、`modifiedAtMs`。
- `fs/readDirectory`：列出绝对目录的直接子项。
- `fs/remove`：删除绝对路径文件或目录树，`recursive` 和 `force` 默认 `true`。
- `fs/copy`：在绝对路径之间复制；目录复制需要 `recursive: true`。
- `fs/watch`：订阅绝对文件或目录路径的文件系统变更 notification。
- `fs/unwatch`：停止此前的 `fs/watch`。
- `fs/changed`：被 watch 的路径变化时发送的 notification。

### 模型、配置、插件与 MCP

- `model/list`：列出可用模型。`includeHidden: true` 会包含隐藏模型。客户端应保留 `supportedReasoningEfforts` 数组顺序，而不是从 effort 名称推导顺序。
- `modelProvider/capabilities/read`：读取当前配置的 model provider 能力。
- `experimentalFeature/list`：列出 feature flags，包括阶段 metadata、enabled/default-enabled 状态和 cursor pagination。
- `permissionProfile/list`：beta；列出可用 permission profile ids。
- `experimentalFeature/enablement/set`：更新进程内 runtime feature enablement。
- `environment/add`：实验性接口；添加或替换命名 remote environment。
- `collaborationMode/list`：实验性接口；列出可用 collaboration mode presets。
- `skills/list`：按一个或多个 `cwd` 列出 skills，可选 `forceReload`。
- `skills/extraRoots/set`：替换 app-server 进程 runtime extra standalone skill roots。
- `hooks/list`：按一个或多个 `cwd` 列出 discovered hooks。
- `marketplace/add`：添加远程 plugin marketplace，并持久化到用户 marketplace config。
- `marketplace/remove`：移除配置的 marketplace。
- `marketplace/upgrade`：升级所有 marketplace，或按名称升级单个 marketplace。
- `plugin/list`：列出 discovered plugin marketplaces 和 plugin 状态。该接口仍在开发中，生产客户端不应调用。
- `plugin/installed`：列出已安装 plugin rows，以及显式请求的本地 install-suggestion plugin names。仍在开发中。
- `plugin/read`：读取一个 plugin 的 marketplace 信息、summary、manifest 描述、interface metadata、bundled skills/hooks/apps/MCP server names。仍在开发中。
- `plugin/skill/read`：按需读取远程 plugin skill markdown，用于预览未安装 plugin skills。
- `skills/changed`：本地 skill 文件变化时发送的 notification。
- `app/list`：列出可用 apps。
- `skills/config/write`：按名称或绝对路径写入用户级 skill config。
- `plugin/install`：从 discovered marketplace entry 安装 plugin。仍在开发中。
- `plugin/uninstall`：卸载本地或远程 ChatGPT plugin。仍在开发中。
- `mcpServer/oauth/login`：为已配置 MCP server 启动 OAuth 登录流程。
- `tool/requestUserInput`：实验性接口；为 tool call 向用户提出 1 到 3 个简短问题，并返回答案。
- `config/mcpServer/reload`：从磁盘重新加载 MCP server config，并为已加载 threads 排队刷新。
- `mcpServerStatus/list`：枚举已配置 MCP servers，包括工具、auth status、server info，以及 full detail 下的 resources/resource templates。
- `mcpServer/resource/read`：从已配置 MCP server 读取 resource。
- `mcpServer/tool/call`：调用 thread 中配置的 MCP server tool。
- `windowsSandbox/setupStart`：启动 Windows sandbox setup。
- `feedback/upload`：提交反馈报告。
- `config/read`：读取磁盘上的 effective config。
- `externalAgentConfig/detect`：检测可迁移的 external-agent artifacts。
- `externalAgentConfig/import`：应用选中的 external-agent migration items。
- `config/value/write`：向用户 `config.toml` 写入单个 config key/value。
- `config/batchWrite`：原子性应用多个 config edits。
- `configRequirements/read`：读取 `requirements.toml` 和/或 MDM 中加载的约束。

### Remote Control

- `remoteControl/enable`：实验性接口；为当前 app-server 进程启用 remote control，并返回当前状态。
- `remoteControl/disable`：实验性接口；禁用当前 app-server 进程的 remote control。
- `remoteControl/status/read`：实验性接口；读取当前 remote-control 状态。
- `remoteControl/pairing/start`：实验性接口；启动短生命周期 pairing artifact。
- `remoteControl/pairing/status`：实验性接口；查询 pairing code 是否被 claim。
- `remoteControl/client/list`：实验性接口；列出获得 environment 访问权限的 controller devices。
- `remoteControl/client/revoke`：实验性接口；撤销某个 controller device 的 grant。
- `remoteControl/status/changed`：remote-control 状态或客户端可见 environment id 变化时发送的 notification。

## 常见示例

### 示例：启动或恢复 thread

当你需要新的 Codex 对话时，启动一个全新的 thread。

```json
{ "method": "thread/start", "id": 10, "params": {
    // Optionally set config settings. If not specified, will use the user's
    // current config settings.
    "model": "gpt-5.1-codex",
    "cwd": "/Users/me/project",
    "approvalPolicy": "never",
    "sandbox": "workspaceWrite",
    // Prefer experimental profile selection:
    // "permissions": ":workspace"
    // Experimental runtime roots for :workspace_roots materialization:
    // "runtimeWorkspaceRoots": ["/Users/me/project", "/Users/me/openai"],
    // Experimental capability roots selected by the hosting platform:
    "selectedCapabilityRoots": [
        {
            "id": "github@openai",
            "location": {
                "type": "environment",
                "environmentId": "workspace",
                // Opaque to app-server; interpreted in the selected environment.
                "path": "/opt/cca/plugins/github"
            }
        }
    ],
    // Do not send both "sandbox" and "permissions".
    "personality": "friendly",
    "serviceName": "my_app_server_client", // optional metrics tag (`service_name`)
    "sessionStartSource": "startup", // optional: "startup" (default) or "clear"
    // Experimental: requires opt-in
    "dynamicTools": [
        {
            "name": "lookup_ticket",
            "description": "Fetch a ticket by id",
            "deferLoading": true,
            "inputSchema": {
                "type": "object",
                "properties": {
                    "id": { "type": "string" }
                },
                "required": ["id"]
            }
        }
    ],
} }
{ "id": 10, "result": {
    "thread": {
        "id": "thr_123",
        "preview": "",
        "modelProvider": "openai",
        "createdAt": 1730910000
    }
} }
{ "method": "thread/started", "params": { "thread": { … } } }
```

合法的 `personality` 值是 `"friendly"`、`"pragmatic"` 和 `"none"`。选择 `"none"` 时，personality placeholder 会被替换为空字符串。

要继续一个已保存 session，调用 `thread/resume` 并传入此前记录的 `thread.id`。响应结构和 `thread/start` 相同。若已保存 session 包含持久化 token usage，server 会在响应后立即发送 `thread/tokenUsage/updated`，客户端可在下一轮 turn 开始前渲染恢复后的 usage。也可以传入 `thread/start` 支持的同类配置覆盖项，包括 `approvalsReviewer`。

默认情况下，`thread/resume` 会在 `thread.turns` 中包含重建后的 turn 历史。实验性客户端可以传入 `excludeTurns: true`，仅返回 thread metadata 和 live resume state；若需要通过网络分页读取 turn 历史，再单独调用 `thread/turns/list`。在该模式下，server 也会跳过重放恢复的 `thread/tokenUsage/updated`，避免仅为归因历史 usage 而重建 turns。

实验性客户端如果希望一次往返同时获得 live resume subscription 和一页 turns，可以传入 `initialTurnsPage`。它接受与 `thread/turns/list` 相同的 `limit`、`sortDirection` 和 `itemsView` 控制项；省略时使用默认值。响应包含 `initialTurnsPage`，其中有用于后续分页的 `nextCursor` 和 `backwardsCursor`。

默认情况下，resume 使用与该 thread 关联的最新持久化 `model` 和 `reasoningEffort`。如果提供 `model`、`modelProvider`、`config.model` 或 `config.model_reasoning_effort` 中任意一项，则禁用持久化 fallback，改用显式覆盖项和正常 config 解析。

```json
{ "method": "thread/resume", "id": 11, "params": {
    "threadId": "thr_123",
    "personality": "friendly"
} }
{ "id": 11, "result": { "thread": { "id": "thr_123", … } } }

{ "method": "thread/resume", "id": 12, "params": {
    "threadId": "thr_123",
    "excludeTurns": true
} }
{ "id": 12, "result": { "thread": { "id": "thr_123", "turns": [], … } } }

{ "method": "thread/resume", "id": 13, "params": {
    "threadId": "thr_123",
    "excludeTurns": true,
    "initialTurnsPage": {
        "limit": 20,
        "sortDirection": "desc",
        "itemsView": "summary"
    }
} }
{ "id": 13, "result": {
    "thread": { "id": "thr_123", "turns": [], … },
    "initialTurnsPage": {
        "data": [ ... ],
        "nextCursor": "older-turns-cursor-or-null",
        "backwardsCursor": "newer-turns-cursor-or-null"
    }
} }
```

要从已保存 session 分支，调用 `thread/fork` 并传入 `thread.id`。这会创建新的 thread id，并为它发送 `thread/started` notification。返回的 `thread.sessionId` 标识当前 live session tree root。root threads 使用自己的 `thread.id` 作为 `thread.sessionId`；未加载的已保存 threads 也会报告自己的 `thread.id`，因为恢复它会使它成为新的 live session tree root。若源历史包含持久化 token usage，server 还会在响应后立即为新 thread 发送 `thread/tokenUsage/updated`。如果源 thread 正在运行，fork 会像先中断当前 turn 一样对其做快照。传入 `ephemeral: true` 可以让 fork 只保留在内存中：

```json
{ "method": "thread/fork", "id": 12, "params": { "threadId": "thr_123", "ephemeral": true } }
{ "id": 12, "result": { "thread": { "id": "thr_456", "sessionId": "thr_456", … } } }
{ "method": "thread/started", "params": { "thread": { … } } }
```

与 `thread/resume` 一样，实验性客户端可以向 `thread/fork` 传入 `excludeTurns: true`，让 `thread.turns` 只返回 metadata，并通过 `thread/turns/list` 分页读取历史。在该模式下，server 会跳过重放恢复的 `thread/tokenUsage/updated`，避免 fork 路径仅为归因历史 usage 而重建 turns。

### 示例：列出 threads（分页与过滤）

`thread/list` 用于渲染历史 UI。结果默认按 `createdAt` 降序排列，也就是最新在前。可以传入以下任意组合：

- `cursor`：来自上一次响应的不透明字符串；第一页省略。
- `limit`：未设置时 server 使用合理的默认 page size。
- `sortKey`：`created_at`（默认）或 `updated_at`。
- `sortDirection`：`desc`（默认）或 `asc`。
- `modelProviders`：限制为特定 providers；未设置、`null` 或空数组表示包含所有 providers。
- `sourceKinds`：限制为特定来源；省略或传 `[]` 表示只列出 interactive sessions（`cli`、`vscode`）。
- `archived`：`true` 表示只列出 archived threads；`false` 或 `null` 表示列出非 archived threads（默认）。
- `cwd`：限制为 session cwd 与该路径完全匹配的 threads；也可传数组匹配多个路径。相对路径会先相对于 app-server 进程 cwd 解析。
- `useStateDbOnly`：`true` 表示只从 state DB 返回，不扫描 JSONL rollouts 修复 metadata。省略或 `false` 保留默认 scan-and-repair 行为。
- `searchTerm`：限制为提取标题包含该子串的 threads，大小写敏感。
- 响应包含 `nextCursor`，用于按相同方向继续；也包含 `backwardsCursor`，在反转 `sortDirection` 时可作为 `cursor`。
- 响应在可用时包含 AgentControl-spawned thread sub-agents 的 `agentNickname` 和 `agentRole`。

```json
{ "method": "thread/list", "id": 20, "params": {
    "cursor": null,
    "limit": 25,
    "cwd": ["/Users/me/project", "/Users/me/project-worktree"],
    "sortKey": "created_at"
} }
{ "id": 20, "result": {
    "data": [
        { "id": "thr_a", "preview": "Create a TUI", "modelProvider": "openai", "createdAt": 1730831111, "updatedAt": 1730831111, "status": { "type": "notLoaded" }, "agentNickname": "Atlas", "agentRole": "explorer" },
        { "id": "thr_b", "preview": "Fix tests", "modelProvider": "openai", "createdAt": 1730750000, "updatedAt": 1730750000, "status": { "type": "notLoaded" } }
    ],
    "nextCursor": "opaque-token-or-null",
    "backwardsCursor": "opaque-token-or-null"
} }
```

当 `nextCursor` 为 `null` 时，说明已经到达最后一页。

### 示例：列出已加载 threads

`thread/loaded/list` 返回当前加载到内存中的 thread ids。想检查哪些 sessions 正处于活动状态、但不想扫描磁盘 rollouts 时很有用。

```json
{ "method": "thread/loaded/list", "id": 21 }
{ "id": 21, "result": {
    "data": ["thr_123", "thr_456"]
} }
```

### 示例：追踪 thread status 变化

`thread/status/changed` 会在已加载 thread 的状态变化、且该 thread 已经介绍给客户端之后发出：

- 包含 `threadId` 和新的 `status`。
- status 可以是 `notLoaded`、`idle`、`systemError` 或 `active`（带 `activeFlags`；`active` 意味着正在运行）。
- `thread/start`、`thread/fork` 和 detached review threads 不会额外发送初始 `thread/status/changed`；它们的 `thread/started` notification 已经包含当前 `thread.status`。

```json
{
  "method": "thread/status/changed",
  "params": {
    "threadId": "thr_123",
    "status": { "type": "active", "activeFlags": [] }
  }
}
```

### 示例：取消订阅 loaded thread

`thread/unsubscribe` 移除当前连接对某个 thread 的订阅。响应 status 有以下几种：

- `unsubscribed`：该连接已订阅，且现已移除。
- `notSubscribed`：该连接原本未订阅该 thread。
- `notLoaded`：该 thread 未加载。

如果这是最后一个 subscriber，server 不会立即卸载 thread。它会在该 thread 30 分钟内没有 subscriber 且没有 thread activity 后卸载，然后发送 `thread/closed` 和一个到 `notLoaded` 的 `thread/status/changed` transition。

```json
{ "method": "thread/unsubscribe", "id": 22, "params": { "threadId": "thr_123" } }
{ "id": 22, "result": { "status": "unsubscribed" } }
```

稍后，在 idle unload timeout 后：

```json
{ "method": "thread/status/changed", "params": {
    "threadId": "thr_123",
    "status": { "type": "notLoaded" }
} }
{ "method": "thread/closed", "params": { "threadId": "thr_123" } }
```

### 示例：读取 thread

使用 `thread/read` 按 id 获取已保存 thread，但不 resume。需要把历史加载到 `thread.turns` 时传入 `includeTurns`。返回的 thread 在可用时包含 subagent threads 的 `parentThreadId`、`agentNickname` 和 `agentRole`。

```json
{ "method": "thread/read", "id": 22, "params": { "threadId": "thr_123" } }
{ "id": 22, "result": {
    "thread": { "id": "thr_123", "status": { "type": "notLoaded" }, "turns": [] }
} }
```

```json
{ "method": "thread/read", "id": 23, "params": { "threadId": "thr_123", "includeTurns": true } }
{ "id": 23, "result": {
    "thread": { "id": "thr_123", "status": { "type": "notLoaded" }, "turns": [ ... ] }
} }
```

### 示例：列出 thread turns（实验性）

在 `capabilities.experimentalApi = true` 时，可以使用 `thread/turns/list` 分页读取已保存 thread 的 turn 历史，而不 resume 它。默认按降序排序，这样客户端可以从当前开始，并用 `nextCursor` 获取更旧的 turns。响应还包含 `backwardsCursor`；之后可以在 `sortDirection: "asc"` 的请求中把它作为 `cursor`，获取早先页面第一项之后的更新 turns。

每个返回的 `Turn` 都包含 `itemsView`，告诉客户端 `items` 数组是有意省略（`notLoaded`）、只包含 summary items（`summary`），还是包含持久化 app-server 历史中可用的所有 items（`full`）。传入 `itemsView` 可选择返回的详细程度；省略时默认 `"summary"`。

```json
{ "method": "thread/turns/list", "id": 24, "params": {
    "threadId": "thr_123",
    "limit": 50,
    "sortDirection": "desc",
    "itemsView": "summary"
} }
{ "id": 24, "result": {
    "data": [ ... ],
    "nextCursor": "older-turns-cursor-or-null",
    "backwardsCursor": "newer-turns-cursor-or-null"
} }
```

`thread/turns/items/list` 是计划中的 hydration API，用于获取某个 turn 的完整 items：

```json
{ "method": "thread/turns/items/list", "id": 25, "params": {
    "threadId": "thr_123",
    "turnId": "turn_456",
    "limit": 100,
    "sortDirection": "asc"
} }
```

该方法当前返回 JSON-RPC `-32601`，消息为 `thread/turns/items/list is not supported yet`。

### 示例：更新 stored thread metadata

使用 `thread/metadata/update` 修改 sqlite-backed thread metadata，而不 resume thread。当前支持持久化 `gitInfo`；省略字段保持不变，显式 `null` 会清除已保存值。

```json
{ "method": "thread/metadata/update", "id": 24, "params": {
    "threadId": "thr_123",
    "gitInfo": { "branch": "feature/sidebar-pr" }
} }
{ "id": 24, "result": {
    "thread": {
        "id": "thr_123",
        "gitInfo": { "sha": null, "branch": "feature/sidebar-pr", "originUrl": null }
    }
} }

{ "method": "thread/metadata/update", "id": 25, "params": {
    "threadId": "thr_123",
    "gitInfo": { "branch": null }
} }
{ "id": 25, "result": {
    "thread": {
        "id": "thr_123",
        "gitInfo": null
    }
} }
```

实验性接口：使用 `thread/memoryMode/set` 修改某个 thread 是否仍可参与未来 memory generation。

```json
{ "method": "thread/memoryMode/set", "id": 26, "params": {
    "threadId": "thr_123",
    "mode": "disabled"
} }
{ "id": 26, "result": {} }
```

实验性接口：使用 `memory/reset` 清除当前 Codex home 的本地 memory artifacts 和 sqlite-backed memory stage data。它会保留已有 thread memory modes；如果要改变某个 thread 未来是否可生成 memory，请另行使用 `thread/memoryMode/set`。

```json
{ "method": "memory/reset", "id": 27 }
{ "id": 27, "result": {} }
```

### 示例：设置和更新 thread goal

使用 `thread/goal/set` 为 materialized thread 创建或更新当前 goal。客户端可以在因 token budget 耗尽或接近耗尽而停止时设置 `budgetLimited`，在进展等待外部介入时设置 `blocked`，在 usage availability 阻止继续工作时设置 `usageLimited`。当 accounting 超过配置 token budget 时，系统也会设置 `budgetLimited`；当 turn 因硬性 usage-limit 错误结束时，系统会设置 `usageLimited`。

```json
{ "method": "thread/goal/set", "id": 27, "params": {
    "threadId": "thr_123",
    "objective": "Keep improving the benchmark until p95 latency is under 120ms",
    "tokenBudget": 200000
} }
{ "id": 27, "result": { "goal": {
    "threadId": "thr_123",
    "objective": "Keep improving the benchmark until p95 latency is under 120ms",
    "status": "active",
    "tokenBudget": 200000,
    "tokensUsed": 0,
    "timeUsedSeconds": 0,
    "createdAt": 1776272400,
    "updatedAt": 1776272400
} } }
{ "method": "thread/goal/updated", "params": { "threadId": "thr_123", "goal": {
    "threadId": "thr_123",
    "objective": "Keep improving the benchmark until p95 latency is under 120ms",
    "status": "active",
    "tokenBudget": 200000,
    "tokensUsed": 0,
    "timeUsedSeconds": 0,
    "createdAt": 1776272400,
    "updatedAt": 1776272400
} } }
```

```json
{ "method": "thread/goal/set", "id": 28, "params": {
    "threadId": "thr_123",
    "status": "blocked"
} }
{ "id": 28, "result": { "goal": {
    "threadId": "thr_123",
    "objective": "Keep improving the benchmark until p95 latency is under 120ms",
    "status": "blocked",
    "tokenBudget": 200000,
    "tokensUsed": 10000,
    "timeUsedSeconds": 60,
    "createdAt": 1776272400,
    "updatedAt": 1776272460
} } }
```

使用 `thread/goal/get` 读取当前 goal，而不修改它。

```json
{ "method": "thread/goal/get", "id": 29, "params": { "threadId": "thr_123" } }
{ "id": 29, "result": { "goal": null } }
```

使用 `thread/goal/clear` 移除当前 goal。

```json
{ "method": "thread/goal/clear", "id": 30, "params": { "threadId": "thr_123" } }
{ "id": 30, "result": { "cleared": true } }
{ "method": "thread/goal/cleared", "params": { "threadId": "thr_123" } }
```

### 示例：归档 thread

使用 `thread/archive` 将持久化 rollout（磁盘上的 JSONL 文件）移动到 archived sessions 目录，并尝试移动所有 spawned descendant thread rollouts。

```json
{ "method": "thread/archive", "id": 21, "params": { "threadId": "thr_b" } }
{ "id": 21, "result": {} }
{ "method": "thread/archived", "params": { "threadId": "thr_b" } }
```

除非 `archived` 设置为 `true`，archived thread 不会出现在 `thread/list` 中。

### 示例：删除 thread

使用 `thread/delete` 硬删除 thread 及其 spawned descendant threads。请求成功前，既有 rollout 文件和关联 metadata 必须被删除；缺失 rollout 文件会被视为已经删除。

```json
{ "method": "thread/delete", "id": 23, "params": { "threadId": "thr_b" } }
{ "id": 23, "result": {} }
{ "method": "thread/deleted", "params": { "threadId": "thr_b" } }
```

### 示例：反归档 thread

使用 `thread/unarchive` 将 archived rollout 移回 sessions 目录。

```json
{ "method": "thread/unarchive", "id": 24, "params": { "threadId": "thr_b" } }
{ "id": 24, "result": { "thread": { "id": "thr_b" } } }
{ "method": "thread/unarchived", "params": { "threadId": "thr_b" } }
```

### 示例：触发 thread compaction

使用 `thread/compact/start` 触发 thread 的手动历史压缩。请求会立即返回 `{}`。

进度会通过同一 `threadId` 上的标准 `turn/*` 和 `item/*` notifications 发出。客户端应预期一个 compaction item：

- `item/started`，其中 `item: { "type": "contextCompaction", ... }`
- `item/completed`，使用同一个 `contextCompaction` item id

compaction 运行时，thread 实际上处于一个 turn 中，因此客户端应根据 notifications 展示进度 UI。

```json
{ "method": "thread/compact/start", "id": 25, "params": { "threadId": "thr_b" } }
{ "id": 25, "result": {} }
```

### 示例：运行 thread shell command

`thread/shellCommand` 用于 TUI 的 `!` 工作流。请求会立即返回 `{}`。该 API 以 unsandboxed full access 运行；它不继承 thread sandbox policy。

如果 thread 已有 active turn，该命令会作为该 turn 上的辅助动作运行。在这种情况下，进度通过既有 turn 上的标准 `item/*` notifications 发出，格式化后的输出会注入该 turn 的 message stream：

- `item/started`，其中 `item: { "type": "commandExecution", "source": "userShell", ... }`
- 零个或多个 `item/commandExecution/outputDelta`
- `item/completed`，使用同一个 `commandExecution` item id

如果 thread 没有 active turn，server 会为该 shell command 启动一个 standalone turn。这时客户端应预期：

- `turn/started`
- `item/started`，其中 `item: { "type": "commandExecution", "source": "userShell", ... }`
- 零个或多个 `item/commandExecution/outputDelta`
- `item/completed`，使用同一个 `commandExecution` item id
- `turn/completed`

```json
{ "method": "thread/shellCommand", "id": 26, "params": { "threadId": "thr_b", "command": "git status --short" } }
{ "id": 26, "result": {} }
```

### 示例：启动 turn（发送用户输入）

Turns 会把用户输入（文本或图片）附加到 thread，并触发 Codex generation。`input` 字段是 discriminated unions 列表：

- `{"type":"text","text":"Explain this diff"}`
- `{"type":"image","url":"https://…png"}`
- `{"type":"localImage","path":"/tmp/screenshot.png"}`

也可以为新 turn 指定 config overrides。指定后，这些设置会成为同一 thread 后续 turns 的默认值。`outputSchema` 仅适用于当前 turn。实验性 `environments` 是 turn-scoped：省略时继承 thread 的 sticky environments，传 `[]` 表示该 turn 不使用 environments，传入显式 environment ids 则仅覆盖当前 turn 的 sticky selection。

`approvalsReviewer` 接受：

- `"user"`：默认值。直接在客户端中 review approval requests。
- `"auto_review"`：将 approval requests 路由到经过精心提示的 subagent；它会收集相关上下文，并在批准或拒绝请求前应用基于风险的决策框架。legacy 值 `"guardian_subagent"` 仍被接受以保持兼容。

```json
{ "method": "turn/start", "id": 30, "params": {
    "threadId": "thr_123",
    "clientUserMessageId": "client_msg_123",
    "input": [ { "type": "text", "text": "Run tests" } ],
    // Below are optional config overrides
    "cwd": "/Users/me/project",
    // Experimental: turn-scoped environment selection.
    "environments": [
        { "environmentId": "local", "cwd": "/Users/me/project" }
    ],
    "approvalPolicy": "unlessTrusted",
    "sandboxPolicy": {
        "type": "workspaceWrite",
        "writableRoots": ["/Users/me/project"],
        "networkAccess": true
    },
    // Prefer experimental profile selection:
    // "permissions": ":workspace"
    // Experimental runtime roots for :workspace_roots materialization:
    // "runtimeWorkspaceRoots": ["/Users/me/project", "/Users/me/openai"],
    // Do not send both "sandboxPolicy" and "permissions".
    "model": "gpt-5.1-codex",
    "effort": "medium",
    "summary": "concise",
    "personality": "friendly",
    // Optional JSON Schema to constrain the final assistant message for this turn.
    "outputSchema": {
        "type": "object",
        "properties": { "answer": { "type": "string" } },
        "required": ["answer"],
        "additionalProperties": false
    }
} }
{ "id": 30, "result": { "turn": {
    "id": "turn_456",
    "status": "inProgress",
    "items": [],
    "error": null
} } }
```

### 示例：启动 turn（调用 skill）

在 text input 中包含 `$<skill-name>`，并同时添加一个 `skill` input item，可显式调用 skill。

```json
{ "method": "turn/start", "id": 33, "params": {
    "threadId": "thr_123",
    "input": [
        { "type": "text", "text": "$skill-creator Add a new skill for triaging flaky CI and include step-by-step usage." },
        { "type": "skill", "name": "skill-creator", "path": "/Users/me/.codex/skills/skill-creator/SKILL.md" }
    ]
} }
{ "id": 33, "result": { "turn": {
    "id": "turn_457",
    "status": "inProgress",
    "items": [],
    "error": null
} } }
```

### 示例：启动 turn（调用 app）

在 text input 中包含 `$<app-slug>`，并添加一个 `mention` input item，其 app id 使用 `app://<connector-id>` 形式，即可调用 app。

```json
{ "method": "turn/start", "id": 34, "params": {
    "threadId": "thr_123",
    "input": [
        { "type": "text", "text": "$demo-app Summarize the latest updates." },
        { "type": "mention", "name": "Demo App", "path": "app://demo-app" }
    ]
} }
{ "id": 34, "result": { "turn": {
    "id": "turn_458",
    "status": "inProgress",
    "items": [],
    "error": null
} } }
```

### 示例：启动 turn（调用 plugin）

在 text input 中包含类似 `@sample` 的 UI mention token，并添加一个 `mention` input item，其 path 精确使用 `plugin/installed` 或 `plugin/list` 返回的 `plugin://<plugin-name>@<marketplace-name>`，即可调用 plugin。

```json
{ "method": "turn/start", "id": 35, "params": {
    "threadId": "thr_123",
    "input": [
        { "type": "text", "text": "@sample Summarize the latest updates." },
        { "type": "mention", "name": "Sample Plugin", "path": "plugin://sample@test" }
    ]
} }
{ "id": 35, "result": { "turn": {
    "id": "turn_459",
    "status": "inProgress",
    "items": [],
    "error": null
} } }
```

### 示例：注入 raw history items

使用 `thread/inject_items` 将预构建 Responses API items 追加到已加载 thread 的 prompt history 中，而不启动用户 turn。这些 items 会持久化到 rollout，并包含在后续 model requests 中。

```json
{ "method": "thread/inject_items", "id": 36, "params": {
    "threadId": "thr_123",
    "items": [
        {
            "type": "message",
            "role": "assistant",
            "content": [{ "type": "output_text", "text": "Previously computed context." }]
        }
    ]
} }
{ "id": 36, "result": {} }
```

### 示例：使用 WebRTC 启动 realtime

当浏览器或 webview 拥有 `RTCPeerConnection`，且 app-server 应创建 server-side realtime session 时，使用 `thread/realtime/start` 并设置 `transport.type: "webrtc"`。transport `sdp` 必须是 `RTCPeerConnection.createOffer()` 产生的 offer SDP，而不是手写或极简 SDP 字符串。

offer 应包含客户端想要协商的 media sections。对于标准 realtime UI 流程，在调用 `createOffer()` 之前先创建 audio track/transceiver 和 `oai-events` data channel：

```javascript
const pc = new RTCPeerConnection();

audioElement.autoplay = true;
pc.ontrack = (event) => {
  audioElement.srcObject = event.streams[0];
};

const mediaStream = await navigator.mediaDevices.getUserMedia({ audio: true });
pc.addTrack(mediaStream.getAudioTracks()[0], mediaStream);
pc.createDataChannel("oai-events");

const offer = await pc.createOffer();
await pc.setLocalDescription(offer);
```

然后将 `offer.sdp` 发送给 app-server。Core 使用 `experimental_realtime_ws_backend_prompt` 作为 backend instructions，并使用 thread conversation id 作为默认 Realtime API session identifier。该 `realtimeSessionId` 值指上游 Realtime API session，不是 Codex session/thread-group id。start response 为 `{}`；remote answer SDP 稍后通过 `thread/realtime/sdp` 到达，应传给 `setRemoteDescription()`：

```json
{ "method": "thread/realtime/start", "id": 40, "params": {
    "threadId": "thr_123",
    "outputModality": "audio",
    "prompt": "You are on a call.",
    "realtimeSessionId": null,
    "transport": { "type": "webrtc", "sdp": "v=0\r\no=..." }
} }
{ "id": 40, "result": {} }
{ "method": "thread/realtime/sdp", "params": {
    "threadId": "thr_123",
    "sdp": "v=0\r\no=..."
} }
```

省略 `prompt` 会使用 Codex 默认 realtime backend prompt。传 `prompt: null` 或 `prompt: ""` 表示 session 不使用该默认 backend prompt。客户端也可以在 `thread/realtime/start` 上传入 `model` 和 `version`，以选择不同 realtime session 配置，而不改变 thread 或 user config。

```javascript
await pc.setRemoteDescription({
  type: "answer",
  sdp: notification.params.sdp,
});
```

### 示例：中断 active turn

可以用 `turn/interrupt` 取消正在运行的 Turn。

```json
{ "method": "turn/interrupt", "id": 31, "params": {
    "threadId": "thr_123",
    "turnId": "turn_456"
} }
{ "id": 31, "result": {} }
```

server 会请求取消 active turn，然后发送一个 `turn/completed` event，状态为 `status: "interrupted"`。这不会终止 background terminals；如果明确想停止这些 shells，请使用 `thread/backgroundTerminals/clean`。应依赖 `turn/completed` event 判断 turn interruption 何时完成。

### 示例：清理 background terminals

使用 `thread/backgroundTerminals/clean` 终止与 thread 关联的所有正在运行 background terminals。该方法是实验性的，需要 `capabilities.experimentalApi = true`。

```json
{ "method": "thread/backgroundTerminals/clean", "id": 35, "params": {
    "threadId": "thr_123"
} }
{ "id": 35, "result": {} }
```

### 示例：列出并终止 background terminals

使用 `thread/backgroundTerminals/list` 检查与已加载 thread 关联的 running background terminals。`backgroundTerminals` segment 有意沿用既有 `thread/backgroundTerminals/clean` 方法命名。返回的 `processId` 是 app-server process id；host OS metadata 可为 null。请求接受标准 `cursor` 和 `limit` pagination 字段。当 `nextCursor` 非 null 时，将其作为 `cursor` 传入以获取下一页。

```json
{ "method": "thread/backgroundTerminals/list", "id": 36, "params": { "threadId": "thr_123" } }
{ "id": 36, "result": { "data": [
    {
        "itemId": "item_456",
        "processId": "42",
        "command": "python3 -m http.server",
        "cwd": "/workspace",
        "osPid": null,
        "cpuPercent": null,
        "rssKb": null
    }
], "nextCursor": null } }
```

使用 `thread/backgroundTerminals/terminate` 按该 `processId` 终止一个 running background terminal。

```json
{ "method": "thread/backgroundTerminals/terminate", "id": 37, "params": { "threadId": "thr_123", "processId": "42" } }
{ "id": 37, "result": { "terminated": true } }
```

### 示例：steer active turn

使用 `turn/steer` 向当前 active regular turn 追加额外用户输入。它不会发送 `turn/started`，也不接受 thread settings overrides。

```json
{ "method": "turn/steer", "id": 32, "params": {
    "threadId": "thr_123",
    "clientUserMessageId": "client_msg_124",
    "input": [ { "type": "text", "text": "Actually focus on failing tests first." } ],
    "expectedTurnId": "turn_456"
} }
{ "id": 32, "result": { "turnId": "turn_456" } }
```

`expectedTurnId` 是必需的。如果没有 active turn，`expectedTurnId` 与 active turn 不匹配，或 active turn kind 不接受 same-turn steering（例如 review 或 manual compaction），请求会以 `invalid request` 错误失败。

### 示例：请求 code review

使用 `review/start` 在当前 checkout 的项目上运行 Codex reviewer。请求接收 thread id 和一个 `target`，后者描述要 review 的内容：

- `{"type":"uncommittedChanges"}`：staged、unstaged 和 untracked files。
- `{"type":"baseBranch","branch":"main"}`：与给定 branch 的 upstream 做 diff（Codex 将运行的确切 `git merge-base`/`git diff` 指令见 prompt）。
- `{"type":"commit","sha":"abc1234","title":"Optional subject"}`：review 某个具体 commit。
- `{"type":"custom","instructions":"Free-form reviewer instructions"}`：fallback prompt，等价于 legacy manual review request。
- `delivery`（`"inline"` 或 `"detached"`，默认 `"inline"`）：review 在哪里运行：
  - `"inline"`：在既有 thread 上作为新 turn 运行 review。响应的 `reviewThreadId` 等于原始 `threadId`，不会发送新的 `thread/started` notification。
  - `"detached"`：从父对话 fork 一个新的 review thread，并在那里运行 review。响应的 `reviewThreadId` 是该新 review thread 的 id，server 会在流式发送 review items 之前为它发送 `thread/started` notification。

```json
{ "method": "review/start", "id": 40, "params": {
    "threadId": "thr_123",
    "delivery": "inline",
    "target": { "type": "commit", "sha": "1234567deadbeef", "title": "Polish tui colors" }
} }
{ "id": 40, "result": {
    "turn": {
        "id": "turn_900",
        "status": "inProgress",
        "items": [
            { "type": "userMessage", "id": "turn_900", "content": [ { "type": "text", "text": "Review commit 1234567: Polish tui colors" } ] }
        ],
        "error": null
    },
    "reviewThreadId": "thr_123"
} }
```

detached review 使用 `"delivery": "detached"`。响应结构相同，但 `reviewThreadId` 是新 review thread 的 id，不同于原始 `threadId`。server 还会在流式发送 review turn 之前为该新 thread 发送 `thread/started` notification。

Codex 会流式发送通常的 `turn/started` notification，随后发送带 `enteredReviewMode` item 的 `item/started`，客户端可用它展示进度：

```json
{
  "method": "item/started",
  "params": {
    "item": {
      "type": "enteredReviewMode",
      "id": "turn_900",
      "review": "current changes"
    }
  }
}
```

reviewer 完成后，server 会发送包含 `exitedReviewMode` item 的 `item/started` 和 `item/completed`，其中带最终 review 文本：

```json
{
  "method": "item/completed",
  "params": {
    "item": {
      "type": "exitedReviewMode",
      "id": "turn_900",
      "review": "Looks solid overall...\n\n- Prefer Stylize helpers — app.rs:10-20\n  ..."
    }
  }
}
```

`review` 字符串是 plain text，已经包含整体说明和每个 structured finding 的 bullet list（与生成 schema 中的 `ThreadItem::ExitedReviewMode` 匹配）。客户端应使用该 notification 渲染 reviewer 输出。

### 示例：一次性 command execution

在 server sandbox 中运行一个 standalone command（argv vector），不创建 thread 或 turn：

```json
{ "method": "command/exec", "id": 32, "params": {
    "command": ["ls", "-la"],
    "processId": "ls-1",                           // optional string; required for streaming and ability to terminate the process
    "cwd": "/Users/me/project",                    // optional; defaults to server cwd
    "env": { "FOO": "override" },                  // optional; merges into the server env and overrides matching names
    "size": { "rows": 40, "cols": 120 },           // optional; PTY size in character cells, only valid with tty=true
    "permissionProfile": ":workspace",             // optional profile id; defaults to user config
    "outputBytesCap": 1048576,                     // optional; per-stream capture cap
    "disableOutputCap": false,                     // optional; cannot be combined with outputBytesCap
    "timeoutMs": 10000,                            // optional; ms timeout; defaults to server timeout
    "disableTimeout": false                        // optional; cannot be combined with timeoutMs
} }
{ "id": 32, "result": {
    "exitCode": 0,
    "stdout": "...",
    "stderr": ""
} }
```

- 如果你想要一个明确的 unsandboxed process execution API，并且需要立即 spawn acknowledgement、基于 handle 的控制、output notifications 和 exit notification，优先使用 `process/spawn`。
- 对于已经由外部 sandbox 约束的客户端，把 legacy `sandboxPolicy` 设置为 `{"type":"externalSandbox","networkAccess":"enabled"}`（或省略 `networkAccess` 保持 restricted）。该模式下 Codex 不会执行自己的 sandbox；它会告诉模型自己拥有 full file-system access，并通过 `environment_context` 传递 `networkAccess` 状态。

注意：

- 空 `command` 数组会被拒绝。
- 命令权限覆盖优先使用 `permissionProfile`。它按 id 选择 active profile（例如 `:read-only`、`:workspace` 或用户定义的 `[permissions.<id>]` profile），而不是接受低层文件系统/网络权限。legacy `sandboxPolicy` 字段接受与 `turn/start` 相同的 shape（例如 `dangerFullAccess`、`readOnly`、带 flags 的 `workspaceWrite`、带 `networkAccess` `restricted|enabled` 的 `externalSandbox`），但不能与 `permissionProfile` 同时使用。
- `env` 会合并到 server shell environment policy 产生的环境中。同名变量会被覆盖；未指定变量保持原样。
- 省略 `timeoutMs` 时使用 server 默认 timeout。
- 省略 `outputBytesCap` 时，每个 stream 使用 server 默认 1 MiB cap。
- `disableOutputCap: true` 会禁用该 `command/exec` 请求的 stdout/stderr capture truncation，不能与 `outputBytesCap` 同时使用。
- `disableTimeout: true` 会完全禁用该 `command/exec` 请求的 timeout，不能与 `timeoutMs` 同时使用。
- `processId` 对 buffered execution 是可选的。省略时 Codex 会生成内部 id 用于 lifecycle tracking，但 `tty`、`streamStdin` 和 `streamStdoutStderr` 必须保持 disabled，且无法对该命令进行后续 `command/exec/write` / `command/exec/terminate`。
- `size` 仅在 `tty: true` 时合法。它设置初始 PTY 字符单元大小。
- Buffered Windows sandbox execution 接受 `processId` 用于关联，但这些请求仍不支持 `command/exec/write` 和 `command/exec/terminate`。
- Buffered Windows sandbox execution 也要求默认 output cap；不支持自定义 `outputBytesCap` 和 `disableOutputCap`。
- `tty`、`streamStdin` 和 `streamStdoutStderr` 是可选 booleans。省略它们的 legacy requests 会继续使用 buffered execution。
- `tty: true` 隐含 PTY mode、`streamStdin: true` 和 `streamStdoutStderr: true`。
- `tty` 和 `streamStdin` 本身不会禁用 timeout；省略 `timeoutMs` 使用 server 默认 timeout，或设置 `disableTimeout: true` 让进程存活直到退出或显式终止。
- `outputBytesCap` 分别应用于 `stdout` 和 `stderr`，streamed bytes 不会重复放入最终响应。
- `command/exec` 响应会延迟到进程退出后发送，并且只会在该连接上的所有 `command/exec/outputDelta` notifications 发出后发送。
- `command/exec/outputDelta` notifications 是 connection-scoped。如果源连接关闭，server 会终止该进程。

Streaming stdin/stdout 使用 base64，因此 PTY sessions 可以承载任意 bytes：

```json
{ "method": "command/exec", "id": 33, "params": {
    "command": ["bash", "-i"],
    "processId": "bash-1",
    "tty": true,
    "outputBytesCap": 32768
} }
{ "method": "command/exec/outputDelta", "params": {
    "processId": "bash-1",
    "stream": "stdout",
    "deltaBase64": "YmFzaC00LjQkIA==",
    "capReached": false
} }
{ "method": "command/exec/write", "id": 34, "params": {
    "processId": "bash-1",
    "deltaBase64": "cHdkCg=="
} }
{ "id": 34, "result": {} }
{ "method": "command/exec/write", "id": 35, "params": {
    "processId": "bash-1",
    "closeStdin": true
} }
{ "id": 35, "result": {} }
{ "method": "command/exec/resize", "id": 36, "params": {
    "processId": "bash-1",
    "size": { "rows": 48, "cols": 160 }
} }
{ "id": 36, "result": {} }
{ "method": "command/exec/terminate", "id": 37, "params": {
    "processId": "bash-1"
} }
{ "id": 37, "result": {} }
{ "id": 33, "result": {
    "exitCode": 137,
    "stdout": "",
    "stderr": ""
} }
```

- `command/exec/write` 接受 `deltaBase64`、`closeStdin` 或二者同时存在。
- 客户端可在 `command/exec` 中提供 connection-scoped string `processId`；`command/exec/write`、`command/exec/resize` 和 `command/exec/terminate` 只接受这些客户端提供的 string ids。
- `command/exec/outputDelta.processId` 始终是原始 `command/exec` 请求中客户端提供的 string id。
- `command/exec/outputDelta.stream` 是 `stdout` 或 `stderr`。PTY mode 会把 terminal output 复用到 `stdout`。
- 当 `outputBytesCap` 截断某个 stream 时，`command/exec/outputDelta.capReached` 会在该 stream 的最后一个 streamed chunk 上为 `true`；该 stream 的后续输出会被丢弃。
- `command/exec.params.env` 会按 key 覆盖 server 计算出的 environment；将某个 key 设为 `null` 可取消继承变量。
- `command/exec/resize` 仅支持 PTY-backed `command/exec` sessions。

### 示例：Process lifecycle execution

使用 `process/spawn` 在 app server 所在主机上启动一个基于 argv 的 standalone process，不使用 Codex sandbox。`process/*` API 是实验性的，需要 `initialize.params.capabilities.experimentalApi: true`。spawn response 表示进程已经启动并且 `processHandle` 已注册；完成状态稍后通过 `process/exited` 报告。

```json
{ "method": "process/spawn", "id": 40, "params": {
    "command": ["cargo", "check"],
    "processHandle": "cargo-check-1",
    "cwd": "/Users/me/project",                    // required absolute path
    "env": { "RUST_LOG": null },                    // optional; override or unset app-server env vars
    "outputBytesCap": 1048576,                     // optional; omit for default, null disables
    "timeoutMs": 10000                             // optional; omit for default, null disables
} }
{ "id": 40, "result": {} }
{ "method": "process/exited", "params": {
    "processHandle": "cargo-check-1",
    "exitCode": 0,
    "stdout": "...",
    "stdoutCapReached": false,
    "stderr": "",
    "stderrCapReached": false
} }
```

对于交互式或 streaming processes，设置 `tty: true` 或 `streamStdoutStderr: true`，并按 `processHandle` 路由 output notifications：

```json
{ "method": "process/spawn", "id": 41, "params": {
    "command": ["bash", "-i"],
    "processHandle": "bash-1",
    "cwd": "/Users/me/project",
    "tty": true,
    "size": { "rows": 40, "cols": 120 },
    "outputBytesCap": null,
    "timeoutMs": null
} }
{ "id": 41, "result": {} }
{ "method": "process/outputDelta", "params": {
    "processHandle": "bash-1",
    "stream": "stdout",
    "deltaBase64": "YmFzaC00LjQkIA==",
    "capReached": false
} }
{ "method": "process/writeStdin", "id": 42, "params": {
    "processHandle": "bash-1",
    "deltaBase64": "cHdkCg=="
} }
{ "id": 42, "result": {} }
{ "method": "process/resizePty", "id": 43, "params": {
    "processHandle": "bash-1",
    "size": { "rows": 48, "cols": 160 }
} }
{ "id": 43, "result": {} }
{ "method": "process/kill", "id": 44, "params": {
    "processHandle": "bash-1"
} }
{ "id": 44, "result": {} }
{ "method": "process/exited", "params": {
    "processHandle": "bash-1",
    "exitCode": 137,
    "stdout": "",
    "stdoutCapReached": false,
    "stderr": "",
    "stderrCapReached": false
} }
```

- 空 `command` 数组和空 `processHandle` 字符串会被拒绝。
- `cwd` 必须提供，并且必须是绝对路径。
- `process/spawn` 有意设计为 unsandboxed，不定义 `sandboxPolicy` 或 `permissionProfile` 等 sandbox-selection 字段。
- 同一连接上重复的 active `processHandle` 值会被拒绝；先前进程退出后同一 handle 可重用。
- `tty: true` 隐含 PTY mode、`streamStdin: true` 和 `streamStdoutStderr: true`。
- `process/writeStdin` 接受 `deltaBase64`、`closeStdin` 或二者同时存在。
- 省略 `timeoutMs` 和 `outputBytesCap` 时使用 server defaults。将任一字段设为 `null` 可为 terminal-style sessions 禁用该限制。
- `outputBytesCap` 分别应用于 `stdout` 和 `stderr`；`process/exited.stdoutCapReached` 和 `stderrCapReached` 报告每个 stream 是否达到 cap。streamed bytes 不会重复放入 `process/exited`。
- `process/outputDelta` 和 `process/exited` notifications 是 connection-scoped。如果源连接关闭，server 会终止该进程。

### 示例：Filesystem utilities

这些方法操作 host filesystem 上的绝对路径，覆盖读取、写入、目录遍历、复制、删除和变更 notifications。

本节所有 filesystem paths 都必须是绝对路径。

```json
{ "method": "fs/createDirectory", "id": 40, "params": {
    "path": "/tmp/example/nested",
    "recursive": true
} }
{ "id": 40, "result": {} }
{ "method": "fs/writeFile", "id": 41, "params": {
    "path": "/tmp/example/nested/note.txt",
    "dataBase64": "aGVsbG8="
} }
{ "id": 41, "result": {} }
{ "method": "fs/getMetadata", "id": 42, "params": {
    "path": "/tmp/example/nested/note.txt"
} }
{ "id": 42, "result": {
    "isDirectory": false,
    "isFile": true,
    "isSymlink": false,
    "createdAtMs": 1730910000000,
    "modifiedAtMs": 1730910000000
} }
{ "method": "fs/readFile", "id": 43, "params": {
    "path": "/tmp/example/nested/note.txt"
} }
{ "id": 43, "result": {
    "dataBase64": "aGVsbG8="
} }
```

- `fs/getMetadata` 返回路径是否解析为目录或普通文件、路径本身是否为 symlink，以及 Unix 毫秒形式的 `createdAtMs` 和 `modifiedAtMs`。若当前平台无法获取某个 timestamp，该字段为 `0`。
- `fs/createDirectory` 省略 `recursive` 时默认 `true`。
- `fs/remove` 省略 `recursive` 和 `force` 时二者默认 `true`。
- `fs/readFile` 始终通过 `dataBase64` 返回 base64 bytes，`fs/writeFile` 始终期望 `dataBase64` 中包含 base64 bytes。
- `fs/copy` 同时处理文件复制和目录树复制；当 `sourcePath` 是目录时要求 `recursive: true`。递归复制会遍历普通文件、目录和 symlinks；其他 entry types 会被跳过。

### 示例：Filesystem watch

`fs/watch` 接受绝对文件或目录路径。watch 文件时，会为该文件路径发送 `fs/changed`，包括通过 replace 或 rename 操作产生的 updates。

```json
{ "method": "fs/watch", "id": 44, "params": {
    "watchId": "0195ec6b-1d6f-7c2e-8c7a-56f2c4a8b9d1",
    "path": "/Users/me/project/.git/HEAD"
} }
{ "id": 44, "result": {
    "path": "/Users/me/project/.git/HEAD"
} }
{ "method": "fs/changed", "params": {
    "watchId": "0195ec6b-1d6f-7c2e-8c7a-56f2c4a8b9d1",
    "changedPaths": ["/Users/me/project/.git/HEAD"]
} }
{ "method": "fs/unwatch", "id": 45, "params": {
    "watchId": "0195ec6b-1d6f-7c2e-8c7a-56f2c4a8b9d1"
} }
{ "id": 45, "result": {} }
```

## 事件

Event notifications 是由 server 主动发起的事件流，用于 thread lifecycles、turn lifecycles 以及其中的 items。启动或恢复 thread 后，持续读取 stdout 中的 `thread/started`、`thread/archived`、`thread/unarchived`、`thread/closed`、`turn/*` 和 `item/*` notifications。

Thread realtime 使用独立的 thread-scoped notification surface。`thread/realtime/*` notifications 是临时 transport events，不是 `ThreadItem`，也不会由 `thread/read`、`thread/resume` 或 `thread/fork` 返回。

可恢复的配置和初始化 warnings 使用既有 `configWarning` notification：`{ summary, details?, path?, range? }`。app-server 可能在 initialization 期间因 config parsing 和相关 setup diagnostics 发出它。

通用 runtime warnings 使用 `warning` notification：`{ threadId?, message }`。app-server 会为 core event stream 中的非致命 warnings 发出它，包括并非所有启用 skills 都被包含进 session 的 model-visible skills list 的情况。

### Notification opt-out

客户端可以通过在 `initialize.params.capabilities.optOutNotificationMethods` 中发送精确 method names，按连接抑制特定 notifications。

- 仅精确匹配：`item/agentMessage/delta` 只抑制该方法。
- 未知 method names 会被忽略。
- 适用于 app-server typed notifications，例如 `thread/*`、`turn/*`、`item/*` 和 `rawResponseItem/*`。
- 不适用于 requests/responses/errors。

示例：

- 关闭 thread lifecycle notifications：`thread/started`
- 关闭 streamed agent text deltas：`item/agentMessage/delta`

### Fuzzy file search events（实验性）

fuzzy file search session API 为每个 query 发送 notifications：

- `fuzzyFileSearch/sessionUpdated`：`{ sessionId, query, files }`，包含 active query 的当前 matching files。
- `fuzzyFileSearch/sessionCompleted`：`{ sessionId, query }`，当该 query 的 indexing/matching 完成时发送。

### Thread realtime events（实验性）

thread realtime API 为 session lifecycle 和 streaming media 发送 thread-scoped notifications：

- `thread/realtime/started`：`{ threadId, realtimeSessionId }`，thread 的 realtime 启动后发送。`realtimeSessionId` 是上游 Realtime API session identifier，不是 Codex session/thread-group id。
- `thread/realtime/itemAdded`：`{ threadId, item }`，用于没有专用 typed app-server notification 的 raw non-audio realtime items，包括 `handoff_request`。在上游 websocket item schema 仍不稳定时，`item` 作为 raw JSON 转发。
- `thread/realtime/transcript/delta`：`{ threadId, role, delta }`，live realtime transcript deltas。
- `thread/realtime/transcript/done`：`{ threadId, role, text }`，realtime 为 transcript part 发出最终 full text 时发送。
- `thread/realtime/outputAudio/delta`：`{ threadId, audio }`，streamed output audio chunks。`audio` 使用 camelCase fields（`data`、`sampleRate`、`numChannels`、`samplesPerChannel`）。
- `thread/realtime/error`：`{ threadId, message }`，realtime 遇到 transport 或 backend error 时发送。
- `thread/realtime/closed`：`{ threadId, reason }`，realtime transport 关闭时发送。

由于 audio 有意与 `ThreadItem` 分离，客户端可以用 `optOutNotificationMethods` 单独关闭 `thread/realtime/outputAudio/delta`。

### Windows sandbox setup events

- `windowsSandbox/setupCompleted`：`windowsSandbox/setupStart` 请求完成后发送 `{ mode, success, error }`。

### MCP server startup events

- `mcpServer/startupStatus/updated`：当 app-server 观察到 MCP server startup transition 时发送 `{ threadId, name, status, error }`。当 startup 是 thread-scoped 时，`threadId` 标识 owning thread；当 startup 是 app-scoped 时为 `null`。`status` 是 `starting`、`ready`、`failed` 或 `cancelled`。除 `failed` 外，`error` 为 `null`。

### Turn events

turn 运行时，app-server 会流式发送 JSON-RPC notifications。每个 turn 开始运行时发送 `turn/started`，结束时发送 `turn/completed`（最终 `turn` status）。Token usage events 通过 `thread/tokenUsage/updated` 单独流式发送。客户端订阅自己关心的事件，并在 updates 到达时增量渲染每个 item。每个 item 的生命周期始终是：`item/started` → 零个或多个 item-specific deltas → `item/completed`。

- `turn/started`：`{ turn }`，包含 turn id、空 `items` 和 `status: "inProgress"`。
- `turn/completed`：`{ turn }`，其中 `turn.status` 是 `completed`、`interrupted` 或 `failed`；失败时携带 `{ error: { message, codexErrorInfo?, additionalDetails? } }`。
- `turn/diff/updated`：`{ threadId, turnId, diff }`，表示 turn-level unified diff 的最新 snapshot，在每个 FileChange item 后发出。`diff` 是该 turn 内所有文件变更的最新聚合 unified diff。UI 可以渲染它展示完整的 "what changed" 视图，而无需拼接单个 `fileChange` items。
- `turn/plan/updated`：`{ turnId, explanation?, plan }`，agent 分享或修改 plan 时发送；每个 `plan` entry 是 `{ step, status }`，`status` 为 `pending`、`inProgress` 或 `completed`。
- `model/rerouted`：`{ threadId, turnId, fromModel, toModel, reason }`，backend 将请求 reroute 到不同 model 时发送，例如因 high-risk cyber safety checks。
- `model/verification`：`{ threadId, turnId, verifications }`，backend 标记需要额外 account verification 时发送，例如 `trustedAccessForCyber`。
- `turn/moderationMetadata`：实验性；first-party backend 提供用于客户端展示的 turn-scoped moderation metadata 时发送 `{ threadId, turnId, metadata }`。

当前即使已经流式发送 item events，这两个 notifications 中也会携带空 `items` 数组；在修复前，请以 `item/*` notifications 作为 canonical item list。

#### Items

`ThreadItem` 是 turn responses 和 `item/*` notifications 中携带的 tagged union。当前支持以下 items 的事件：

- `userMessage`：`{id, clientId, content}`，其中 `clientId` 是提供给 `turn/start` 或 `turn/steer` 的可选 `clientUserMessageId`，`content` 是 user inputs 列表（`text`、`image` 或 `localImage`）。
- `agentMessage`：`{id, text}`，包含累积的 agent reply。
- `plan`：`{id, text}`，为 plan-mode turns 发出；plan text 可通过 `item/plan/delta` 流式发送（实验性）。
- `reasoning`：`{id, summary, content}`，其中 `summary` 存放 streamed reasoning summaries（适用于多数 OpenAI models），`content` 存放 raw reasoning blocks（例如适用于 open source models）。
- `commandExecution`：`{id, command, cwd, status, commandActions, aggregatedOutput?, exitCode?, durationMs?}`，用于 sandboxed commands；`status` 是 `inProgress`、`completed`、`failed` 或 `declined`。
- `fileChange`：`{id, changes, status}`，描述 proposed edits；`changes` 是 `{path, kind, diff}` 列表，`status` 是 `inProgress`、`completed`、`failed` 或 `declined`。
- `mcpToolCall`：`{id, server, tool, status, arguments, mcpAppResourceUri?, pluginId, result?, error?}`，描述 MCP calls；`status` 是 `inProgress`、`completed` 或 `failed`。
- `collabToolCall`：`{id, tool, status, senderThreadId, receiverThreadId?, newThreadId?, prompt?, agentStatus?}`，描述 collab tool calls（`spawn_agent`、`send_input`、`resume_agent`、`wait`、`close_agent`）；`status` 是 `inProgress`、`completed` 或 `failed`。
- `webSearch`：`{id, query, action?}`，表示 agent 发起的 web search request；`action` 映射 Responses API web_search action payload（`search`、`open_page`、`find_in_page`），完成前可省略。
- `imageView`：`{id, path}`，agent 调用 image viewer tool 时发出。
- `enteredReviewMode`：`{id, review}`，reviewer 开始时发送；`review` 是用户可见的短标签，例如 `"current changes"` 或请求的 target 描述。
- `exitedReviewMode`：`{id, review}`，reviewer 完成时发送；`review` 是完整 plain-text review（通常是整体说明加 bullet point findings）。
- `contextCompaction`：`{id}`，Codex 压缩 conversation history 时发送。这可能自动发生。
- `compacted`：`{threadId, turnId}`，Codex 压缩 conversation history 时发送。这可能自动发生。**Deprecated:** 改用 `contextCompaction`。

所有 items 都会发出共享 lifecycle events：

- `item/started`：新工作单元开始时发送完整 `item`，UI 可立即渲染；payload 中的 `item.id` 与 deltas 使用的 `itemId` 匹配。
- `item/completed`：工作本身完成后发送最终 `item`（例如 tool call 或 message 完成后）；将其视为 authoritative execution/result state。
- `item/autoApprovalReview/started`：[UNSTABLE] 临时 auto-review notification，approval auto-review 开始时携带 `{threadId, turnId, targetItemId, review, action}`。该 shape 预计很快改变。
- `item/autoApprovalReview/completed`：[UNSTABLE] 临时 auto-review notification，approval auto-review resolved 时携带 `{threadId, turnId, targetItemId, review, action}`。该 shape 预计很快改变。

`review` 是 [UNSTABLE]，当前为 `{status, riskLevel?, userAuthorization?, rationale?}`，其中 `status` 是 `inProgress`、`approved`、`denied` 或 `aborted`。`riskLevel` 存在时是 `"low"`、`"medium"`、`"high"` 或 `"critical"`。`userAuthorization` 存在时是 `"unknown"`、`"low"`、`"medium"` 或 `"high"`。`action` 是带 `type: "command" | "execve" | "applyPatch" | "networkAccess" | "mcpToolCall"` 的 tagged union。command-like actions 包含 `source` discriminator（`"shell"` 或 `"unifiedExec"`）。这些 notifications 与目标 item 自身的 `item/completed` lifecycle 分离，并且在 auto-review app protocol 仍在设计期间有意保持临时状态。

还有额外的 item-specific events：

#### agentMessage

- `item/agentMessage/delta`：追加 agent message 的 streamed text；按顺序拼接同一 `itemId` 的 `delta` 值即可重建完整回复。

#### plan

- `item/plan/delta`：为 plan items 流式发送 proposed plan content（实验性）；拼接同一 plan `itemId` 的 `delta` 值。这些 deltas 对应 `<proposed_plan>` block。

#### reasoning

- `item/reasoning/summaryTextDelta`：流式发送可读 reasoning summaries；打开新 summary section 时 `summaryIndex` 递增。
- `item/reasoning/summaryPartAdded`：标记某个 `itemId` 的 reasoning summary sections 边界；后续 `summaryTextDelta` entries 共享同一个 `summaryIndex`。
- `item/reasoning/textDelta`：流式发送 raw reasoning text（仅适用于例如 open source models）；在 UI 展示前使用 `contentIndex` 对属于同一组的 deltas 分组。

#### commandExecution

- `item/commandExecution/outputDelta`：流式发送 command 的 stdout/stderr；按顺序追加 deltas，在 final item 的 `aggregatedOutput` 旁渲染 live output。最终 `commandExecution` items 包含 parsed `commandActions`、`status`、`exitCode` 和 `durationMs`，便于 UI 总结运行内容及是否成功。

#### fileChange

- `item/fileChange/patchUpdated`：启用 `features.apply_patch_streaming_events` 时，在执行前流式发送从模型生成 patch 解析出的 structured file-change snapshots。
- `item/fileChange/outputDelta`：deprecated legacy protocol entry，用于 `apply_patch` text output；保留兼容性，但 server 已不再发送。

### Errors

server 在 turn 中途遇到错误时会发送 `error` event，例如 upstream model errors 或 quota limits。payload 与 `turn.status: "failed"` 相同：`{ error: { message, codexErrorInfo?, additionalDetails? } }`，并且可能先于该 terminal notification 出现。

`codexErrorInfo` 映射到 `CodexErrorInfo` enum。常见值：

- `ContextWindowExceeded`
- `UsageLimitExceeded`
- `HttpConnectionFailed { httpStatusCode? }`：上游 HTTP failures，包括 4xx/5xx
- `ResponseStreamConnectionFailed { httpStatusCode? }`：连接 response SSE stream 失败
- `ResponseStreamDisconnected { httpStatusCode? }`：turn 完成前 response SSE stream 中途断开
- `ResponseTooManyFailedAttempts { httpStatusCode? }`
- `ActiveTurnNotSteerable { turnKind }`：当前 active turn 不可 steer 时提交了 `turn/start` 或 `turn/steer`，例如 `/review` 或 manual `/compact`
- `BadRequest`
- `Unauthorized`
- `SandboxError`
- `InternalServerError`
- `Other`：所有未分类错误

当可获得 upstream HTTP status（例如来自 Responses API 或 provider）时，它会通过相关 `codexErrorInfo` variant 中的 `httpStatusCode` 转发。

## 审批

某些动作（shell commands 或修改文件）可能根据用户配置需要显式用户审批。使用 `turn/start` 时，app-server 会通过向客户端发送 server-initiated JSON-RPC request 来驱动 approval flow。客户端必须响应，告诉 Codex 是否继续。UI 应将这些 requests 与 active turn 一起内联展示，让用户在选择前 review proposed command 或 diff。

- Requests 包含 `threadId` 和 `turnId`，用它们将 UI state 限定到 active conversation。
- 响应单个 `{ "decision": ... }` payload。Command approvals 支持 `accept`、`acceptForSession`、`acceptWithExecpolicyAmendment`、`applyNetworkPolicyAmendment`、`decline` 或 `cancel`。server 会恢复或拒绝该工作，并用 `item/completed` 结束 item。

### Command execution approvals

消息顺序：

1. `item/started`：展示 pending `commandExecution` item，带 `command`、`cwd` 和其他字段，客户端可渲染 proposed action。
2. `item/commandExecution/requestApproval`（request）：携带相同 `itemId`、`threadId`、`turnId`、可选 `approvalId`（用于 subcommand callbacks）和 `reason`。普通 command approvals 还包含 `command`、`cwd` 和 `commandActions`，便于友好展示。当 `initialize.params.capabilities.experimentalApi = true` 时，还可能包含实验性 `additionalPermissions`，描述 requested per-command sandbox access；payload 中所有 filesystem paths 在线上都是绝对路径，network access 表示为 `additionalPermissions.network.enabled`。对于 network-only approvals，这些 command 字段可能省略，而改为提供 `networkApprovalContext`。还可能通过 `proposedExecpolicyAmendment` 和 `proposedNetworkPolicyAmendments` 包含可选 persistence hints。客户端可在 `availableDecisions` 存在时优先使用它渲染 server 想暴露的精确 choices，同时在省略时回退到旧 heuristics。
3. 客户端响应：例如 `{ "decision": "accept" }`、`{ "decision": "acceptForSession" }`、`{ "decision": { "acceptWithExecpolicyAmendment": { "execpolicy_amendment": [...] } } }`、`{ "decision": { "applyNetworkPolicyAmendment": { "network_policy_amendment": { "host": "example.com", "action": "allow" } } } }`、`{ "decision": "decline" }` 或 `{ "decision": "cancel" }`。
4. `serverRequest/resolved`：`{ threadId, requestId }`，确认 pending request 已 resolved 或 cleared，包括 turn start/complete/interrupt 时的 lifecycle cleanup。
5. `item/completed`：最终 `commandExecution` item，带 `status: "completed" | "failed" | "declined"` 和 execution output。将其渲染为 authoritative result。

### File change approvals

消息顺序：

1. `item/started`：发送 `fileChange` item，带 `changes`（diff chunk summaries）和 `status: "inProgress"`。向用户展示 proposed edits 和 paths。
2. `item/fileChange/requestApproval`（request）：包含 `itemId`、`threadId`、`turnId`、可选 `reason`，并且当 agent 请求对某个 root 下的 session-scoped write access 时，可能包含 unstable `grantRoot`。
3. 客户端响应：`{ "decision": "accept" }`、`{ "decision": "acceptForSession" }`、`{ "decision": "decline" }` 或 `{ "decision": "cancel" }`。
4. `serverRequest/resolved`：`{ threadId, requestId }`，确认 pending request 已 resolved 或 cleared，包括 turn start/complete/interrupt 时的 lifecycle cleanup。
5. `item/completed`：patch attempt 后返回同一个 `fileChange` item，`status` 更新为 `completed`、`failed` 或 `declined`。依赖它展示成功/失败，并在 UI 中 finalize diff state。

IDE UI 指引：request 到达后立刻展示 approval dialog。server 收到 approval request 响应后，turn 会继续。terminal `item/completed` notification 会带对应 status 发出。

### request_user_input

当客户端响应 `item/tool/requestUserInput` 时，server 会发送 `serverRequest/resolved`，内容为 `{ threadId, requestId }`。如果 pending request 在客户端回答前因 turn start、turn completion 或 turn interruption 被清除，server 也会为该 cleanup 发送同样 notification。

### Attestation generation

提供 upstream attestation 的 desktop hosts 应在 `initialize` 时设置 `capabilities.requestAttestation`，并处理 server-initiated `attestation/generate` request。app-server 会在转发 `x-oai-attestation` 的 ChatGPT Codex requests 之前 just in time 发出它；客户端响应 `{ "token": "v1.<opaque>" }`，其中 `token` 是客户端拥有的不透明值。app-server 收到客户端响应后，会转发一致的 outer envelope，例如 `{ "v": 1, "s": 0, "t": "v1.<opaque>" }`，其中 `t` 原样包含客户端 token。如果 app-server 尝试 attestation 但在自身边界内失败，它会发送相同 envelope shape，但带 app-server status code 且没有 `t`（`1 = timeout`、`2 = request failed`、`3 = request canceled`、`4 = malformed response`）。如果没有 initialized client opt into attestation，app-server 会在该 upstream request 中省略 `x-oai-attestation`。

### MCP server elicitations

MCP servers 可以中断 turn，并通过 `mcpServer/elicitation/request` 请求客户端提供结构化输入。

消息顺序：

1. `mcpServer/elicitation/request`（request）：包含 `threadId`、nullable `turnId`、`serverName`，以及：
   - form request：`{ "mode": "form", "message": "...", "requestedSchema": { ... } }`
   - URL request：`{ "mode": "url", "message": "...", "url": "...", "elicitationId": "..." }`
2. 客户端响应：`{ "action": "accept", "content": ... }`、`{ "action": "decline", "content": null }` 或 `{ "action": "cancel", "content": null }`。
3. `serverRequest/resolved`：`{ threadId, requestId }`，确认 pending request 已 resolved 或 cleared，包括 turn start/complete/interrupt 时的 lifecycle cleanup。

`turnId` 是 best-effort。当 elicitation 与 active turn 相关联时，请求会包含该 turn id；否则为 `null`。

对于 MCP tool approval elicitations，form request `meta` 包含 `codex_approval_kind: "mcp_tool_call"`，并且可能包含 `persist: "session"`、`persist: "always"` 或 `persist: ["session", "always"]`，用于告知客户端是否可以提供 session-scoped 和/或 persistent approval choices。

### Permission requests

内置 `request_permissions` tool 会向客户端发送 `item/permissions/requestApproval` JSON-RPC request，携带请求的 permission profile。该 v2 payload 映射 command-execution `additionalPermissions` shape：它可以请求 network access 和 additional filesystem access。`environmentId` 和 `cwd` 字段标识用于解析 project-root permissions 和 relative deny globs 的 environment 与目录。

```json
{
  "method": "item/permissions/requestApproval",
  "id": 61,
  "params": {
    "threadId": "thr_123",
    "turnId": "turn_123",
    "itemId": "call_123",
    "environmentId": "local",
    "cwd": "/Users/me/project",
    "reason": "Select a workspace root",
    "permissions": {
      "fileSystem": {
        "write": ["/Users/me/project", "/Users/me/shared"]
      }
    }
  }
}
```

客户端响应 `result.permissions`，它应是请求 permission profile 的已授权子集。也可将 `result.scope` 设置为 `"session"`，让 grant 在同一 session 后续 turns 中持久存在；省略或 `"turn"` 保持既有 turn-scoped 行为：

```json
{
  "id": 61,
  "result": {
    "scope": "session",
    "permissions": {
      "fileSystem": {
        "write": ["/Users/me/project"]
      }
    }
  }
}
```

线上只有 granted subset 重要。`result.permissions` 中省略的任何 permissions 都视为 denied。原始 request 中不存在的 permissions 会被 server 忽略。

同一 turn 内，granted permissions 是 sticky 的：后续 shell-like tool calls 可以自动复用 granted subset，而不再发出单独 permission request。

如果 session approval policy 使用 `Granular` 且 `request_permissions: false`，standalone `request_permissions` tool calls 会被 auto-denied，且不会发送 `item/permissions/requestApproval` prompt。Inline `with_additional_permissions` command requests 仍由 `sandbox_approval` 控制，先前 granted permissions 在同一 turn 后续 shell-like calls 中仍保持 sticky。

### Dynamic tool calls（实验性）

`thread/start` 上的 `dynamicTools` 以及对应的 `item/tool/call` request/response flow 是实验性 API。要启用它们，设置 `initialize.params.capabilities.experimentalApi = true`。

Dynamic tool identifiers 遵循 Responses function tools 的相同约束：

- `name` 必须匹配 `^[a-zA-Z0-9_-]+$`，长度 1 到 128 字符。
- `namespace` 存在时必须匹配 `^[a-zA-Z0-9_-]+$`，长度 1 到 64 字符。
- `namespace` 不得与保留的 Responses runtime namespaces 冲突，例如 `functions`、`multi_tool_use`、`file_search`、`web`、`browser`、`image_gen`、`computer`、`container`、`terminal`、`python`、`python_user_visible`、`api_tool`、`tool_search` 或 `submodel_delegator`。

每个 dynamic tool 可设置 `deferLoading`。省略时默认 `false`。设为 `true` 会保持该工具已注册且可由 `code_mode` 等 runtime features 调用，但把它从普通 turns 发送给模型的 model-facing tool list 中排除。当 `tool_search` 可用时，deferred dynamic tools 可被搜索，并由匹配搜索结果暴露。

dynamic tool 在 turn 中被调用时，server 会向客户端发送 `item/tool/call` JSON-RPC request：

```json
{
  "method": "item/tool/call",
  "id": 60,
  "params": {
    "threadId": "thr_123",
    "turnId": "turn_123",
    "callId": "call_123",
    "tool": "lookup_ticket",
    "arguments": { "id": "ABC-123" }
  }
}
```

server 还会在 request 周围发送 item lifecycle notifications：

1. `item/started`，其中 `item.type = "dynamicToolCall"`、`status = "inProgress"`，并包含 `tool` 和 `arguments`。
2. `item/tool/call` request。
3. 客户端响应。
4. `item/completed`，其中 `item.type = "dynamicToolCall"`、最终 `status`，以及返回的 `contentItems`/`success`。

客户端必须以 content items 响应。文本使用 `inputText`，图片 URL/data URLs 使用 `inputImage`：

```json
{
  "id": 60,
  "result": {
    "contentItems": [
      { "type": "inputText", "text": "Ticket ABC-123 is open." },
      { "type": "inputImage", "imageUrl": "data:image/png;base64,AAA" }
    ],
    "success": true
  }
}
```

## Skills

通过在 text input 中包含 `$<skill-name>` 来调用 skill。推荐同时添加一个 `skill` input item，这样 backend 会注入完整 skill instructions，而不是依赖模型解析名称。

```json
{
  "method": "turn/start",
  "id": 101,
  "params": {
    "threadId": "thread-1",
    "input": [
      {
        "type": "text",
        "text": "$skill-creator Add a new skill for triaging flaky CI."
      },
      {
        "type": "skill",
        "name": "skill-creator",
        "path": "/Users/me/.codex/skills/skill-creator/SKILL.md"
      }
    ]
  }
}
```

如果省略 `skill` item，模型仍会解析 `$<skill-name>` marker 并尝试定位 skill，但这可能增加延迟。

```text
$skill-creator Add a new skill for triaging flaky CI and include step-by-step usage.
```

使用 `skills/list` 获取可用 skills，可选按 `cwds` 限定，并可指定 `forceReload`。`skills/list` 可能复用每个 `cwd` 的 cached skills result；将 `forceReload` 设为 `true` 会从磁盘刷新结果。server 还会在 watched local skill files 变化时发送 `skills/changed` notifications。将其视为 invalidation signal，并在需要时用当前 params 重新运行 `skills/list`。使用 `skills/extraRoots/set` 可替换当前 app-server 进程的 additional standalone skill roots。这些 roots 使用与其他 standalone skill roots 相同的布局：每个 root 包含 skill directories，每个 skill directory 包含 `SKILL.md`。缺失 roots 会被接受，并在存在前加载不到 skills。该设置会在 app-server 退出时丢失。

```json
{ "method": "skills/list", "id": 25, "params": {
    "cwds": ["/Users/me/project", "/Users/me/other-project"],
    "forceReload": true
} }
{ "id": 25, "result": {
    "data": [{
        "cwd": "/Users/me/project",
        "skills": [
            {
              "name": "skill-creator",
              "description": "Create or update a Codex skill",
              "enabled": true,
              "interface": {
                "displayName": "Skill Creator",
                "shortDescription": "Create or update a Codex skill",
                "iconSmall": "icon.svg",
                "iconLarge": "icon-large.svg",
                "brandColor": "#111111",
                "defaultPrompt": "Add a new skill for triaging flaky CI."
              }
            }
        ],
        "errors": []
    }]
} }
```

```json
{
  "method": "skills/changed",
  "params": {}
}
```

```json
{
  "method": "skills/extraRoots/set",
  "id": 26,
  "params": {
    "extraRoots": ["/Users/me/generated-skills"]
  }
}
{ "id": 26, "result": {} }
```

按绝对路径启用或禁用 skill：

```json
{
  "method": "skills/config/write",
  "id": 27,
  "params": {
    "path": "/Users/alice/.codex/skills/skill-creator/SKILL.md",
    "name": null,
    "enabled": false
  }
}
```

按名称启用或禁用 skill：

```json
{
  "method": "skills/config/write",
  "id": 28,
  "params": {
    "path": null,
    "name": "github:yeet",
    "enabled": false
  }
}
```

使用 `hooks/list` 为一个或多个 `cwds` 获取 discovered hooks。每个结果都会使用对应 `cwd` 的 effective config 进行评估，因此 feature gates 和 discovered config layers 可在同一响应内不同。

对于 linked Git worktrees，project hook declarations 来自 root checkout 中匹配的 `.codex/` folders，而不是只存储在 linked worktree 中的 divergent hook declarations。这样每个 repo 会有一个权威 project-hook definition 和一个 trust state。

hooks 即使 disabled 也会返回，以便客户端渲染并重新启用。用户控制的状态位于 `hooks.state` 下。Managed hooks 不可配置，加载时会忽略 managed hook keys 的 user entries。

对于 unmanaged hooks，`currentHash` 和 `trustStatus` 描述当前 definition 是 first-seen、approved，还是 approval 后发生变化。只有 trusted unmanaged hooks 会变为 runnable。Hook keys 将 source identity 与尾部 event/group/handler selector 组合起来；该 selector 当前是 positional。

```json
{
  "method": "hooks/list",
  "id": 28,
  "params": {
    "cwds": ["/Users/me/project"]
  }
}
```

```json
{
  "id": 28,
  "result": {
    "data": [{
      "cwd": "/Users/me/project",
      "hooks": [{
        "key": "/Users/me/.codex/config.toml:pre_tool_use:0:0",
        "eventName": "pre_tool_use",
        "handlerType": "command",
        "isManaged": false,
        "matcher": "Bash",
        "command": "python3 /Users/me/hook.py",
        "timeoutSec": 5,
        "statusMessage": "running hook",
        "sourcePath": "/Users/me/.codex/config.toml",
        "source": "user",
        "pluginId": null,
        "displayOrder": 0,
        "enabled": true,
        "currentHash": "sha256:...",
        "trustStatus": "untrusted"
      }],
      "warnings": [],
      "errors": []
    }]
  }
}
```

要禁用 non-managed hook，可用 `config/batchWrite` 在 `hooks.state` 中 upsert 一个 state entry：

```json
{
  "method": "config/batchWrite",
  "id": 29,
  "params": {
    "edits": [{
      "keyPath": "hooks.state",
      "value": {
        "/Users/me/.codex/config.toml:pre_tool_use:0:0": {
          "enabled": false
        }
      },
      "mergeStrategy": "upsert"
    }],
    "reloadUserConfig": true
  }
}
```

要重新启用它，用同一个 hook key upsert `"enabled": true`。

## Apps

使用 `app/list` 获取可用 apps（connectors）。每个 entry 包含 app `id`、显示 `name`、`installUrl`、`branding`、`appMetadata`、`labels`、当前是否 accessible、以及 config 中是否 enabled 等 metadata。

```json
{ "method": "app/list", "id": 50, "params": {
    "cursor": null,
    "limit": 50,
    "threadId": "thr_123",
    "forceRefetch": false
} }
{ "id": 50, "result": {
    "data": [
        {
            "id": "demo-app",
            "name": "Demo App",
            "description": "Example connector for documentation.",
            "logoUrl": "https://example.com/demo-app.png",
            "logoUrlDark": null,
            "distributionChannel": null,
            "branding": null,
            "appMetadata": null,
            "labels": null,
            "installUrl": "https://chatgpt.com/apps/demo-app/demo-app",
            "isAccessible": true,
            "isEnabled": true
        }
    ],
    "nextCursor": null
} }
```

提供 `threadId` 时，app feature gating（`Feature::Apps`）使用该 thread 的 config snapshot 评估。省略时使用最新 global config。

`app/list` 会在 accessible apps 和 directory apps 都加载后返回。设置 `forceRefetch: true` 可绕过 app caches 并从 sources 获取新数据。cache entries 只会在这些 refetch 成功时被替换。

server 还会在任一 source（accessible apps 或 directory apps）完成加载时发送 `app/list/updated` notifications。每个 notification 包含最新 merged app list。

```json
{
  "method": "app/list/updated",
  "params": {
    "data": [
      {
        "id": "demo-app",
        "name": "Demo App",
        "description": "Example connector for documentation.",
        "logoUrl": "https://example.com/demo-app.png",
        "logoUrlDark": null,
        "distributionChannel": null,
        "branding": null,
        "appMetadata": null,
        "labels": null,
        "installUrl": "https://chatgpt.com/apps/demo-app/demo-app",
        "isAccessible": true,
        "isEnabled": true
      }
    ]
  }
}
```

Connected apps 可以在 `config.toml` 中覆盖 thread 的 approval reviewer。省略时，app 继承 top-level `approvals_reviewer` 值：

```toml
approvals_reviewer = "auto_review"

[apps.demo-app]
approvals_reviewer = "user"
```

将 app 值设为 `"user"` 会把它的 approval prompts 路由给用户，而不是 Guardian；设为 `"auto_review"` 会在配置 requirements 允许时让该 app opt into Guardian review。

在 text input 中插入 `$<app-slug>` 可调用 app。slug 由 app name 派生，转为小写并将非字母数字字符替换为 `-`（例如 "Demo App" 变成 `$demo-app`）。推荐添加 `mention` input item，让 server 使用精确的 `app://<connector-id>` path，而不是按名称猜测。Plugins 使用同样的 `mention` item shape，但 path 为来自 `plugin/installed` 或 `plugin/list` 的 `plugin://<plugin-name>@<marketplace-name>`。

```text
$demo-app Pull the latest updates from the team.
```

```json
{
  "method": "turn/start",
  "id": 51,
  "params": {
    "threadId": "thread-1",
    "input": [
      {
        "type": "text",
        "text": "$demo-app Pull the latest updates from the team."
      },
      { "type": "mention", "name": "Demo App", "path": "app://demo-app" }
    ]
  }
}
```

## Auth endpoints

JSON-RPC auth/account surface 暴露 request/response methods 和 server-initiated notifications（无 `id`）。使用它们判断 auth state、启动或取消登录、登出，以及检查 ChatGPT rate limits。

### Authentication modes

Codex 支持以下认证模式。当前模式会在 `account/updated`（`authMode`）中暴露；可用时还包含当前 ChatGPT `planType`，也可从 `account/read` 推断。

- **API key (`apiKey`)**：调用方通过 `account/login/start` 传入 `type: "apiKey"` 和 OpenAI API key。API key 会保存并用于 API requests。
- **ChatGPT managed (`chatgpt`)**（推荐）：Codex 拥有 ChatGPT OAuth flow 和 refresh tokens。浏览器流程通过 `account/login/start` 的 `type: "chatgpt"` 启动，device code 通过 `type: "chatgptDeviceCode"` 启动；Codex 将 tokens 持久化到磁盘并自动刷新。
- **Personal access token (`personalAccessToken`)**：Codex 使用从 app-server login RPCs 之外加载的 ChatGPT-backed personal access token，例如通过 `codex login --with-access-token` 或 `CODEX_ACCESS_TOKEN`。

### API Overview

- `account/read`：获取当前 account info；可选刷新 tokens。
- `account/login/start`：开始登录（`apiKey`、`chatgpt`、`chatgptDeviceCode`）。
- `account/login/completed`（notify）：登录尝试完成时发送（成功或错误）。
- `account/login/cancel`：按 `loginId` 取消 pending managed ChatGPT login。
- `account/logout`：登出；触发 `account/updated`。
- `account/updated`（notify）：auth mode 变化时发送（`authMode`: `apikey`、`chatgpt`、`personalAccessToken` 或 `null`），可用时包含当前 ChatGPT `planType`。
- `account/rateLimits/read`：获取 ChatGPT rate limits 和可选 effective monthly credit limit；更新通过 `account/rateLimits/updated`（notify）到达。
- `account/usage/read`：获取 ChatGPT account token-activity summary 和 daily buckets。
- `account/rateLimits/updated`（notify）：用户 ChatGPT rate limits 变化时发送。这是 sparse rolling update；将可用值合并进最近一次 `account/rateLimits/read` 响应，或重新获取该 snapshot。
- `account/sendAddCreditsNudgeEmail`：请求 ChatGPT 给 workspace owner 发送邮件，告知 credits 耗尽或达到 usage limit。
- `mcpServer/oauthLogin/completed`（notify）：某个 server 的 `mcpServer/oauth/login` flow 完成后发送；payload 包含 `{ name, success, error? }`。
- `mcpServer/startupStatus/updated`（notify）：已配置 MCP server startup status 变化时发送；payload 包含 `{ threadId, name, status, error }`，startup 是 thread-scoped 时 `threadId` 是 owning thread，app-scoped 时为 `null`，`status` 是 `starting`、`ready`、`failed` 或 `cancelled`。

### 1. 检查 auth state

请求：

```json
{ "method": "account/read", "id": 1, "params": { "refreshToken": false } }
```

响应示例：

```json
{ "id": 1, "result": { "account": null, "requiresOpenaiAuth": false } } // No OpenAI auth needed (e.g., OSS/local models)
{ "id": 1, "result": { "account": null, "requiresOpenaiAuth": true } }  // OpenAI auth required (typical for OpenAI-hosted models)
{ "id": 1, "result": { "account": { "type": "apiKey" }, "requiresOpenaiAuth": true } }
{ "id": 1, "result": { "account": { "type": "chatgpt", "email": "user@example.com", "planType": "pro" }, "requiresOpenaiAuth": true } }
```

字段说明：

- `refreshToken`（bool）：设为 `true` 可强制刷新 token。
- `requiresOpenaiAuth` 反映 active provider；当它为 `false` 时，Codex 可以在没有 OpenAI credentials 的情况下运行。

### 2. 使用 API key 登录

发送：

```json
{
  "method": "account/login/start",
  "id": 2,
  "params": { "type": "apiKey", "apiKey": "sk-…" }
}
```

预期响应：

```json
{ "id": 2, "result": { "type": "apiKey" } }
```

Notifications：

```json
{ "method": "account/login/completed", "params": { "loginId": null, "success": true, "error": null } }
{ "method": "account/updated", "params": { "authMode": "apikey", "planType": null } }
```

### 3. 使用 ChatGPT 登录（浏览器流程）

启动：

```json
{ "method": "account/login/start", "id": 3, "params": { "type": "chatgpt" } }
{ "id": 3, "result": { "type": "chatgpt", "loginId": "<uuid>", "authUrl": "https://chatgpt.com/…&redirect_uri=http%3A%2F%2Flocalhost%3A<port>%2Fauth%2Fcallback" } }
```

在浏览器中打开 `authUrl`；app-server 会托管本地 callback。

等待 notifications：

```json
{ "method": "account/login/completed", "params": { "loginId": "<uuid>", "success": true, "error": null } }
{ "method": "account/updated", "params": { "authMode": "chatgpt", "planType": "plus" } }
```

### 4. 使用 ChatGPT 登录（device code flow）

启动：

```json
{ "method": "account/login/start", "id": 4, "params": { "type": "chatgptDeviceCode" } }
{ "id": 4, "result": { "type": "chatgptDeviceCode", "loginId": "<uuid>", "verificationUrl": "https://auth.openai.com/codex/device", "userCode": "ABCD-1234" } }
```

向用户展示 `verificationUrl` 和 `userCode`；frontend 负责 UX。

等待 notifications：

```json
{ "method": "account/login/completed", "params": { "loginId": "<uuid>", "success": true, "error": null } }
{ "method": "account/updated", "params": { "authMode": "chatgpt", "planType": "plus" } }
```

### 5. 取消 ChatGPT 登录

```json
{ "method": "account/login/cancel", "id": 5, "params": { "loginId": "<uuid>" } }
{ "method": "account/login/completed", "params": { "loginId": "<uuid>", "success": false, "error": "…" } }
```

### 6. 登出

```json
{ "method": "account/logout", "id": 6 }
{ "id": 6, "result": {} }
{ "method": "account/updated", "params": { "authMode": null, "planType": null } }
```

### 7. Rate limits（ChatGPT）

```json
{ "method": "account/rateLimits/read", "id": 7 }
{ "id": 7, "result": { "rateLimits": { "primary": { "usedPercent": 25, "windowDurationMins": 15, "resetsAt": 1730947200 }, "secondary": null, "rateLimitReachedType": null } } }
{ "method": "account/rateLimits/updated", "params": { "rateLimits": { … } } }
```

字段说明：

- `usedPercent` 是 OpenAI quota window 内的当前 usage。
- `windowDurationMins` 是 quota window 长度。
- `resetsAt` 是下一次 reset 的 Unix timestamp（秒）。
- `rateLimitReachedType` 标识 backend-classified limit state（当已达到某个 limit 时）。
- `individualLimit` 在可用时描述 effective monthly credit limit。在 `account/rateLimits/read` 响应中，`null` 表示没有可用 monthly limit。在 sparse `account/rateLimits/updated` notification 中，nullable account metadata 可能不可用，且不会清除此前观察到的值。

### 8. 通知 workspace owner 限额相关事项

```json
{ "method": "account/sendAddCreditsNudgeEmail", "id": 8, "params": { "creditType": "credits" } }
{ "id": 8, "result": { "status": "sent" } }
```

当 workspace credits 耗尽时使用 `creditType: "credits"`；当 workspace usage limit 已达到时使用 `creditType: "usage_limit"`。如果 owner 最近已被通知，响应 status 为 `cooldown_active`。

## 实验性 API Opt-in

某些 app-server methods 和 fields 有意放在实验性 capability 后面，且不保证向后兼容。这让客户端可以在两者之间选择：

- 仅稳定 surface（默认）：不 opt in，不暴露实验性 methods/fields。
- 实验性 surface：在 `initialize` 时 opt in。

### 生成 stable 与 experimental client schemas

`codex app-server` schema generation 默认输出 stable API surface（过滤掉 experimental fields 和 methods）。传入 `--experimental` 可在生成的 TypeScript 或 JSON schema 中包含 experimental methods/fields：

```bash
# Stable-only output (default)
codex app-server generate-ts --out DIR
codex app-server generate-json-schema --out DIR

# Include experimental API surface
codex app-server generate-ts --out DIR --experimental
codex app-server generate-json-schema --out DIR --experimental
```

### 客户端如何在运行时 opt in

在唯一一次 `initialize` 请求中将 `capabilities.experimentalApi` 设为 `true`：

```json
{
  "method": "initialize",
  "id": 1,
  "params": {
    "clientInfo": {
      "name": "my_client",
      "title": "My Client",
      "version": "0.1.0"
    },
    "capabilities": {
      "experimentalApi": true
    }
  }
}
```

随后发送标准 `initialized` notification 并正常继续。

注意：

- 如果省略 `capabilities`，`experimentalApi` 视为 `false`。
- 该设置在 initialization 时协商一次，作用于进程生命周期；重新初始化会被拒绝并返回 `"Already initialized"`。

### 没有 opt-in 时会发生什么

如果请求使用 experimental method，或在没有 opt in 的情况下设置 experimental field，app-server 会用 JSON-RPC error 拒绝它。消息为：

```text
<descriptor> requires experimentalApi capability
```

descriptor 字符串示例：

- `mock/experimentalMethod`（method-level gate）
- `thread/start.mockExperimentalField`（field-level gate）
- `askForApproval.granular`（enum-variant gate，用于 `approvalPolicy: { "granular": ... }`）

### 给维护者：添加 experimental fields 和 methods

引入仅在客户端 opt into experimental APIs 时可用的 field/method 时，使用以下 checklist。

运行时，客户端必须发送带 `capabilities.experimentalApi = true` 的 `initialize`，才能使用 experimental methods 或 fields。

1. 在 protocol type 中标注字段（通常在 `app-server-protocol/src/protocol/v2.rs`）：

   ```rust
   #[experimental("thread/start.myField")]
   pub my_field: Option<String>,
   ```

2. 确保 params type derive `ExperimentalApi`，这样运行时可以检测 field-level gating。

3. 在 `app-server-protocol/src/protocol/common.rs` 中，当只有某些 fields 是 experimental 时（例如 `thread/start`），保持 method stable，并使用 `inspect_params: true`。如果整个 method 都是 experimental，则在 method variant 上标注 `#[experimental("method/name")]`。

Enum variants 也可以 gated：

```rust
#[derive(ExperimentalApi)]
enum AskForApproval {
    #[experimental("askForApproval.granular")]
    Granular { /* ... */ },
}
```

如果 stable field 包含可能本身 experimental 的 nested type，将该 field 标为 `#[experimental(nested)]`，让 `ExperimentalApi` 将 nested reason 向上冒泡到 containing type：

```rust
#[derive(ExperimentalApi)]
struct Config {
    #[experimental(nested)]
    approval_policy: Option<AskForApproval>,
}
```

对于 server-initiated request payloads，也用同样方式标注字段，让 schema generation 将其视为 experimental，并确保 app-server 在客户端未 opt into `experimentalApi` 时省略该字段。

4. 重新生成 protocol fixtures：

   ```bash
   just write-app-server-schema
   # Include experimental API fields/methods in fixtures.
   just write-app-server-schema --experimental
   ```

5. 验证 protocol crate：

   ```bash
   just test -p codex-app-server-protocol
   ```
