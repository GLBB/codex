import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { InferenceCall, RolloutTrace } from "../shared/types.js";
import { buildPromptView } from "../shared/prompt.js";
import { buildThreadTree, buildTimeline, buildTraceSummary, searchTrace } from "../shared/mappers.js";

export interface BundleStoreOptions {
  bundlePath: string;
  autoReduce: boolean;
}

export class BundleStore {
  readonly bundlePath: string;
  readonly autoReduce: boolean;
  private trace: RolloutTrace | null = null;
  private stateMtimeMs = 0;

  constructor(options: BundleStoreOptions) {
    this.bundlePath = path.resolve(options.bundlePath);
    this.autoReduce = options.autoReduce;
  }

  statePath(): string {
    return path.join(this.bundlePath, "state.json");
  }

  async load(): Promise<RolloutTrace> {
    await this.ensureState();
    const statePath = this.statePath();
    const [content, info] = await Promise.all([readFile(statePath, "utf8"), stat(statePath)]);
    this.stateMtimeMs = info.mtimeMs;
    this.trace = JSON.parse(content) as RolloutTrace;
    return this.trace;
  }

  async reloadIfChanged(): Promise<boolean> {
    const info = await stat(this.statePath()).catch(() => null);
    if (!info) {
      if (this.autoReduce) {
        await this.ensureState();
        await this.load();
        return true;
      }
      return false;
    }
    if (info.mtimeMs <= this.stateMtimeMs) {
      return false;
    }
    await this.load();
    return true;
  }

  getTrace(): RolloutTrace {
    if (!this.trace) {
      throw new Error("trace state has not been loaded");
    }
    return this.trace;
  }

  summary() {
    return {
      ...buildTraceSummary(this.getTrace()),
      bundlePath: this.bundlePath,
      statePath: this.statePath()
    };
  }

  threads() {
    return buildThreadTree(this.getTrace());
  }

  timeline(threadId?: string) {
    return buildTimeline(this.getTrace(), threadId);
  }

  search(query: string) {
    return searchTrace(this.getTrace(), query);
  }

  inference(id: string): InferenceCall {
    const inference = this.getTrace().inference_calls?.[id];
    if (!inference) {
      throw new Error(`inference not found: ${id}`);
    }
    return inference;
  }

  tool(id: string) {
    const tool = this.getTrace().tool_calls?.[id];
    if (!tool) {
      throw new Error(`tool not found: ${id}`);
    }
    return tool;
  }

  turn(id: string) {
    const turn = this.getTrace().codex_turns?.[id];
    if (!turn) {
      throw new Error(`turn not found: ${id}`);
    }
    return turn;
  }

  async payload(id: string): Promise<unknown> {
    const payload = this.getTrace().raw_payloads?.[id];
    if (!payload) {
      throw new Error(`payload not found: ${id}`);
    }
    const payloadPath = path.resolve(this.bundlePath, payload.path);
    const relative = path.relative(this.bundlePath, payloadPath);
    if (relative.startsWith("..") || path.isAbsolute(relative)) {
      throw new Error(`payload path escapes bundle root: ${payload.path}`);
    }
    return JSON.parse(await readFile(payloadPath, "utf8"));
  }

  async prompt(inferenceId: string) {
    const inference = this.inference(inferenceId);
    if (!inference.raw_request_payload_id) {
      return buildPromptView(inference, {});
    }
    const request = await this.payload(inference.raw_request_payload_id);
    return buildPromptView(inference, request);
  }

  private async ensureState(): Promise<void> {
    const exists = await stat(this.statePath()).then(
      () => true,
      () => false
    );
    if (exists) {
      return;
    }
    if (!this.autoReduce) {
      throw new Error(`state.json not found in ${this.bundlePath}`);
    }
    await runTraceReduce(this.bundlePath);
  }
}

async function runTraceReduce(bundlePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn("codex", ["debug", "trace-reduce", bundlePath], {
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
        reject(new Error(`codex debug trace-reduce failed with code ${code}: ${stderr}`));
      }
    });
  });
}
