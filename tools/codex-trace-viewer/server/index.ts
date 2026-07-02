import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createReadStream, existsSync } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { BundleStore } from "./bundle-store.js";
import type { BundleSummary } from "../shared/types.js";

interface CliOptions {
  bundlePath?: string;
  traceRoot?: string;
  port: number;
  autoReduce: boolean;
}

function parseArgs(argv: string[]): CliOptions {
  let bundlePath: string | undefined;
  let traceRoot: string | undefined;
  let port = 0;
  let autoReduce = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--bundle") {
      bundlePath = argv[++i] ?? "";
    } else if (arg === "--trace-root") {
      traceRoot = argv[++i] ?? "";
    } else if (arg === "--port") {
      port = Number(argv[++i] ?? "0");
    } else if (arg === "--auto-reduce") {
      autoReduce = true;
    }
  }
  if (!bundlePath && !traceRoot) {
    throw new Error("Usage: npm run serve -- --bundle <trace-bundle> | --trace-root <root> [--port 0] [--auto-reduce]");
  }
  return { bundlePath, traceRoot, port, autoReduce };
}

function sendJson(res: ServerResponse, value: unknown, status = 200): void {
  const body = JSON.stringify(value);
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-length": Buffer.byteLength(body)
  });
  res.end(body);
}

function sendError(res: ServerResponse, error: unknown, status = 500): void {
  sendJson(
    res,
    {
      error: error instanceof Error ? error.message : String(error)
    },
    status
  );
}

function pathname(req: IncomingMessage): string {
  return new URL(req.url ?? "/", "http://127.0.0.1").pathname;
}

function query(req: IncomingMessage, key: string): string | undefined {
  return new URL(req.url ?? "/", "http://127.0.0.1").searchParams.get(key) ?? undefined;
}

async function fileExists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false
  );
}

async function isTraceBundle(dir: string): Promise<boolean> {
  return (await fileExists(path.join(dir, "manifest.json"))) && (await fileExists(path.join(dir, "trace.jsonl")));
}

