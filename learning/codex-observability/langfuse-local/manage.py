#!/usr/bin/env python3
"""Run the local Langfuse experiment; secrets and results stay outside the repo."""

import argparse
import base64
import datetime
import json
import os
from pathlib import Path
import re
import selectors
import secrets
import shlex
import shutil
import subprocess
import time
import tomllib
import urllib.error
import urllib.parse
import urllib.request
import uuid

HERE = Path(__file__).resolve().parent
STATE = Path.home() / ".local/share/codex-observability/langfuse-local"
CODEX_DIR = Path(os.environ.get("CODEX_HOME", str(Path.home() / ".codex")))
BASE_URL = "http://127.0.0.1:3035"


def private_write(path, text):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    with os.fdopen(fd, "w") as file:
        file.write(text)
    path.chmod(0o600)


def settings():
    STATE.mkdir(parents=True, exist_ok=True, mode=0o700)
    STATE.chmod(0o700)
    env_file = STATE / ".env"
    if not env_file.exists():
        values = {
            name: secrets.token_hex(24)
            for name in [
                "POSTGRES_PASSWORD",
                "CLICKHOUSE_PASSWORD",
                "REDIS_PASSWORD",
                "MINIO_PASSWORD",
                "NEXTAUTH_SECRET",
                "SALT",
                "ADMIN_PASSWORD",
            ]
        }
        values["ENCRYPTION_KEY"] = secrets.token_hex(32)
        for prefix in ["OTEL", "PLUGIN"]:
            values[f"{prefix}_PUBLIC_KEY"] = f"pk-lf-{uuid.uuid4()}"
            values[f"{prefix}_SECRET_KEY"] = f"sk-lf-{uuid.uuid4()}"
        private_write(
            env_file, "".join(f"{key}={value}\n" for key, value in values.items())
        )
    return dict(
        line.split("=", 1) for line in env_file.read_text().splitlines() if line
    )


def docker(*args, capture=False):
    command = ["docker", *args]
    if not os.access("/var/run/docker.sock", os.W_OK) and shutil.which("sg"):
        command = ["sg", "docker", "-c", shlex.join(command)]
    return subprocess.run(command, check=True, text=True, capture_output=capture)


def compose(*args, capture=False):
    return docker(
        "compose",
        "--project-name",
        "codex-langfuse",
        "--env-file",
        str(STATE / ".env"),
        "-f",
        str(HERE / "compose.yaml"),
        *args,
        capture=capture,
    )


def api(prefix, path, values):
    credentials = f"{values[prefix + '_PUBLIC_KEY']}:{values[prefix + '_SECRET_KEY']}"
    header = "Basic " + base64.b64encode(credentials.encode()).decode()
    request = urllib.request.Request(BASE_URL + path, headers={"Authorization": header})
    with urllib.request.urlopen(request, timeout=30) as response:
        return json.load(response)


def bootstrap_plugin_project(values):
    try:
        api("PLUGIN", "/api/public/projects", values)
        return
    except urllib.error.HTTPError as error:
        if error.code not in [401, 403]:
            raise
    container = "codex-langfuse-plugin-bootstrap"
    # Reuse the official startup initialization with a second project, then stop it.
    compose("run", "-d", "--no-deps", "--name", container, "bootstrap", capture=True)
    try:
        deadline = time.monotonic() + 180
        while time.monotonic() < deadline:
            try:
                api("PLUGIN", "/api/public/projects", values)
                return
            except urllib.error.HTTPError as error:
                if error.code not in [401, 403]:
                    raise
            time.sleep(2)
        raise RuntimeError("Second project initialization timed out")
    finally:
        docker("stop", container, capture=True)
        docker("rm", container, capture=True)


