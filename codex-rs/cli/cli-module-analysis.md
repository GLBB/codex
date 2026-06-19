# codex-rs/cli 模块梳理

## 1. 模块定位

`codex-rs/cli` 是整个 Codex Rust workspace 的统一命令行入口 crate。它产出二进制 `codex`，同时提供一个较小的库接口 `codex_cli` 给同 workspace 的调试/沙箱入口复用。

这个模块本身不是 agent 核心业务。它更像产品入口层和命令调度层：

- 接收用户命令行参数。
- 用 `clap` 解析 root options、feature toggles 和 subcommand。
- 将配置覆盖项、profile、远程 TUI 参数等整理成各下游 crate 可理解的结构。
- 按命令分派到 `codex-tui`、`codex-exec`、`codex-app-server`、`codex-mcp-server`、`codex-login`、`codex-core-plugins`、`codex-exec-server` 等模块。
- 对少数 CLI 专属场景提供本地实现，例如 `doctor`、sandbox debug wrapper、plugin/marketplace 命令、remote-control wrapper、desktop app launcher。

它解决的问题是：Codex 有多个产品入口和维护工具，如果每个 crate 都暴露独立 binary，用户和安装包都会很复杂。`cli` 把它们统一到一个 `codex [OPTIONS] [COMMAND]` 入口下。

它和其他模块的关系：

```text
用户 / shell / VS Code extension / npm shim
  |
  v
codex-rs/cli  二进制 codex
  |
  +--> codex-tui                 交互式 TUI
  +--> codex-exec                非交互执行 / review
  +--> codex-app-server          VS Code / app-server JSON-RPC
  +--> codex-app-server-daemon   后台 daemon 生命周期
  +--> codex-mcp-server          MCP server 模式
  +--> codex-core/config/login   配置、认证、模型、状态等基础能力
  +--> codex-core-plugins        plugin / marketplace 管理
  +--> codex-exec-server         远程/本地 exec-server
```

## 2. 目录结构

重要文件如下：

```text
codex-rs/cli/
  Cargo.toml
  build.rs
  src/
    main.rs
    lib.rs
    login.rs
    doctor.rs
    doctor/
      background.rs
      git.rs
      output.rs
      output/detail.rs
      progress.rs
      runtime.rs
      system.rs
      thread_inventory.rs
      title.rs
      updates.rs
    mcp_cmd.rs
    plugin_cmd.rs
    marketplace_cmd.rs
    remote_control_cmd.rs
    debug_sandbox.rs
    debug_sandbox/
      pid_tracker.rs
      seatbelt.rs
    app_cmd.rs
    desktop_app/
      mod.rs
      mac.rs
      windows.rs
    exec_server_telemetry.rs
    exit_status.rs
    sandbox_setup.rs
    state_db_recovery.rs
    wsl_paths.rs
  tests/
```

## 3. 核心文件说明

### `codex-rs/cli/Cargo.toml`

- 职责：定义 crate `codex-cli`，binary `codex`，library `codex_cli`，以及 CLI 需要聚合的大量 workspace 依赖。
- 关键内容：
  - `[[bin]] name = "codex", path = "src/main.rs"`
  - `[lib] name = "codex_cli", path = "src/lib.rs"`
- 被谁调用：Cargo/Bazel 构建系统。
- 调用了谁：依赖 `codex-app-server`、`codex-exec`、`codex-tui`、`codex-core`、`codex-login`、`codex-core-plugins` 等。

### `codex-rs/cli/build.rs`

- 职责：macOS 构建时加 `-ObjC` 链接参数。
- 关键函数：`main()`
- 被谁调用：Cargo build script。
- 调用了谁：标准库 `std::env`。

### `codex-rs/cli/src/main.rs`

- 职责：`codex` binary 的主入口和命令总路由。
- 关键类型：
  - `MultitoolCli`：root CLI，包含全局 config override、feature toggle、remote TUI 参数、interactive TUI 参数、subcommand。
  - `Subcommand`：所有一级子命令，如 `Exec`、`Review`、`AppServer`、`RemoteControl`、`Doctor`、`Sandbox`、`Plugin`。
  - `AppServerCommand` / `AppServerSubcommand`
  - `ExecServerCommand`
  - `LoginCommand`
  - `FeatureToggles`
