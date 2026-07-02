import { spawn } from "node:child_process";
import { mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildTimeline, buildTraceSummary, buildThreadTree } from "../shared/mappers.js";
import { buildPromptView } from "../shared/prompt.js";
import type { InferenceCall, RolloutTrace } from "../shared/types.js";

interface Options {
  bundles: string[];
  traceRoot?: string;
  codexCommand: string;
  limit: number;
}

function parseArgs(argv: string[]): Options {
  const options: Options = {
    bundles: [],
    codexCommand: "codex",
    limit: 5
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--bundle") {
      options.bundles.push(argv[++index] ?? "");
    } else if (arg === "--trace-root") {
      options.traceRoot = argv[++index];
    } else if (arg === "--codex") {
      options.codexCommand = argv[++index] ?? "codex";
    } else if (arg === "--limit") {
      options.limit = Number(argv[++index] ?? "5");
    }
  }
  return options;
}

async function exists(filePath: string): Promise<boolean> {
  return stat(filePath).then(
    () => true,
    () => false
  );
}

async function isTraceBundle(dir: string): Promise<boolean> {
  return (await exists(path.join(dir, "manifest.json"))) && (await exists(path.join(dir, "trace.jsonl")));
}

async function findBundles(root: string): Promise<string[]> {
  const found: Array<{ dir: string; mtimeMs: number }> = [];
  async function walk(dir: string): Promise<void> {
    if (await isTraceBundle(dir)) {
      const info = await stat(path.join(dir, "trace.jsonl"));
      found.push({ dir, mtimeMs: info.mtimeMs });
      return;
    }
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    await Promise.all(
      entries
        .filter((entry) => entry.isDirectory())
        .map((entry) => walk(path.join(dir, entry.name)))
    );
  }
  await walk(root);
  return found.sort((a, b) => b.mtimeMs - a.mtimeMs).map((item) => item.dir);
}

async function runCodexTraceReduce(codexCommand: string, bundle: string, output: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(codexCommand, ["debug", "trace-reduce", bundle, "--output", output], {
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) {
        resolve();
      } else {
        reject(new Error(`${codexCommand} debug trace-reduce failed with code ${code}: ${stderr}`));
      }
    });
  });
}

function firstInferenceWithRequest(trace: RolloutTrace): InferenceCall | undefined {
  return Object.values(trace.inference_calls ?? {}).find((inference) => Boolean(inference.raw_request_payload_id));
}

async function readPayload(bundle: string, trace: RolloutTrace, payloadId: string): Promise<unknown> {
  const payload = trace.raw_payloads?.[payloadId];
  if (!payload) {
    throw new Error(`raw payload ref not found in reduced state: ${payloadId}`);
  }
  const payloadPath = path.resolve(bundle, payload.path);
  const relative = path.relative(bundle, payloadPath);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new Error(`raw payload escapes bundle root: ${payload.path}`);
  }
  return JSON.parse(await readFile(payloadPath, "utf8"));
}

async function validateBundle(options: Options, bundle: string) {
  if (!(await isTraceBundle(bundle))) {
    throw new Error(`不是 rollout trace bundle，缺少 manifest.json 或 trace.jsonl: ${bundle}`);
  }

  const temp = await mkdtemp(path.join(os.tmpdir(), "codex-trace-viewer-"));
  try {
    const reducedState = path.join(temp, "state.json");
    await runCodexTraceReduce(options.codexCommand, bundle, reducedState);
    const trace = JSON.parse(await readFile(reducedState, "utf8")) as RolloutTrace;
    const summary = buildTraceSummary(trace);
    const threads = buildThreadTree(trace);
    const timeline = buildTimeline(trace);

    if (summary.counts.threads === 0 || threads.length === 0) {
      throw new Error("真实 trace reduce 后没有 thread，无法验证 viewer thread 视图。");
    }
    if (timeline.length === 0) {
      throw new Error("真实 trace reduce 后 timeline 为空，无法验证业务流程视图。");
    }

    const inference = firstInferenceWithRequest(trace);
    let promptSections = 0;
    if (inference?.raw_request_payload_id) {
      const request = await readPayload(bundle, trace, inference.raw_request_payload_id);
      promptSections = buildPromptView(inference, request).sections.length;
      if (promptSections === 0) {
        throw new Error("真实 inference request 没有生成任何 prompt section。");
      }
    }

    return {
      bundle,
      traceId: summary.traceId,
      rolloutId: summary.rolloutId,
      counts: summary.counts,
      timelineNodes: timeline.length,
      promptSections
    };
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const traceRoot = options.traceRoot ?? process.env.CODEX_ROLLOUT_TRACE_ROOT;
  const bundles =
    options.bundles.length > 0
      ? options.bundles.map((item) => path.resolve(item))
      : traceRoot
        ? (await findBundles(path.resolve(traceRoot))).slice(0, options.limit)
        : [];

  if (bundles.length === 0) {
    throw new Error(
      "未找到真实 Codex trace bundle。请传入一个或多个 --bundle <dir>，或设置 CODEX_ROLLOUT_TRACE_ROOT 后重新运行。"
    );
  }

  const results = [];
  for (const bundle of bundles) {
    results.push(await validateBundle(options, bundle));
  }
  console.log(JSON.stringify({ validated: results.length, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
