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

  it("searches and copies prompt sections", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, {
      clipboard: { writeText }
    });
    const inference = sampleTrace().inference_calls?.inf1;
    if (!inference) {
      throw new Error("missing fixture inference");
    }
    render(<PromptInspector prompt={buildPromptView(inference, sampleWireRequest())} />);

    fireEvent.change(screen.getByPlaceholderText("在当前 Prompt 中搜索"), { target: { value: "当前问题" } });
    expect(screen.getByText("Current User Query")).toBeInTheDocument();
    expect(screen.queryByText("Model-visible Tool Definitions")).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("Copy request JSON"));
    expect(writeText).toHaveBeenCalledWith(expect.stringContaining("\"当前问题\""));
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
