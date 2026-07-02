import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { AgentGraphView, defaultFilters, filterTimeline, PromptInspector, RawPayload } from "../web/src/main";
import { buildAgentGraph, buildTimeline } from "../shared/mappers";
import { buildPromptView } from "../shared/prompt";
import { sampleTrace, sampleWireRequest } from "./fixtures";

describe("viewer UI", () => {
  it("filters timeline nodes by type, model, and failed status", () => {
    const filters = defaultFilters();
    filters.types = new Set(["inference"]);
    filters.model = "gpt-5";
    expect(filterTimeline(buildTimeline(sampleTrace()), filters).map((node) => node.id)).toEqual(["inf1"]);

    filters.failedOnly = true;
    expect(filterTimeline(buildTimeline(sampleTrace()), filters)).toEqual([]);
  });

  it("filters timeline nodes by thread, turn, and agent edge type", () => {
    const filters = defaultFilters();
    filters.thread = "thread-root";
    filters.turn = "turn1";
    expect(filterTimeline(buildTimeline(sampleTrace()), filters).map((node) => node.id)).toEqual([
      "turn1",
      "item-user",
      "inf1",
      "tool1",
      "term1",
      "cell1",
      "item-assistant"
    ]);

    const edgeFilters = defaultFilters();
    edgeFilters.types = new Set(["agent_edge"]);
    edgeFilters.agentEdge = "delegates";
    expect(filterTimeline(buildTimeline(sampleTrace()), edgeFilters).map((node) => node.id)).toEqual(["edge1"]);
  });

  it("searches and copies prompt sections", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText }
    });
    const inference = sampleTrace().inference_calls?.inf1;
    if (!inference) {
      throw new Error("missing fixture inference");
    }
    const onOpenTimelineNode = vi.fn();
    render(<PromptInspector prompt={buildPromptView(inference, sampleWireRequest())} onOpenTimelineNode={onOpenTimelineNode} />);

    fireEvent.change(screen.getByPlaceholderText("在当前 Prompt 中搜索"), { target: { value: "当前问题" } });
    expect(screen.getByText("Current User Query")).toBeInTheDocument();
    expect(screen.queryByText("Model-visible Tool Definitions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Copy request JSON"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"当前问题\""));

    fireEvent.click(screen.getByText("Show timeline item"));
    expect(onOpenTimelineNode).toHaveBeenCalledWith("item-user");
  });

  it("links prompt tool definitions to tool call filtering", () => {
    const inference = sampleTrace().inference_calls?.inf1;
    if (!inference) {
      throw new Error("missing fixture inference");
    }
    const onOpenToolCalls = vi.fn();
    render(<PromptInspector prompt={buildPromptView(inference, sampleWireRequest())} onOpenToolCalls={onOpenToolCalls} />);

    fireEvent.change(screen.getByPlaceholderText("在当前 Prompt 中搜索"), { target: { value: "shell" } });
    fireEvent.click(screen.getByText("Show tool calls"));
    expect(onOpenToolCalls).toHaveBeenCalledWith("shell");
  });

  it("selects agent graph interaction edges", () => {
    const onSelectEdge = vi.fn();
    render(<AgentGraphView graph={buildAgentGraph(sampleTrace())} onSelectEdge={onSelectEdge} />);

    fireEvent.click(screen.getByText("edge1").closest("button")!);
    expect(onSelectEdge).toHaveBeenCalledWith("edge1");
  });

  it("copies raw payloads and renders payload errors in place", () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText }
    });
    const { rerender } = render(<RawPayload payload={{ ok: true }} />);

    fireEvent.click(screen.getByText("Copy payload JSON"));
    expect(writeText).toHaveBeenCalledWith("{\n  \"ok\": true\n}");

    rerender(<RawPayload error="payload not found: missing" />);
    expect(screen.getByText("payload not found: missing")).toBeInTheDocument();
  });
});