- 关键函数：
  - `main() -> anyhow::Result<()>`
  - `cli_main(arg0_paths, remote_control_disabled) -> anyhow::Result<()>`
  - `run_interactive_tui(...) -> std::io::Result<AppExitInfo>`
  - `run_exec_server_command(...)`
  - `loader_overrides_for_profile(...)`
  - `reject_remote_mode_for_subcommand(...)`
  - `reject_root_strict_config_for_subcommand(...)`
- 被谁调用：最终用户运行 `codex`；npm shim `codex-cli/bin/codex.js` 会找到 native `codex` 再 spawn 它。
- 调用了谁：
  - `codex_tui::run_main`
  - `codex_exec::run_main`
  - `codex_app_server::run_main_with_transport_options`
  - `codex_mcp_server::run_main`
  - `doctor::run_doctor`
  - `plugin_cmd::*`
  - `marketplace_cmd::MarketplaceCli::run`
  - `remote_control_cmd::run`
  - `codex_exec_server::run_main`

### `codex-rs/cli/src/lib.rs`

- 职责：给 crate 内外复用的 CLI 库面，主要导出 sandbox debug 命令结构和 login 相关函数。
- 关键导出：
  - `SeatbeltCommand`
  - `LandlockCommand`
  - `WindowsCommand`
  - `run_command_under_seatbelt`
  - `run_command_under_landlock`
  - `run_command_under_windows_sandbox`
  - `run_login_*`
  - `run_logout`
- 被谁调用：
  - `src/main.rs` 的 `Sandbox`、`Login`、`Logout` 分支。
  - workspace 内可能直接依赖 `codex_cli` 的测试/工具。
- 调用了谁：
  - `debug_sandbox`
  - `login`

### `codex-rs/cli/src/login.rs`

- 职责：直接 `codex login/logout/status` 流程，不走 TUI 的完整 tracing 栈。
- 关键函数：
  - `run_login_with_chatgpt(...) -> !`
  - `run_login_with_api_key(...) -> !`
  - `run_login_with_access_token(...) -> !`
  - `run_login_with_device_code(...) -> !`
  - `run_login_status(...) -> !`
  - `run_logout(...) -> !`
  - `read_api_key_from_stdin()`
  - `read_access_token_from_stdin()`
- 被谁调用：`main.rs` 的 `Subcommand::Login` / `Subcommand::Logout` 分支。
- 调用了谁：
  - `codex_login::run_login_server`
  - `codex_login::run_device_code_login`
  - `codex_login::login_with_api_key`
  - `codex_login::login_with_access_token`
  - `codex_login::logout_with_revoke`
  - `codex_core::config::Config`

### `codex-rs/cli/src/doctor.rs` 与 `src/doctor/*`

- 职责：实现 `codex doctor` 诊断报告。它是 read-mostly 命令，检查环境、安装、配置、认证、终端、Git、状态库、app-server daemon、网络连通性等。
- 关键函数：
  - `run_doctor(command, root_config_overrides, interactive, arg0_paths)`
  - `build_report(...) -> DoctorReport`
  - `load_config(...) -> anyhow::Result<Config>`
  - `run_sync_check(...)`
  - `run_async_check(...)`
- 子文件职责：
  - `doctor/background.rs`：读取 app-server daemon 状态和控制 socket。
  - `doctor/git.rs`：检查 git 可执行文件、版本、repo root、branch、fsmonitor。
  - `doctor/output.rs`：human report 渲染。
  - `doctor/output/detail.rs`：detail 行的人类友好化、折叠、截断。
  - `doctor/progress.rs`：stderr 进度条，JSON 模式保持静默。
  - `doctor/runtime.rs`：当前 binary、安装上下文、rg/search 命令。
  - `doctor/system.rs`：OS、locale、editor、pager 环境。
  - `doctor/thread_inventory.rs`：rollout 文件和 SQLite thread inventory 对账。
  - `doctor/title.rs`：TUI terminal title 配置检查。
  - `doctor/updates.rs`：更新路径、npm root、缓存版本信息检查。
