# Local SkyWalking OTEL Stack

This is a side-by-side proof of concept for viewing Codex OpenTelemetry data in
Apache SkyWalking instead of Grafana LGTM.

It runs:

- BanyanDB storage
- SkyWalking OAP backend
- OpenTelemetry Collector bridge
- SkyWalking UI

Ports:

- SkyWalking UI: http://localhost:8088
- OAP OTLP/gRPC receiver: `localhost:11800`
- OAP HTTP query/API endpoint: `localhost:12800`
- OAP Zipkin-compatible query API endpoint: `localhost:9412`
- Collector OTLP/gRPC receiver: `localhost:14317`
- Collector OTLP/HTTP receiver: `localhost:14318`
- BanyanDB UI/API: http://localhost:17913

Start it from this directory:

```sh
docker compose up -d
```

This POC pins a compatible SkyWalking 10.2.0 / BanyanDB 0.8.0 combination.
Avoid `latest` for this stack: current OAP development images may require a
newer BanyanDB API than the latest released BanyanDB image exposes.

If image pulls are slow or unavailable, copy `.env.example` to `.env` and
change the image names for your mirror, or pull through a proxy-aware user
space tool such as `crane`, then load the image into Docker:

```sh
GOBIN=/tmp/codex-bin go install github.com/google/go-containerregistry/cmd/crane@v0.19.2
/tmp/codex-bin/crane pull docker.io/apache/skywalking-oap-server:10.2.0 /tmp/skywalking-oap.tar
docker load -i /tmp/skywalking-oap.tar
```

OAP can take 1-2 minutes to become healthy while it initializes BanyanDB
schemas.

Point Codex at the collector's OTLP/HTTP receiver. The collector forwards to
SkyWalking OAP over OTLP/gRPC:

```toml
[otel]
environment = "dev"
exporter = { otlp-http = { endpoint = "http://127.0.0.1:14318/v1/logs", protocol = "binary" } }
trace_exporter = { otlp-http = { endpoint = "http://127.0.0.1:14318/v1/traces", protocol = "binary" } }
metrics_exporter = { otlp-http = { endpoint = "http://127.0.0.1:14318/v1/metrics", protocol = "binary" } }
log_user_prompt = false
```

For a one-off smoke test without changing `~/.codex/config.toml`:

```sh
codex exec --ephemeral --dangerously-bypass-approvals-and-sandbox \
  -c 'analytics_enabled=true' \
  -c 'otel.environment="skywalking-demo"' \
  -c 'otel.exporter={ otlp-http = { endpoint = "http://127.0.0.1:14318/v1/logs", protocol = "binary" } }' \
  -c 'otel.trace_exporter={ otlp-http = { endpoint = "http://127.0.0.1:14318/v1/traces", protocol = "binary" } }' \
  -c 'otel.metrics_exporter={ otlp-http = { endpoint = "http://127.0.0.1:14318/v1/metrics", protocol = "binary" } }' \
  'Reply exactly: skywalking codex telemetry ok'
```

In SkyWalking UI, start with:

- Services / topology for `codex_vscode`, `codex-app-server`, or the
  Codex originator service name in your run.
- Logs for OTLP log records.

Current limitations:

- Codex OTLP traces are ingested, but in SkyWalking 10.2 they are exposed
  reliably through the Zipkin-compatible API rather than the main SkyWalking
  trace search UI.
- Codex log records are ingested. SkyWalking stores the useful event fields as
  log tags, while the text `content` field may be empty.
- Codex custom OTLP metrics do not become useful SkyWalking UI charts by
  default. They need SkyWalking meter analysis rules before they show up as
  first-class metrics.

For OTLP trace details, use SkyWalking's Zipkin-compatible API. The root
`/zipkin/` path is not a browser UI in this image:

```sh
curl http://127.0.0.1:9412/zipkin/api/v2/services
curl 'http://127.0.0.1:9412/zipkin/api/v2/spans?serviceName=codex_vscode'
curl 'http://127.0.0.1:9412/zipkin/api/v2/traces?serviceName=codex_vscode&limit=5'
```

Notes:

- SkyWalking 10.2 receives OTLP over gRPC on OAP `11800`. This POC includes an
  OpenTelemetry Collector so Codex can keep using OTLP/HTTP.
- `SW_RECEIVER_ZIPKIN=default` is enabled because SkyWalking's OTLP trace
  handler stores OpenTelemetry trace traffic through its Zipkin analysis path.
- `SW_QUERY_ZIPKIN=default` is enabled so those OTLP traces can be queried
  through SkyWalking's Zipkin-compatible API on `9412`.
- Custom OTLP metrics often need SkyWalking metric analysis rules before they
  become useful built-in UI widgets. This POC is primarily to compare trace/log
  exploration and the built-in APM experience against Grafana LGTM.

Stop it:

```sh
docker compose down
```

Remove stored data:

```sh
docker compose down -v
```
