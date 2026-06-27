# ThreadManager Sample

一个一次性运行的小型示例二进制：通过 `codex-core-api` 暴露的
`ThreadManager` 启动 Codex thread，提交单次用户 turn，并把映射后的
app-server notifications 作为 newline-delimited JSON 输出。

架构和业务流程见 [ARCHITECTURE.md](ARCHITECTURE.md)。

Authentication uses the configured credential storage under `CODEX_HOME`, including
`cli_auth_credentials_store`, `mcp_oauth_credentials_store`, and
`features.secret_auth_storage`. Local managed authentication requirements and auth
routing settings are respected. This also applies to `cargo run` builds. Other
execution settings remain the sample's built-in configuration.

```sh
cargo run -p codex-thread-manager-sample -- "Say hello"
```

使用 `--model` 覆盖默认模型：

```sh
cargo run -p codex-thread-manager-sample -- --model gpt-5.2 "Say hello"
```

也可以通过 stdin pipe 输入 prompt：

```sh
printf 'Say hello\n' | cargo run -p codex-thread-manager-sample
```