- 被谁调用：`main.rs` 的 `Subcommand::Doctor` 分支。
- 调用了谁：
  - `codex_core::config::ConfigBuilder`
  - `codex_login::AuthManager`
  - `codex_api::ResponsesWebsocketClient`
  - `codex_app_server::app_server_control_socket_path`
  - `codex_rollout`
  - `codex_state`

### `codex-rs/cli/src/mcp_cmd.rs`

- 职责：实现 `codex mcp` 命令，管理 MCP server 配置和 OAuth 登录。
- 关键类型：
  - `McpCli`
  - `McpSubcommand`
  - `AddArgs`
  - `LoginArgs`
- 关键函数：
  - `McpCli::run(loader_overrides)`
  - `run_add(...)`
  - `run_remove(...)`
  - `run_login(...)`
  - `run_logout(...)`
  - `run_list(...)`
  - `run_get(...)`
  - `perform_oauth_login_retry_without_scopes(...)`
- 被谁调用：`main.rs` 的 `Subcommand::Mcp` 分支。
- 调用了谁：
  - `codex_core::config::ConfigBuilder`
  - `codex_core::config::edit::ConfigEditsBuilder`
  - `codex_core::config::load_global_mcp_servers`
  - `codex_mcp::*`
  - `codex_rmcp_client::*`

### `codex-rs/cli/src/plugin_cmd.rs`

- 职责：实现 `codex plugin add/list/remove`，并把 marketplace 子命令交给 `marketplace_cmd`。
- 关键类型：
  - `PluginCli`
  - `PluginSubcommand`
  - `AddPluginArgs`
  - `ListPluginsArgs`
  - `RemovePluginArgs`
- 关键函数：
  - `run_plugin_add(...)`
  - `run_plugin_list(...)`
  - `run_plugin_remove(...)`
  - `load_plugin_command_context(...)`
  - `parse_plugin_selection(...)`
  - `find_marketplace_for_plugin(...)`
- 被谁调用：`main.rs` 的 `Subcommand::Plugin` 分支。
- 调用了谁：
  - `codex_core_plugins::PluginsManager`
  - `codex_core_plugins::installed_marketplaces::*`
  - `codex_plugin::PluginId`
  - `codex_login`

### `codex-rs/cli/src/marketplace_cmd.rs`

- 职责：实现 `codex plugin marketplace add/list/upgrade/remove`。
- 关键类型：
  - `MarketplaceCli`
  - `MarketplaceSubcommand`
  - `AddMarketplaceArgs`
  - `UpgradeMarketplaceArgs`
- 关键函数：
  - `MarketplaceCli::run()`
  - `run_add(...)`
  - `run_list(...)`
  - `run_upgrade(...)`
  - `run_remove(...)`
- 被谁调用：
  - `main.rs` 经 `PluginSubcommand::Marketplace` 调用。
  - `plugin_cmd.rs` 引用其类型。
- 调用了谁：
  - `codex_core_plugins::marketplace_add::add_marketplace`
  - `codex_core_plugins::marketplace_remove::remove_marketplace`
  - `codex_core_plugins::PluginsManager`

### `codex-rs/cli/src/remote_control_cmd.rs`

- 职责：实现 `codex remote-control`，包含 foreground remote-control 和 daemon start/stop。
- 关键类型：
  - `RemoteControlCommand`
  - `RemoteControlSubcommand`
- 关键函数：
  - `run(...)`
  - `run_foreground_remote_control(...)`
  - `wait_for_foreground_remote_control_start(...)`
  - `wait_for_foreground_app_server(...)`
  - `wait_for_foreground_remote_control_ready(...)`
- 被谁调用：`main.rs` 的 `Subcommand::RemoteControl` 分支。
- 调用了谁：
  - `codex_app_server::run_main_with_transport_options`
  - `codex_app_server_daemon::ensure_remote_control_ready`
  - `codex_app_server_daemon::run`
  - `tokio::signal::ctrl_c`

### `codex-rs/cli/src/debug_sandbox.rs`

