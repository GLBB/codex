# 本地 Langfuse 实验环境

配套[行动计划](../langfuse-local-action-plan.md)。Web：<http://127.0.0.1:3035>。使用两个项目分别观察原生 OTel 与 session plugin，避免重复计量。需要 Docker Compose、Python 3.11+、Codex 0.143+ 和 Node.js 22+。

在仓库根目录执行：

```bash
python3 learning/codex-observability/langfuse-local/manage.py init
python3 learning/codex-observability/langfuse-local/manage.py up
codex plugin marketplace add langfuse/codex-observability-plugin --ref f4be3a47ac2c9c43721223a8f2e5d13f12e676c7 --json
codex plugin add tracing@codex-observability-plugin --json
python3 learning/codex-observability/langfuse-local/manage.py configure
python3 learning/codex-observability/langfuse-local/manage.py trust-plugin
python3 learning/codex-observability/langfuse-local/manage.py show-login
```

`show-login` 仅在自己的终端查看管理员密码。凭据和结果保存在 `~/.local/share/codex-observability/langfuse-local/`，不写入仓库。`configure` 保留模型、权限、logs/metrics exporter，备份原配置并配置 trace exporter 和 `~/.codex/langfuse.json`。

如果刚加入 Docker 组，当前进程可能仍使用旧组列表；脚本在系统提供 `sg` 时自动用新的 Docker 组会话运行，否则重新登录终端后执行。

`trust-plugin` 通过 app-server 的 `hooks/list` 与 `config/batchWrite` 信任已审阅的 `0.4.0` Stop hook；插件升级后需要重新审阅 hook。当前会话不会热加载配置；启动新 Codex 会话才能使用这套配置。Stop hook 会上传该会话的内容，包括工具输入输出。

启动后，两个项目的入口：

- [Codex Native OTel](http://127.0.0.1:3035/project/codex-native-otel)：原生运行 spans。
- [Codex Session Plugin](http://127.0.0.1:3035/project/codex-session-plugin)：对话、generation、工具、session。

运行新会话后检查服务和最近一天的入库数据：

```bash
python3 learning/codex-observability/langfuse-local/manage.py status
python3 learning/codex-observability/langfuse-local/manage.py verify
python3 learning/codex-observability/langfuse-local/manage.py down
```

`verify` 的计数是最多 1,000 条 observations 的一页，不代表项目历史总量；完整结果留在私有状态目录。`down` 停止容器，保留持久化卷。再次 `up` 恢复数据与服务；本机仅绑定 loopback 地址。

需要回滚 Codex 时，打开私有目录中的 `config.before-langfuse.toml`，把原 `[otel]` 的 `trace_exporter` 恢复到当前配置；若此前没有这个字段则移除。将 `~/.codex/langfuse.json` 的 `enabled` 改为 `false`，或恢复已有的 `langfuse.before.json`。通过 `codex plugin remove tracing@codex-observability-plugin` 移除插件；如仍使用其他 hooks，保留 `features.hooks`。

Docker daemon 的代理配置属于本机配置，未写入 Compose。此机器已按终端代理配置 `/etc/docker/daemon.json` 的 `proxies`；在其他机器上依实际网络设置。镜像版本固定在 Compose，实际 digest 和验证结果见行动计划。
