import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { cp, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { expect, test } from "@playwright/test";

async function copyDemoBundle(target: string): Promise<void> {
  await cp(path.join(process.cwd(), "examples/demo-bundle"), target, { recursive: true });
}

async function appendLiveConversation(bundle: string): Promise<void> {
  const statePath = path.join(bundle, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    conversation_items: Record<string, unknown>;
  };
  state.conversation_items["item-live"] = {
    item_id: "item-live",
    thread_id: "thread-root",
    codex_turn_id: "turn-1",
    first_seen_at_unix_ms: Date.now(),
    role: "assistant",
    kind: "message",
    body: {
      parts: [{ type: "output_text", text: "live assistant update from e2e" }]
    }
  };
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");
}

async function makeFailureAndLargePromptBundle(bundle: string): Promise<void> {
  const statePath = path.join(bundle, "state.json");
  const state = JSON.parse(await readFile(statePath, "utf8")) as {
    codex_turns: Record<string, { execution?: { status?: string } }>;
    tool_calls: Record<string, { execution?: { status?: string } }>;
  };
  state.codex_turns["turn-1"].execution = {
    ...state.codex_turns["turn-1"].execution,
    status: "aborted"
  };
  state.tool_calls["tool-1"].execution = {
    ...state.tool_calls["tool-1"].execution,
    status: "failed"
  };
  await writeFile(statePath, JSON.stringify(state, null, 2), "utf8");

  const requestPath = path.join(bundle, "payloads/request-1.json");
  const request = JSON.parse(await readFile(requestPath, "utf8")) as { instructions?: string };
  request.instructions = `large prompt marker\n${"x".repeat(120_000)}`;
  await writeFile(requestPath, JSON.stringify(request, null, 2), "utf8");
}

async function startViewer(args: string[]): Promise<{ child: ChildProcessWithoutNullStreams; url: string }> {
  const child = spawn(process.execPath, ["dist/server/index.js", ...args], {
    cwd: process.cwd()
  });
  let stdout = "";
  let stderr = "";
  const url = await new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      reject(new Error(`server did not print a URL\nstdout: ${stdout}\nstderr: ${stderr}`));
    }, 10_000);
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
      const match = stdout.match(/http:\/\/127\.0\.0\.1:\d+/);
      if (match) {
        clearTimeout(timeout);
        resolve(match[0]);
      }
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("exit", (code) => {
      if (!stdout.includes("Codex Trace Viewer")) {
        clearTimeout(timeout);
        reject(new Error(`server exited early with ${code}\nstdout: ${stdout}\nstderr: ${stderr}`));
      }
    });
  });
  return { child, url };
}

async function stopViewer(child: ChildProcessWithoutNullStreams): Promise<void> {
  if (child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    child.once("exit", () => resolve());
    setTimeout(resolve, 2_000);
  });
}

test("live updates active bundles and discovers new trace bundles", async ({ page }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-trace-viewer-live-"));
  const bundleA = path.join(root, "bundle-a");
  const bundleB = path.join(root, "bundle-b");
  await copyDemoBundle(bundleA);
  const { child, url } = await startViewer(["--trace-root", root, "--port", "0"]);

  try {
    await page.goto(url);
    await expect(page.getByText("Tool: mcp:github/search")).toBeVisible();

    await appendLiveConversation(bundleA);
    await expect(page.getByText("live assistant update from e2e")).toBeVisible({ timeout: 5_000 });
    await expect(page.locator(".timelineNode.fresh").filter({ hasText: "live assistant update from e2e" })).toBeVisible();

    await copyDemoBundle(bundleB);
    await expect(page.getByRole("button", { name: /bundle-b/ })).toBeVisible({ timeout: 6_000 });
  } finally {
    await stopViewer(child);
    await rm(root, { recursive: true, force: true });
  }
});

test("renders failed operations and keeps large prompt sections collapsed", async ({ page }) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "codex-trace-viewer-failure-"));
  const bundle = path.join(root, "bundle-failed");
  await copyDemoBundle(bundle);
  await makeFailureAndLargePromptBundle(bundle);
  const { child, url } = await startViewer(["--bundle", bundle, "--port", "0"]);

  try {
    await page.goto(url);
    await expect(page.getByText("failed").first()).toBeVisible();

    await page.getByText("Model Call: gpt-5").click();
    await page.getByRole("button", { name: "查看完整 Prompt" }).click();
    const largeSection = page.locator("details").filter({ hasText: "System / Base Instructions" });
    await expect(largeSection).toBeVisible();
    await expect.poll(() => largeSection.evaluate((node) => (node as HTMLDetailsElement).open)).toBe(false);
    await largeSection.click();
    await expect(largeSection.locator("pre").getByText("large prompt marker")).toBeVisible();
  } finally {
    await stopViewer(child);
    await rm(root, { recursive: true, force: true });
  }
});