- 职责：实现 `codex sandbox ...` 对平台 sandbox 的调试包装。
- 关键函数：
  - `run_command_under_seatbelt(...)`
  - `run_command_under_landlock(...)`
  - `run_command_under_windows_sandbox(...)`
  - `run_command_under_sandbox(...)`
  - `load_debug_sandbox_config(...)`
  - `spawn_debug_sandbox_child(...)`
- 被谁调用：`main.rs` 的 `Subcommand::Sandbox` 分支，经 `codex_cli::*` re-export。
- 调用了谁：
  - `codex_sandboxing::seatbelt`
  - `codex_sandboxing::landlock`
  - `codex_core::config::ConfigBuilder`
  - `tokio::process::Command`

### `codex-rs/cli/src/app_cmd.rs` 与 `desktop_app/*`

- 职责：`codex app` 在 macOS/Windows 上打开或安装 Codex Desktop。
- 关键函数：
  - `run_app(...)`
  - `desktop_app::run_app_open_or_install(...)`
  - `mac::run_mac_app_open_or_install(...)`
  - `windows::run_windows_app_open_or_install(...)`
- 被谁调用：`main.rs` 的 `Subcommand::App` 分支，仅 macOS/Windows 编译。
- 调用了谁：系统命令如 macOS `open`、`hdiutil`，Windows URL open 逻辑。

### `codex-rs/cli/src/state_db_recovery.rs`

- 职责：TUI 启动时遇到本地 SQLite state db 损坏/锁定时，打印指导、自动备份损坏文件并重试。
- 关键函数：
  - `startup_error(...)`
  - `is_locked(...)`
  - `is_auto_backup_recoverable(...)`
  - `backup_files_for_fresh_start(...)`
  - `confirm_fresh_start_rebuild(...)`
- 被谁调用：`main.rs::run_interactive_tui`。
- 调用了谁：`codex_state`、`codex_tui::LocalStateDbStartupError`。

### `codex-rs/cli/src/exec_server_telemetry.rs`

- 职责：exec-server 子命令启动前初始化简化 telemetry/tracing。
- 关键函数：`init(...)`
- 被谁调用：`main.rs::run_exec_server_command`。
- 调用了谁：`tracing_subscriber`、OTEL 相关 provider。

### `codex-rs/cli/src/exit_status.rs`

- 职责：把子进程 `ExitStatus` 转换成当前进程 exit code，Unix 保留 signal 语义。
- 关键函数：`handle_exit_status(...) -> !`
- 被谁调用：`debug_sandbox.rs`。

### `codex-rs/cli/src/sandbox_setup.rs`

- 职责：Windows sandbox setup 子命令解析和提权安装逻辑。
- 关键函数：
  - `parse_setup_command(...)`
  - `run(...)`
  - `run_elevated(...)`
- 被谁调用：`main.rs` 的 Windows `Subcommand::Sandbox` 特殊分支。

### `codex-rs/cli/src/wsl_paths.rs`

- 职责：非 Windows 下的 WSL 路径辅助逻辑。
- 被谁调用：主要用于平台路径/remote 场景的 CLI 辅助代码。

## 4. 外部入口

### Binary 入口

主入口在 `codex-rs/cli/src/main.rs`：

```rust
fn main() -> anyhow::Result<()> {
    let remote_control_disabled = codex_app_server::take_remote_control_disabled_env();
    arg0_dispatch_or_else(move |arg0_paths: Arg0DispatchPaths| async move {
        cli_main(arg0_paths, remote_control_disabled).await?;
        Ok(())
    })
}
```

入口参数来自：

- `std::env::args()`，由 `clap::Parser` 在 `MultitoolCli::parse()` 中读取。
- 当前 executable/arg0 派生出的 `Arg0DispatchPaths`。
- 环境变量，包括 remote-control disabled 标记、auth 环境变量、config 相关环境变量等。

返回结果：

- `anyhow::Result<()>`。
- 多数普通错误通过 `?` 向上传递，最终成为非零退出。
- 部分命令直接 `std::process::exit(...)`，例如 login、doctor fail、update、TUI exit handling。

### Library 入口

`codex-rs/cli/src/lib.rs` 导出：

