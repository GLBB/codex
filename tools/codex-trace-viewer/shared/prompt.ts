import type { InferenceCall, PromptSection, PromptView } from "./types.js";

function stringifyContent(value: unknown): string {
  if (value == null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

function charCount(content: string): number {
  return Array.from(content).length;
}

function estimatedTokens(content: string): number {
  if (!content) {
    return 0;
  }
  return Math.ceil(content.length / 4);
}

function section(
  id: string,
  kind: string,
  label: string,
  source: string,
  content: unknown,
  role?: string,
  rawPayloadRef?: string,
  relatedTimelineNodeId?: string
): PromptSection {
  const text = stringifyContent(content);
  return {
    id,
    kind,
    label,
    source,
    role,
    content: text,
    charCount: charCount(text),
    estimatedTokens: estimatedTokens(text),
    included: text.length > 0,
    rawPayloadRef,
    relatedTimelineNodeId
  };
}

function inputItemRole(item: unknown): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const role = (item as Record<string, unknown>).role;
  return typeof role === "string" ? role : undefined;
}

function inputItemType(item: unknown): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const type = (item as Record<string, unknown>).type;
  return typeof type === "string" ? type : undefined;
}

function classifyInputSource(item: unknown, index: number, inputCount: number): string {
  const type = inputItemType(item);
  const role = inputItemRole(item);
  const text = stringifyContent(item).toLowerCase();
  if (type?.includes("tool") || role === "tool") {
    return "conversation_history.tool";
  }
  if (role === "user" && index === inputCount - 1) {
    return "current_query";
  }
  if (role === "developer" && text.includes("agents.md")) {
    return "AGENTS.md";
  }
  if (role === "developer" && (text.includes("sandbox") || text.includes("permission"))) {
    return "permissions";
  }
  if (role === "developer" && text.includes("skill")) {
    return "skills";
  }
  if (role === "user") {
    return "conversation_history.user";
  }
  if (role === "assistant") {
    return "conversation_history.assistant";
  }
  if (role === "developer" || role === "system") {
    return role === "developer" ? "developer_instructions" : "base_instructions";
  }
  return "conversation_history";
}

function inputItemTimelineId(item: unknown): string | undefined {
  if (!item || typeof item !== "object") {
    return undefined;
  }
  const record = item as Record<string, unknown>;
  const id = record.item_id ?? record.id;
  return typeof id === "string" ? id : undefined;
}

export function buildPromptView(
  inference: InferenceCall,
  wireRequestJson: unknown
): PromptView {
  const request =
    wireRequestJson && typeof wireRequestJson === "object"
      ? (wireRequestJson as Record<string, unknown>)
      : {};
  const sections: PromptSection[] = [];
  const warnings: string[] = [];
  const rawRequestPayloadId = inference.raw_request_payload_id;

  sections.push(
    section(
      "request_metadata",
      "metadata",
      "Request Metadata",
      "request",
      {
        model: request.model ?? inference.model,
        provider: inference.provider_name,
        service_tier: request.service_tier,
        reasoning: request.reasoning,
        parallel_tool_calls: request.parallel_tool_calls,
        tool_choice: request.tool_choice
      },
      undefined,
      rawRequestPayloadId
    )
  );

  if ("instructions" in request) {
    sections.push(
      section(
        "system_base_instructions",
        "system",
        "System / Base Instructions",
        "base_instructions",
        request.instructions,
        "system",
        rawRequestPayloadId
      )
    );
  }

  const input = Array.isArray(request.input) ? request.input : [];
  const requestItemIds =
    Array.isArray(inference.request_item_ids) && inference.request_item_ids.length === input.length
      ? inference.request_item_ids
      : [];
  input.forEach((item, index) => {
    const role = inputItemRole(item);
    const source = classifyInputSource(item, index, input.length);
    const label =
      source === "current_query"
        ? "Current User Query"
        : `Conversation Item ${index + 1}${role ? ` (${role})` : ""}`;
    sections.push(
      section(
        `input_${index}`,
        role ?? inputItemType(item) ?? "conversation",
        label,
        source,
        item,
        role,
        rawRequestPayloadId,
        inputItemTimelineId(item) ?? requestItemIds[index]
      )
    );
  });

  if (Array.isArray(request.tools)) {
    sections.push(
      section(
        "model_visible_tools",
        "tool_definition",
        "Model-visible Tool Definitions",
        "tool_registry",
        request.tools,
        undefined,
        rawRequestPayloadId
      )
    );
  }

  if ("text" in request) {
    sections.push(
      section(
        "output_schema",
        "schema",
        "Output Schema / Text Config",
        "request.text",
        request.text,
        undefined,
        rawRequestPayloadId
      )
    );
  }

  if (sections.length === 1) {
    warnings.push("未能从 request payload 中识别 prompt 分段，仅展示请求元数据。");
  }

  return {
    inferenceId: inference.inference_call_id,
    model: inference.model,
    provider: inference.provider_name,
    wireRequestPayloadRef: rawRequestPayloadId,
    wireRequestJson,
    sections: sections.filter((item) => item.included),
    warnings
  };
}
