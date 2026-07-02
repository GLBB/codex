import { describe, expect, it } from "vitest";
import { buildPromptView } from "../shared/prompt";
import { sampleTrace, sampleWireRequest } from "./fixtures";

describe("prompt view", () => {
  it("splits a wire request into business prompt sections", () => {
    const inference = sampleTrace().inference_calls?.inf1;
    if (!inference) {
      throw new Error("missing fixture inference");
    }

    expect(buildPromptView(inference, sampleWireRequest()).sections.map((section) => section.source)).toEqual([
      "request",
      "base_instructions",
      "conversation_history.user",
      "conversation_history.assistant",
      "conversation_history.tool",
      "current_query",
      "tool_registry",
      "request.text"
    ]);
    expect(buildPromptView(inference, sampleWireRequest()).sections[0].estimatedTokens).toBeGreaterThan(0);
    expect(buildPromptView(inference, sampleWireRequest()).sections.find((section) => section.source === "current_query")).toMatchObject({
      relatedTimelineNodeId: "item-user"
    });
  });

  it("classifies developer diagnostics sources when present in request input", () => {
    const inference = sampleTrace().inference_calls?.inf1;
    if (!inference) {
      throw new Error("missing fixture inference");
    }

    const view = buildPromptView(inference, {
      input: [
        { role: "developer", content: "AGENTS.md says run just fmt" },
        { role: "developer", content: "Permission and sandbox instructions" },
        { role: "developer", content: "<environment_context><cwd>/repo</cwd></environment_context>" },
        { role: "developer", content: "<collaboration_mode>Default</collaboration_mode>" },
        { role: "developer", content: "Install a requested plugin or connector only when asked" },
        { role: "developer", content: "Skill instructions" },
        { role: "developer", content: "Tools are grouped by namespace" },
        { role: "user", content: "当前问题" }
      ]
    });
    expect(view.sections.map((section) => section.source)).toEqual([
      "request",
      "AGENTS.md",
      "permissions",
      "environment_context",
      "collaboration_mode",
      "plugins",
      "skills",
      "tool_runtime",
      "current_query"
    ]);
  });
});