```text
run_command_under_seatbelt
run_command_under_landlock
run_command_under_windows_sandbox
run_login_with_chatgpt
run_login_with_api_key
run_login_with_access_token
run_login_with_device_code
run_login_status
run_logout
```

这些用于将 CLI 子功能复用到同 crate binary 或测试中。

## 5. 主调用链

最核心主流程是：用户运行 `codex` 后进入 TUI，或者运行子命令后分发到对应模块。

```text
shell / npm shim / VS Code
  |
  v
codex binary
  |
  v
main()
  |
  v
codex_arg0::arg0_dispatch_or_else(...)
  |
  v
cli_main(...)
  |
  +-- no subcommand ------------------> run_interactive_tui(...) --> codex_tui::run_main(...)
  |
  +-- exec/review ---------------------> codex_exec::run_main(...)
  |
  +-- app-server ----------------------> codex_app_server::run_main_with_transport_options(...)
  |
  +-- mcp-server ----------------------> codex_mcp_server::run_main(...)
  |
  +-- mcp -----------------------------> McpCli::run(...)
  |
  +-- plugin --------------------------> plugin_cmd / marketplace_cmd
  |
  +-- doctor --------------------------> doctor::run_doctor(...)
  |
  +-- sandbox -------------------------> debug_sandbox platform runner
  |
  +-- remote-control ------------------> remote_control_cmd::run(...)
```

### 主流程按真实代码追踪

1. `codex-rs/cli/src/main.rs`
   - 函数：`main()`
   - 作用：读取 remote-control disabled 状态，进入 `arg0_dispatch_or_else`。
   - 调用：`cli_main(arg0_paths, remote_control_disabled)`

2. `codex-rs/arg0/src/lib.rs`
   - 函数：`arg0_dispatch_or_else(...)`
   - 作用：根据 arg0/安装布局做特殊分发；否则执行传入闭包。
   - 调用：闭包中的 `cli_main(...)`

3. `codex-rs/cli/src/main.rs`
   - 函数：`cli_main(...)`
   - 作用：`MultitoolCli::parse()` 解析 CLI；合并 feature toggles 到 config overrides；校验 root `--strict-config` 和 profile 使用范围；按 `Subcommand` 分发。
   - 调用：不同下游模块。

4. `codex-rs/cli/src/main.rs`
   - 函数：`run_interactive_tui(...)`
   - 作用：无子命令时启动交互 TUI；处理 `TERM=dumb`、remote endpoint、state db 损坏恢复。
   - 调用：`codex_tui::run_main(...)`

5. `codex-rs/tui`
   - 函数：`codex_tui::run_main(...)`
   - 作用：真正进入 TUI app runtime。
   - 返回：`AppExitInfo`

6. `codex-rs/cli/src/main.rs`
   - 函数：`handle_app_exit(...)`
   - 作用：把 TUI 退出信息转成用户提示和进程退出码。
   - 返回：成功或进程退出。

### VS Code / app-server 相关调用链

```text
VS Code extension
  |
  | spawn
  v
codex app-server --listen stdio://
  |
  v
main.rs::cli_main
  |
  v
Subcommand::AppServer(None)
  |
  v
codex_app_server::run_main_with_transport_options(
  transport = AppServerTransport::Stdio,
  session_source = SessionSource::VSCode,
)
  |
  v
codex-rs/app-server runtime
```

对应代码：

1. `codex-rs/cli/src/main.rs`
   - 函数：`cli_main(...)`
   - 分支：`Some(Subcommand::AppServer(app_server_cli))`
   - 作用：解析 `--listen` / `--stdio` / auth / remote-control。
   - 调用：`codex_app_server::run_main_with_transport_options(...)`

2. `codex-rs/app-server/src/lib.rs`
   - 函数：`run_main_with_transport_options(...)`
   - 作用：加载配置、启动 transport、remote control、processor loop、outbound loop。
   - 返回：`std::io::Result<()>`

## 6. 数据流

### 输入数据

输入主要来自：