def set_toml_key(text, table, key, value):
    header = f"[{table}]"
    lines = text.splitlines()
    if header not in lines:
        lines.extend(["", header, f"{key} = {value}"])
        return "\n".join(lines) + "\n"
    start = lines.index(header) + 1
    end = next(
        (i for i in range(start, len(lines)) if lines[i].lstrip().startswith("[")),
        len(lines),
    )
    found = [
        i for i in range(start, end) if re.match(rf"\s*{re.escape(key)}\s*=", lines[i])
    ]
    if found:
        lines[found[0]] = f"{key} = {value}"
    else:
        lines.insert(end, f"{key} = {value}")
    return "\n".join(lines) + "\n"


def configure(values):
    config = CODEX_DIR / "config.toml"
    original = config.read_text() if config.exists() else ""
    backup = STATE / "config.before-langfuse.toml"
    if not backup.exists():
        private_write(backup, original)
    old = tomllib.loads(original)
    auth = (
        "Basic "
        + base64.b64encode(
            f"{values['OTEL_PUBLIC_KEY']}:{values['OTEL_SECRET_KEY']}".encode()
        ).decode()
    )
    exporter = (
        '{ otlp-http = { endpoint = "' + BASE_URL + '/api/public/otel/v1/traces", '
    )
    exporter += 'protocol = "binary", headers = { Authorization = "' + auth
    exporter += '", "x-langfuse-ingestion-version" = "4" } } }'
    updated = set_toml_key(original, "otel", "trace_exporter", exporter)
    updated = set_toml_key(updated, "features", "hooks", "true")
    updated = set_toml_key(
        updated, 'plugins."tracing@codex-observability-plugin"', "enabled", "true"
    )
    new = tomllib.loads(updated)
    for key in ["exporter", "metrics_exporter"]:
        assert old.get("otel", {}).get(key) == new.get("otel", {}).get(key)
    private_write(config, updated)
    plugin_file = CODEX_DIR / "langfuse.json"
    if plugin_file.exists() and not (STATE / "langfuse.before.json").exists():
        private_write(STATE / "langfuse.before.json", plugin_file.read_text())
    private_write(
        plugin_file,
        json.dumps(
            {
                "enabled": True,
                "public_key": values["PLUGIN_PUBLIC_KEY"],
                "secret_key": values["PLUGIN_SECRET_KEY"],
                "base_url": BASE_URL,
                "environment": "codex-local",
                "user_id": "local-research",
                "tags": ["codex-session-plugin"],
            },
            indent=2,
        )
        + "\n",
    )
    print(f"Configured Codex; backup: {backup}. Hook trust must also be verified.")


def verify(values):
    now = datetime.datetime.now(datetime.timezone.utc)
    query = urllib.parse.urlencode(
        {
            "fromStartTime": (now - datetime.timedelta(days=1)).isoformat(),
            "toStartTime": now.isoformat(),
            "limit": 1000,
            "fields": "core,basic,usage,model,io,metadata,metrics,trace_context",
        }
    )
    result = {}
    for prefix in ["OTEL", "PLUGIN"]:
        project = api(prefix, "/api/public/projects", values)
        observations = api(prefix, "/api/public/v2/observations?" + query, values)
        private_write(
            STATE / f"{prefix.lower()}-observations.json",
            json.dumps(observations, indent=2),
        )
        rows = observations.get("data", [])
        result[prefix] = {
            "project": project,
            "observations_in_page": len(rows),
            "more_pages": bool(observations.get("meta", {}).get("cursor")),
            "types": sorted({row.get("type", "") for row in rows}),
            "names": sorted({row.get("name", "") for row in rows}),
            "trace_ids": sorted({row["traceId"] for row in rows}),
            "session_ids": sorted(
                {row["sessionId"] for row in rows if row.get("sessionId")}
            ),
        }
    private_write(STATE / "verification.json", json.dumps(result, indent=2))
    print(json.dumps(result, indent=2))


