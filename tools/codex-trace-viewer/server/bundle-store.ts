import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { spawn } from "node:child_process";
import type { InferenceCall, RolloutTrace } from "../shared/types.js";
import { buildPromptView } from "../shared/prompt.js";
import { buildAgentGraph, buildStatsSummary, buildThreadTree, buildTimeline, buildTraceSummary, searchTrace } from "../shared/mappers.js";

export interface BundleStoreOptions {
  bundlePath: string;
  autoReduce: boolean;
  codexCommand?: string;
  codexArgsPrefix?: string[];
}

export class BundleStore {
  readonly bundlePath: string;
  readonly autoReduce: boolean;
  readonly codexCommand: string;
  readonly codexArgsPrefix: string[];
  private trace: RolloutTrace | null = null;
  private stateMtimeMs = 0;

  constructor(options: BundleStoreOptions) {
    this.bundlePath = path.resolve(options.bundlePath);
    this.autoReduce = options.autoReduce;
    this.codexCommand = options.codexCommand ?? "codex";
    this.codexArgsPrefix = options.codexArgsPrefix ?? [];
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

  async search(query: string) {
    const needle = query.trim().toLowerCase();
    if (!needle) {
      return [];
    }
    const trace = this.getTrace();
    const results = new Map<string, ReturnType<typeof buildTimeline>[number]>();
    for (const node of searchTrace(trace, query)) {
      results.set(`${node.type}:${node.id}`, node);
    }

    const timeline = buildTimeline(trace);
    const addMatchingRawPayloadNodes = (payloadId: string) => {
      for (const node of timeline) {
        if (node.rawPayloadRefs?.includes(payloadId)) {
          results.set(`${node.type}:${node.id}`, node);
        }
      }
    };

    for (const [payloadId, payload] of Object.entries(trace.raw_payloads ?? {})) {
      if (`${payloadId} ${payload.path}`.toLowerCase().includes(needle)) {
        addMatchingRawPayloadNodes(payloadId);
      }
    }

    await Promise.all(
      Object.values(trace.inference_calls ?? {}).map(async (inference) => {
        const payloadId = inference.raw_request_payload_id;
        if (!payloadId) {
          return;
        }
        try {
          const payload = await this.payload(payloadId);
          if (JSON.stringify(payload).toLowerCase().includes(needle)) {
            const node = timeline.find((item) => item.type === "inference" && item.id === inference.inference_call_id);
            if (node) {
              results.set(`${node.type}:${node.id}`, node);
            }
          }
        } catch {
          addMatchingRawPayloadNodes(payloadId);
        }
      })
    );

    return [...results.values()];
  }

  agentGraph() {
    return buildAgentGraph(this.getTrace());
  }

  stats() {
    return buildStatsSummary(this.getTrace());
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

  codeCell(id: string) {
    const cell = this.getTrace().code_cells?.[id];
    if (!cell) {
      throw new Error(`code cell not found: ${id}`);
    }
    return cell;
  }

  terminal(id: string) {
    const terminal = this.getTrace().terminal_operations?.[id];
    if (!terminal) {
      throw new Error(`terminal operation not found: ${id}`);
    }
    return terminal;
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
    await runTraceReduce(this.codexCommand, this.codexArgsPrefix, this.bundlePath);
  }
}

async function runTraceReduce(codexCommand: string, codexArgsPrefix: string[], bundlePath: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(codexCommand, [...codexArgsPrefix, "debug", "trace-reduce", bundlePath], {
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