- 命令行参数：`clap` 解析为 `MultitoolCli` 和各子命令参数。
- 环境变量：
  - auth：`CODEX_API_KEY`、`OPENAI_API_KEY`、`CODEX_ACCESS_TOKEN` 等。
  - terminal：`TERM`、locale、pager/editor、颜色相关变量。
  - npm/bun shim：`CODEX_MANAGED_BY_NPM`、`CODEX_MANAGED_PACKAGE_ROOT` 等。
  - remote auth token env：由 `--remote-auth-token-env` 指定。
- 文件系统：
  - `CODEX_HOME` / `~/.codex`
  - `config.toml`
  - auth 文件/keyring
  - plugin marketplace cache
  - sqlite state db
  - rollout session files
- stdio：
  - login API key/access token 从 stdin 读取。
  - app-server stdio 模式从 stdin/stdout 通信。

### 转换过程

```text
argv/env/files
  |
  v
clap structs: MultitoolCli / Subcommand / args
  |
  v
CliConfigOverrides raw strings
  |
  v
parse_overrides() -> Vec<(String, toml::Value)>
  |
  v
ConfigBuilder / downstream command structs
  |
  v
downstream runtime: TUI, exec, app-server, mcp, plugin manager, doctor
```

### 中间状态

- CLI 参数状态主要保存在局部变量中，不长期持久化。
- 配置变更类命令会写入 `config.toml`：
  - `features enable/disable`
  - `mcp add/remove`
  - plugin/marketplace 配置更新
- app-server daemon/remote-control 会读写 daemon state。
- login 会更新 auth 存储，并可能写 `codex-login.log`。
- doctor 构造内存中的 `DoctorReport`，最后渲染为 JSON 或 human report。

### 输出

- stdout：
  - 常规命令结果、JSON 输出、completion、doctor report。
- stderr：
  - 警告、login 浏览器提示、TUI 前置确认、doctor progress。
- exit code：
  - TUI exit info、doctor fail、update command、sandbox child status 等会影响进程码。
- 文件副作用：
  - auth credentials
  - config edits
  - marketplace/plugin cache
  - login log
  - debug trace-reduce 输出文件
  - state db 损坏恢复备份
- 网络副作用：
  - login OAuth/device flow
  - plugin marketplace Git/HTTP
  - doctor reachability probes
  - exec-server remote registration
  - app installer download

## 7. 配置与依赖

### 配置来源

- root `-c key=value` / `--config key=value`，类型是 `CliConfigOverrides`。
- root `--enable FEATURE` / `--disable FEATURE`，会被折叠成 config overrides。
- TUI shared flags，例如 model、sandbox、approval、cwd、profile、web search。
- `$CODEX_HOME/config.toml`。
- profile v2：`loader_overrides_for_profile(...)` 将 `--profile` 解析成 profile config path。
- managed config / requirements，由下游 `ConfigBuilder` 和 config loader 处理。

### 外部库

主要外部库：

- `clap` / `clap_complete`：CLI 参数解析和 completion。
- `anyhow`：错误聚合和上下文。
- `tokio`：async runtime、process、signal、join、timeout。
- `serde` / `serde_json` / `toml`：JSON/TOML 序列化。
- `tracing` / `tracing-subscriber` / `tracing-appender`：日志。
- `owo-colors` / `supports-color`：terminal human output。
- `which`、`os_info`、`sys-locale`、`url`、`tempfile` 等系统辅助。

### 项目内依赖

`cli` 是高度聚合 crate，依赖很多内部模块：

- `codex-arg0`：arg0 分发和 runtime executable paths。
- `codex-utils-cli`：CLI config overrides、shared CLI options。
- `codex-config` / `codex-core`：配置加载和核心类型。
- `codex-tui`：交互式主界面。
- `codex-exec`：非交互执行。
- `codex-app-server` / `codex-app-server-daemon` / `codex-app-server-protocol`：IDE/app server。
- `codex-login`：认证。
- `codex-core-plugins` / `codex-plugin`：plugin/marketplace。
- `codex-mcp` / `codex-mcp-server` / `codex-rmcp-client`：MCP 管理和 server。
- `codex-exec-server`：exec-server。
- `codex-sandboxing`：平台 sandbox。
- `codex-state` / `codex-rollout`：本地状态和 rollout。

### 隐式依赖