def trust_plugin():
    """Trust only the installed, reviewed Langfuse hook via Codex's config API."""
    with (STATE / "hook-review.stderr").open("w") as errors:
        process = subprocess.Popen(
            ["codex", "app-server", "--listen", "stdio://"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=errors,
            text=True,
            bufsize=1,
        )
        selector = selectors.DefaultSelector()
        selector.register(process.stdout, selectors.EVENT_READ)

        def request(identifier, method, params):
            process.stdin.write(
                json.dumps({"id": identifier, "method": method, "params": params})
                + "\n"
            )
            process.stdin.flush()
            deadline = time.monotonic() + 45
            while time.monotonic() < deadline:
                if not selector.select(timeout=1):
                    continue
                line = process.stdout.readline()
                if not line:
                    raise RuntimeError("Codex app-server closed before responding")
                response = json.loads(line)
                if response.get("id") == identifier:
                    if "error" in response:
                        raise RuntimeError(str(response["error"]))
                    return response["result"]
            raise TimeoutError(f"Codex {method} timed out")

        try:
            request(
                1,
                "initialize",
                {
                    "clientInfo": {"name": "langfuse_local_setup", "version": "1.0"},
                    "capabilities": {"experimentalApi": True},
                },
            )
            process.stdin.write(json.dumps({"method": "initialized"}) + "\n")
            process.stdin.flush()
            listing = request(2, "hooks/list", {"cwds": [str(HERE)]})
            hooks = [
                hook
                for entry in listing["data"]
                for hook in entry["hooks"]
                if hook.get("pluginId") == "tracing@codex-observability-plugin"
            ]
            if len(hooks) != 1:
                raise RuntimeError(f"Expected one Langfuse hook, found {len(hooks)}")
            hook = hooks[0]
            source = Path(hook["sourcePath"])
            expected = (
                CODEX_DIR
                / "plugins/cache/codex-observability-plugin/tracing/0.4.0/hooks/hooks.json"
            )
            reviewed_hash = "sha256:69a05cbfa6984ec5f1433343b45480d5239c119e7332ae863f9865edc2efec74"
            if (
                source.resolve() != expected.resolve()
                or hook["eventName"] != "stop"
                or hook["currentHash"] != reviewed_hash
            ):
                raise RuntimeError(
                    "Hook source or event changed; review it before trusting"
                )
            key = "hooks.state." + json.dumps(hook["key"])
            request(
                3,
                "config/batchWrite",
                {
                    "edits": [
                        {
                            "keyPath": key + ".trusted_hash",
                            "value": hook["currentHash"],
                            "mergeStrategy": "replace",
                        },
                        {
                            "keyPath": key + ".enabled",
                            "value": True,
                            "mergeStrategy": "replace",
                        },
                    ]
                },
            )
            private_write(STATE / "hook-review.json", json.dumps(hook, indent=2))
            print(f"Trusted reviewed hook {hook['key']} at {hook['currentHash']}")
        finally:
            selector.close()
            process.stdin.close()
            process.wait(timeout=20)
            process.stdout.close()
    (STATE / "hook-review.stderr").chmod(0o600)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "action",
        choices=[
            "init",
            "up",
            "configure",
            "trust-plugin",
            "verify",
            "status",
            "down",
            "show-login",
        ],
    )
    action = parser.parse_args().action
    values = settings()
    if action == "init":
        print(f"Private credentials initialized in {STATE}")
    elif action == "up":
        compose("up", "-d", "--wait", "--wait-timeout", "360")
        bootstrap_plugin_project(values)
        print(f"Langfuse ready at {BASE_URL}; both projects initialized")
    elif action == "configure":
        configure(values)
    elif action == "trust-plugin":
        trust_plugin()
    elif action == "verify":
        verify(values)
    elif action == "status":
        compose("ps")
    elif action == "down":
        compose("down")
    elif action == "show-login":
        print("Email: codex-local@example.test")
        print(f"Password: {values['ADMIN_PASSWORD']}")


if __name__ == "__main__":
    main()