async function findTraceBundles(root: string): Promise<string[]> {
  const found: Array<{ bundlePath: string; updatedAtUnixMs: number }> = [];
  async function walk(dir: string): Promise<void> {
    if (await isTraceBundle(dir)) {
      const info = await stat(path.join(dir, "trace.jsonl"));
      found.push({ bundlePath: dir, updatedAtUnixMs: info.mtimeMs });
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    await Promise.all(entries.filter((entry) => entry.isDirectory()).map((entry) => walk(path.join(dir, entry.name))));
  }
  await walk(root);
  return found.sort((a, b) => b.updatedAtUnixMs - a.updatedAtUnixMs).map((item) => item.bundlePath);
}

function bundleId(bundlePath: string): string {
  return Buffer.from(path.resolve(bundlePath)).toString("base64url");
}

async function bundleSummary(bundlePath: string, activeId: string): Promise<BundleSummary> {
  const info = await stat(path.join(bundlePath, "trace.jsonl")).catch(() => null);
  return {
    id: bundleId(bundlePath),
    path: bundlePath,
    label: path.basename(bundlePath),
    updatedAtUnixMs: info?.mtimeMs,
    active: bundleId(bundlePath) === activeId
  };
}

function serveStatic(req: IncomingMessage, res: ServerResponse): boolean {
  const distRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../web");
  const requested = pathname(req) === "/" ? "/index.html" : pathname(req);
  const candidate = path.resolve(distRoot, `.${requested}`);
  const relative = path.relative(distRoot, candidate);
  const filePath =
    !relative.startsWith("..") && !path.isAbsolute(relative) && existsSync(candidate)
      ? candidate
      : path.join(distRoot, "index.html");
  if (!existsSync(filePath)) {
    return false;
  }
  const ext = path.extname(filePath);
  const contentType =
    ext === ".html"
      ? "text/html; charset=utf-8"
      : ext === ".js"
        ? "text/javascript; charset=utf-8"
        : ext === ".css"
          ? "text/css; charset=utf-8"
          : "application/octet-stream";
  res.writeHead(200, { "content-type": contentType });
  createReadStream(filePath).pipe(res);
  return true;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const traceRoot = options.traceRoot ? path.resolve(options.traceRoot) : undefined;
  let bundlePaths = options.bundlePath
    ? [path.resolve(options.bundlePath)]
    : traceRoot
      ? await findTraceBundles(traceRoot)
      : [];
  if (bundlePaths.length === 0) {
    throw new Error(`no trace bundles found${traceRoot ? ` in ${traceRoot}` : ""}`);
  }
  let store = new BundleStore({
    bundlePath: bundlePaths[0],
    autoReduce: options.autoReduce
  });
  await store.load();

  const clients = new Set<ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    for (const client of clients) {
      client.write(`event: ${event}\n`);
      client.write(`data: ${JSON.stringify(data)}\n\n`);
    }
  };

  const listBundles = async () => Promise.all(bundlePaths.map((item) => bundleSummary(item, bundleId(store.bundlePath))));

  const selectBundle = async (id: string) => {
    const selected = bundlePaths.find((item) => bundleId(item) === id);
    if (!selected) {
      throw new Error(`bundle not found: ${id}`);
    }
    store = new BundleStore({
      bundlePath: selected,
      autoReduce: options.autoReduce
    });
    await store.load();
    broadcast("bundle_selected", { bundle: await bundleSummary(selected, bundleId(store.bundlePath)), summary: store.summary() });
  };

  let reloadTimer: NodeJS.Timeout | null = null;
  const scheduleReload = () => {
    if (reloadTimer) {
      clearTimeout(reloadTimer);
    }
    reloadTimer = setTimeout(async () => {
      try {
        if (await store.reloadIfChanged()) {
          broadcast("trace_updated", { summary: store.summary() });
        }
      } catch (error) {
        broadcast("trace_error", {
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }, 150);
  };
  const pollTimer = setInterval(scheduleReload, 1000);
  pollTimer.unref();
  const bundlePollTimer = traceRoot
    ? setInterval(async () => {
        const discovered = await findTraceBundles(traceRoot);
        const known = new Set(bundlePaths);
        const added = discovered.filter((item) => !known.has(item));
        if (added.length > 0) {
          bundlePaths = discovered;
          broadcast("bundles_updated", { bundles: await listBundles(), added });
        }
      }, 2000)
    : undefined;
  bundlePollTimer?.unref();

  const server = createServer(async (req, res) => {
    try {
      const pathName = pathname(req);
      if (pathName === "/api/watch") {
        res.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache",
          connection: "keep-alive"
        });
        res.write(`event: connected\n`);
        res.write(`data: ${JSON.stringify({ summary: store.summary() })}\n\n`);
        clients.add(res);
        req.on("close", () => clients.delete(res));
        return;
      }
      if (pathName === "/api/bundles") {
        sendJson(res, await listBundles());
        return;
      }
      if (pathName === "/api/bundles/select") {
        await selectBundle(query(req, "id") ?? "");
        sendJson(res, { summary: store.summary(), bundles: await listBundles() });
        return;
      }
      if (pathName === "/api/trace") {
        sendJson(res, store.summary());
        return;
      }
      if (pathName === "/api/threads") {
        sendJson(res, store.threads());
        return;
      }
      if (pathName.startsWith("/api/threads/") && pathName.endsWith("/timeline")) {
        const threadId = decodeURIComponent(pathName.split("/")[3] ?? "");
        sendJson(res, store.timeline(threadId));
        return;
      }
      if (pathName === "/api/timeline") {
        sendJson(res, store.timeline(query(req, "threadId")));
        return;
      }
      if (pathName.startsWith("/api/turns/")) {
        sendJson(res, store.turn(decodeURIComponent(pathName.split("/")[3] ?? "")));
        return;
      }
      if (pathName.startsWith("/api/inferences/") && pathName.endsWith("/prompt")) {
        const id = decodeURIComponent(pathName.split("/")[3] ?? "");
        sendJson(res, await store.prompt(id));
        return;
      }
      if (pathName.startsWith("/api/inferences/")) {
        sendJson(res, store.inference(decodeURIComponent(pathName.split("/")[3] ?? "")));
        return;
      }
      if (pathName.startsWith("/api/tools/")) {
        sendJson(res, store.tool(decodeURIComponent(pathName.split("/")[3] ?? "")));
        return;
      }
      if (pathName.startsWith("/api/payloads/")) {
        sendJson(res, await store.payload(decodeURIComponent(pathName.split("/")[3] ?? "")));
        return;
      }
      if (pathName === "/api/search") {
        sendJson(res, store.search(query(req, "q") ?? ""));
        return;
      }
      if (!serveStatic(req, res)) {
        sendError(res, "not found", 404);
      }
    } catch (error) {
      sendError(res, error);
    }
  });

  server.listen(options.port, "127.0.0.1", () => {
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : options.port;
    console.log(`Codex Trace Viewer: http://127.0.0.1:${port}`);
  });
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