- 当前工作目录：影响 TUI、profile、Git、sandbox cwd。
- `PATH`：影响 `git`、`rg`、npm、系统命令、app installer 命令。
- terminal 能力：`TERM=dumb` 会触发保护逻辑。
- OS 编译条件：macOS/Windows 才有 `codex app`；macOS/ Linux/Windows sandbox 分支不同。
- npm/bun shim 设置的环境变量影响 update 和 doctor 判断。

## 8. 异常处理

### 常见异常场景

- CLI 参数不合法：由 `clap` 或后置校验报错。
- `--remote` 被用于非 TUI 子命令：`reject_remote_mode_for_subcommand` 返回错误。
- root `--strict-config` 用于不支持的子命令：`reject_root_strict_config_for_subcommand` 返回错误。
- config override 解析失败：`parse_overrides().map_err(anyhow::Error::msg)?`。
- 配置加载失败：多数命令向上传递；doctor 会降级生成 config fail report 并继续跑部分检查。
- TUI state db 损坏：`run_interactive_tui` 通过 `state_db_recovery` 自动备份后重试。
- TUI state db 被锁：打印指导，返回 fatal `AppExitInfo`。
- login 被 forced login method 禁用：打印错误并 `exit(1)`。
- app-server remote-control 不可用：下游 `codex-app-server` 返回错误。
- plugin/marketplace 找不到或 snapshot 加载失败：`bail!`。
- MCP OAuth 不支持：`bail!`；部分 OAuth scope 错误会 retry without scopes。
- sandbox 平台不支持：`bail!`。
- exec-server 远程注册认证不满足：`bail!` 或向上传递。

### 捕获和兜底

- `main()` 顶层返回 `anyhow::Result<()>`，普通错误交给 runtime 打印。
- `run_interactive_tui` 对 state db 损坏做自动恢复。
- `doctor::build_report` 对 config 加载失败有降级路径。
- `remote_control_cmd` foreground 模式会监听 Ctrl-C，并 abort app-server task。
- `login` 初始化文件日志失败只发 warning，不阻断登录。
- `exec_server_telemetry::init` 失败只打印 `Could not create otel exporter`，不阻断 exec-server。

### 会向上传递的错误

- 大多数 `anyhow::Result` 分支使用 `?` 直接返回。
- 下游 crate 的 `run_main` 错误会传回 `cli_main`。
- IO、JSON/TOML、配置、网络、子进程错误通常都向上传递，除非命令有明确降级策略。

## 9. 扩展点

### 新增一级子命令

通常需要改：

1. `codex-rs/cli/src/main.rs`
   - 给 `Subcommand` 添加 variant。
   - 定义对应 `struct XxxCommand`。
   - 在 `cli_main` 的 `match subcommand` 添加分支。
   - 根据需要更新 `unsupported_subcommand_name_for_strict_config`、`profile_v2_for_subcommand`、remote mode 校验。
2. 如逻辑较多，新增 `src/xxx_cmd.rs`，并在 `main.rs` `mod xxx_cmd;`。
3. 添加 `codex-rs/cli/tests/*.rs` 覆盖 clap 解析或行为。

### 新增 app-server 子命令

需要改：

- `AppServerSubcommand`
- `app_server_subcommand_name`
- `cli_main` 的 `Subcommand::AppServer` 分支
- strict config / remote mode 校验

### 新增 doctor 检查

建议：

- 小检查可以放在 `doctor.rs`。
- 独立领域检查放到 `src/doctor/<name>.rs`。
- 在 `build_report` 中加入 `run_sync_check` 或 `run_async_check`。
- 给 human output 分组时更新 `doctor/output.rs` 的 `GROUPS`。
- 如果 detail 需要定制展示，更新 `doctor/output/detail.rs`。
- 增加 snapshot 或 unit test。

### 新增配置编辑命令

优先使用：

- `codex_core::config::edit::ConfigEditsBuilder`
- `CliConfigOverrides::parse_overrides`
- `find_codex_home`

不建议直接手写 TOML 字符串修改。

### 不建议直接修改的地方

