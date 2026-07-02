import { expect, test } from "@playwright/test";

test("opens demo bundle and inspects core trace surfaces", async ({ page }) => {
  const requests: string[] = [];
  page.on("request", (request) => {
    requests.push(request.url());
  });

  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Codex Trace Viewer" })).toBeVisible();
  await expect(page.getByText("thread-root").first()).toBeVisible();
  await expect(page.getByText("Tool: mcp:github/search")).toBeVisible();

  await page.getByText("Model Call: gpt-5").click();
  await page.getByRole("button", { name: "查看完整 Prompt" }).click();
  await expect(page.getByRole("heading", { name: "Wire Request" })).toBeVisible();
  await expect(page.getByText("Current User Query")).toBeVisible();
  await expect(page.getByText("Tool Definition: shell")).toBeVisible();

  await page.getByPlaceholder("在当前 Prompt 中搜索").fill("shell");
  await expect(page.getByText("Tool Definition: shell")).toBeVisible();

  await page.getByRole("button", { name: "timeline" }).click();
  await page.getByPlaceholder("搜索 call_id / 文本").fill("call_github_search");
  await page.getByRole("button", { name: "搜索" }).click();
  await expect(page.getByText("Tool: mcp:github/search")).toBeVisible();

  await page.getByText("Tool: mcp:github/search").click();
  await page.getByText("payload-tool-result-1").click();
  await expect(page.getByRole("button", { name: "Copy payload JSON" })).toBeVisible();
  await expect(page.getByText("找到 trace viewer 相关方案")).toBeVisible();

  await page.getByRole("button", { name: "agent", exact: true }).click();
  const agentGraph = page.locator(".agentGraph");
  await expect(agentGraph.getByText("research-agent").first()).toBeVisible();
  await expect(agentGraph.getByText("spawn_agent")).toBeVisible();

  await page.getByRole("button", { name: "stats", exact: true }).click();
  await expect(page.getByText("input tokens")).toBeVisible();
  await expect(page.getByText("child threads")).toBeVisible();
  await expect(page.getByText("Tokens By Inference")).toBeVisible();
  await expect(page.getByText("Tokens By Turn")).toBeVisible();

  const nonLocalRequests = requests.filter((url) => !url.startsWith("http://127.0.0.1:4174"));
  expect(nonLocalRequests).toEqual([]);
});
