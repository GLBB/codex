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
      "instructions",
      "conversation_history.user",
      "conversation_history.assistant",
      "conversation_history.tool",
      "current_query",
      "tool_registry",
      "request.text"
    ]);
  });
});