- `cli_main` 已经很长，新增大逻辑不要继续堆在 `main.rs`，应该拆 `*_cmd.rs`。
- 不要让 `doctor` 做修复动作；它的设计是 read-mostly。
- 不要绕过 `ConfigBuilder` 自己拼配置。
- 不要在普通子命令里误用 `--remote`，当前设计只支持 interactive TUI commands。
- 平台 sandbox 相关逻辑不要跨平台硬编码，保持 `cfg(target_os = "...")` 分支。

## 10. 问题与改进建议

### 职责

总体职责清晰：`cli` 是入口层和命令路由层。但 `main.rs` 同时承担命令定义、分派、TUI wrapper、app-server wrapper、exec-server wrapper、features 管理、debug 命令等职责，文件过大。

### 文件大小

`src/main.rs` 已经明显是高耦合、高触达文件。新增功能应优先拆到新模块，例如：

- `app_server_cmd.rs`
- `features_cmd.rs`
- `exec_server_cmd.rs`
- `session_cmd.rs`
- `debug_cmd.rs`

### 调用链

主调用链清晰，但 `cli_main` 的 `match` 分支过长，新人阅读时容易迷失。可以考虑给每个大分支提取 `run_xxx_subcommand(...)`，但要避免只调用一次的小 helper 泛滥；更好的方式是按领域拆文件。

### 重复逻辑

有一些重复模式：

- `reject_remote_mode_for_subcommand(...)`
- `prepend_config_flags(...)`
- `parse_overrides()`
- `ConfigBuilder::default().cli_overrides(...)`

这些重复目前是可接受的，因为它们让每个子命令的配置边界比较显式。若继续增长，可抽象为小的 command context。

### 测试

`codex-rs/cli/tests/` 覆盖了 app-server、login、plugin、marketplace、mcp、execpolicy、features、update、sandbox 等命令。新增子命令应至少覆盖：

- clap 参数解析。
- 成功路径输出。
- 关键错误路径。
- JSON 输出稳定性。

Doctor 已有 snapshot 测试，改 human output 时需要更新 snapshot。

### 注释和文档

已有若干高质量注释，例如 `doctor.rs`、`login.rs`、`doctor/output.rs`。建议补充：

- `cli_main` 顶部的命令分派总览注释。
- app-server 分支说明 VS Code/plugin 常用 `codex app-server --listen stdio://`。
- 新人导览文档链接到 `codex-rs/cli/src/main.rs` 和关键子模块。

## 11. 新人阅读建议

建议按目标路径阅读，不要从 `main.rs` 第一行一路读到底。

### 路线 A：理解 `codex` 默认启动

```text
src/main.rs::main
  -> cli_main
  -> Subcommand::None
  -> run_interactive_tui
  -> codex_tui::run_main
```

重点看：

- `MultitoolCli`
- `cli_main`
- `run_interactive_tui`
- `state_db_recovery`

### 路线 B：理解 VS Code/app-server 启动

```text
codex app-server --listen stdio://
  -> cli_main
  -> Subcommand::AppServer(None)
  -> codex_app_server::run_main_with_transport_options
```

重点看：

- `AppServerCommand`
- `AppServerSubcommand`
- `Subcommand::AppServer` 分支
- `codex-rs/app-server/src/lib.rs::run_main_with_transport_options`

### 路线 C：理解非交互执行

```text
codex exec "..."
  -> cli_main
  -> Subcommand::Exec
  -> codex_exec::run_main
```

重点看：

- `Subcommand::Exec`
- root config overrides 如何 prepend 到 exec CLI。

### 路线 D：理解诊断系统

```text
codex doctor
  -> doctor::run_doctor
  -> build_report
  -> run_sync_check / run_async_check
  -> render_human_report 或 JSON
```

重点看：

- `doctor.rs`
- `doctor/output.rs`
- `doctor/background.rs`
- `doctor/runtime.rs`

### 路线 E：理解扩展管理

```text
codex plugin ...
  -> plugin_cmd.rs
  -> PluginsManager

codex plugin marketplace ...
  -> marketplace_cmd.rs
  -> codex_core_plugins
```

重点看：

- `plugin_cmd::load_plugin_command_context`
- `plugin_cmd::find_marketplace_for_plugin`
- `marketplace_cmd::MarketplaceCli::run`

