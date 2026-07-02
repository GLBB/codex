import { describe, expect, it } from "vitest";
import { buildThreadTree, buildTimeline, buildTraceSummary, searchTrace } from "../shared/mappers";
import { sampleTrace } from "./fixtures";

describe("trace mappers", () => {
  it("builds summary counts from rollout trace state", () => {
    expect(buildTraceSummary(sampleTrace())).toEqual({
      traceId: "trace-1",
      rolloutId: "rollout-1",
      rootThreadId: "thread-root",
      status: "running",
      startedAtUnixMs: 1000,
      endedAtUnixMs: undefined,
      counts: {
        threads: 2,
        turns: 1,
        conversationItems: 2,
        inferences: 1,
        toolCalls: 1,
        terminalOperations: 0,
        compactions: 0,
        interactionEdges: 1
      }
    });
  });

  it("keeps child agents under their parent thread", () => {
    expect(buildThreadTree(sampleTrace())).toEqual([
      {
        id: "thread-root",
        label: "main",
        model: "gpt-5",
        status: "running",
        children: [
          {
            id: "thread-child",
            label: "worker",
            model: "gpt-5-mini",
            status: "completed",
            children: []
          }
        ]
      }
    ]);
  });

  it("builds a time ordered business timeline", () => {
    expect(buildTimeline(sampleTrace()).map((node) => `${node.type}:${node.id}`)).toEqual([
      "turn:turn1",
      "conversation:item-user",
      "inference:inf1",
      "tool:tool1",
      "conversation:item-assistant",
      "agent_edge:edge1"
    ]);
  });

  it("filters timeline by thread and searches model-visible ids", () => {
    expect(buildTimeline(sampleTrace(), "thread-child").map((node) => node.id)).toEqual(["edge1"]);
    expect(searchTrace(sampleTrace(), "call_search").map((node) => node.id)).toEqual(["tool1"]);
  });
});
