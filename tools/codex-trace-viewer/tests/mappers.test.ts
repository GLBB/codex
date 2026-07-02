import { describe, expect, it } from "vitest";
import { buildAgentGraph, buildStatsSummary, buildThreadTree, buildTimeline, buildTraceSummary, searchTrace } from "../shared/mappers";
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
        conversationItems: 3,
        inferences: 1,
        toolCalls: 1,
        codeCells: 1,
        terminalOperations: 1,
        compactions: 1,
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
    const timeline = buildTimeline(sampleTrace());
    expect(timeline.map((node) => `${node.type}:${node.id}`)).toEqual([
      "session:trace-1",
      "thread:thread-root",
      "turn:turn1",
      "conversation:item-user",
      "inference:inf1",
      "thread:thread-child",
      "tool:tool1",
      "terminal:term1",
      "code_cell:cell1",
      "reasoning:item-reasoning",
      "conversation:item-assistant",
      "compaction:compaction1",
      "agent_edge:edge1"
    ]);
    expect(timeline.find((node) => node.id === "inf1")).toMatchObject({
      durationMs: 600,
      model: "gpt-5"
    });
    expect(timeline.find((node) => node.id === "tool1")).toMatchObject({
      durationMs: 100,
      toolName: "mcp:github/search"
    });
    expect(timeline.find((node) => node.id === "cell1")).toMatchObject({
      durationMs: 100,
      relatedIds: ["term1"]
    });
    expect(timeline.find((node) => node.id === "item-reasoning")).toMatchObject({
      type: "reasoning",
      label: "Reasoning: reasoning_summary",
      summary: "先定位关键节点，再检查工具调用。"
    });
  });

  it("filters timeline by thread and searches model-visible ids", () => {
    expect(buildTimeline(sampleTrace(), "thread-child").map((node) => node.id)).toEqual(["thread-child", "edge1"]);
    expect(searchTrace(sampleTrace(), "call_search").map((node) => node.id)).toEqual(["tool1"]);
  });

  it("builds agent graph nodes and interaction edges", () => {
    expect(buildAgentGraph(sampleTrace())).toEqual({
      rootThreadId: "thread-root",
      nodes: [
        {
          id: "thread-root",
          label: "main",
          parentId: undefined,
          model: "gpt-5",
          status: "running",
          startedAtUnixMs: 1000,
          endedAtUnixMs: undefined
        },
        {
          id: "thread-child",
          label: "worker",
          parentId: "thread-root",
          model: "gpt-5-mini",
          status: "completed",
          startedAtUnixMs: 1500,
          endedAtUnixMs: 2200
        }
      ],
      edges: [
        {
          id: "origin:thread-root:thread-child",
          edgeType: "spawn",
          sourceThreadId: "thread-root",
          targetThreadId: "thread-child",
          label: "spawn"
        },
        {
          id: "edge1",
          edgeType: "delegates",
          sourceThreadId: "thread-root",
          targetThreadId: "thread-child",
          label: "delegates",
          relatedTimelineNodeId: "edge1",
          rawPayloadRefs: []
        }
      ]
    });
  });

  it("aggregates stats from timings, tokens, and child threads", () => {
    const trace = sampleTrace();
    expect(buildStatsSummary(trace)).toEqual({
      totalDurationMs: undefined,
      turns: { count: 1, totalMs: 1000, maxMs: 1000 },
      inferences: { count: 1, totalMs: 600, maxMs: 600 },
      tools: { count: 1, totalMs: 100, maxMs: 100 },
      codeCells: { count: 1, totalMs: 100, maxMs: 100 },
      terminalOperations: { count: 1, totalMs: 90, maxMs: 90 },
      tokens: {
        inputTokens: 120,
        cachedInputTokens: 0,
        outputTokens: 40,
        reasoningOutputTokens: 0
      },
      tokenUsageByInference: [
        {
          id: "inf1",
          turnId: "turn1",
          model: "gpt-5",
          inputTokens: 120,
          cachedInputTokens: 0,
          outputTokens: 40,
          reasoningOutputTokens: 0
        }
      ],
      tokenUsageByTurn: [
        {
          id: "turn1",
          inputTokens: 120,
          cachedInputTokens: 0,
          outputTokens: 40,
          reasoningOutputTokens: 0
        }
      ],
      failedToolCalls: 0,
      retryCount: 0,
      compactions: 1,
      childThreads: 1
    });
  });
});
