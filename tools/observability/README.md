# Local Grafana OTEL LGTM Stack

This stack receives Codex OpenTelemetry data and shows logs, metrics, and
traces in one local Grafana UI.

It uses the Grafana OTEL LGTM image, which bundles an OpenTelemetry receiver
with Grafana, Loki, Tempo, and a Prometheus-compatible metrics backend.

- Grafana UI: http://localhost:3000
- OTLP/gRPC receiver: `localhost:4317`
- OTLP/HTTP receiver: `localhost:4318`

Start it from this directory:

```sh
docker compose up -d
```

The stack provisions a Codex control-room dashboard at:

- http://localhost:3000/d/codex-control-room/codex-control-room

The dashboard defaults to all Codex services (`codex.*|codex_.*`) so it works
with app-server, exec-server, MCP server, and VS Code-originated runs without
guessing the exact service name first.

The local compose file enables anonymous Admin access for Grafana. This is only
for local development, and it avoids browser/API issues caused by embedding
`admin:admin@` credentials in dashboard URLs.

If Docker Hub is unavailable, pull through a mirror and tag the image locally:

```sh
docker pull docker.m.daocloud.io/grafana/otel-lgtm:latest
docker tag docker.m.daocloud.io/grafana/otel-lgtm:latest grafana/otel-lgtm:latest
docker compose up -d
```

Point Codex at the local OTLP/HTTP receiver from `~/.codex/config.toml`:

```toml
[otel]
environment = "dev"
exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/logs", protocol = "binary" } }
trace_exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/traces", protocol = "binary" } }
metrics_exporter = { otlp-http = { endpoint = "http://127.0.0.1:4318/v1/metrics", protocol = "binary" } }
log_user_prompt = false
```

For WSL, run the stack in the same WSL distro as Codex when possible. If the
stack runs on Windows and Codex runs in WSL, replace `127.0.0.1` with the
Windows host IP from `/etc/resolv.conf`.

Use Grafana Explore:

- Tempo: inspect traces for `codex-app-server`, `codex-exec-server`, or
  `codex_mcp_server`.
  - Short app-server RPCs such as `account/read`, `config/read`, and
    `getAuthStatus` often have only one or two spans. For full agent behavior,
    look for traces rooted at `turn/start`, `handle_responses`,
    `model_client.stream_responses_websocket`, or tool execution spans.
- Loki: inspect logs with `{service_name=~".*"}` or browse available labels.
- Prometheus/Mimir: inspect Tempo span metrics such as
  `traces_spanmetrics_calls_total` and collector metrics such as
  `otelcol_receiver_accepted_spans_total`. App-authored `codex_*` Prometheus
  metrics may not be present in every local stack.

Browser verification checklist:

- Open http://localhost:3000/d/codex-control-room/codex-control-room.
- Confirm the time picker shows `CST`/Asia-Shanghai time.
- Confirm the first row has non-empty Codex service/span/log stats.
- Confirm the trace table shows recent Codex spans and Trace ID links.
- Confirm the event stream shows structured Codex events such as
  `codex.websocket_request`, `codex.tool_result`, or `codex.sse_event`.

Stop the stack:

```sh
docker compose down
```
