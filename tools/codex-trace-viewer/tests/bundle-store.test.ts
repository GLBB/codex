import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { BundleStore } from "../server/bundle-store";
import type { RolloutTrace } from "../shared/types";
import { sampleTrace } from "./fixtures";

const tempDirs: string[] = [];

async function makeBundle(trace: RolloutTrace): Promise<string> {
  const dir = await mkdtemp(path.join(os.tmpdir(), "codex-trace-viewer-test-"));
  tempDirs.push(dir);
  await mkdir(path.join(dir, "payloads"), { recursive: true });
  await writeFile(path.join(dir, "state.json"), JSON.stringify(trace), "utf8");
  return dir;
}

afterEach(async () => {
  await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })));
});

describe("BundleStore", () => {
  it("searches inference request payload content without eagerly exposing raw payloads", async () => {
    const trace = sampleTrace();
    const bundle = await makeBundle(trace);
    await writeFile(
      path.join(bundle, "payloads/request.json"),
      JSON.stringify({ input: [{ role: "user", content: "rare prompt needle" }] }),
      "utf8"
    );

    const store = new BundleStore({ bundlePath: bundle, autoReduce: false });
    await store.load();

    expect((await store.search("rare prompt needle")).map((node) => `${node.type}:${node.id}`)).toEqual(["inference:inf1"]);
  });

  it("rejects raw payload paths that escape the bundle root", async () => {
    const trace = sampleTrace();
    trace.raw_payloads = {
      bad: { raw_payload_id: "bad", path: "../secret.json" }
    };
    const bundle = await makeBundle(trace);
    const store = new BundleStore({ bundlePath: bundle, autoReduce: false });
    await store.load();

    await expect(store.payload("bad")).rejects.toThrow("payload path escapes bundle root");
  });
});
