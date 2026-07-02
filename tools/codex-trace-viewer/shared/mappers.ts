import type {
  AgentThread,
  RolloutTrace,
  ThreadTreeNode,
  TimelineNode,
  TraceSummary
} from "./types.js";

function entries<T>(record: Record<string, T> | undefined): Array<[string, T]> {
  return Object.entries(record ?? {});
}

function executionStart(value: { execution?: { started_at_unix_ms?: number } }): number | undefined {
  return value.execution?.started_at_unix_ms;
}

function executionEnd(value: { execution?: { ended_at_unix_ms?: number | null } }): number | null | undefined {
  return value.execution?.ended_at_unix_ms;
}

function executionStatus(value: { execution?: { status?: string } }): string | undefined {
  return value.execution?.status;
}

function toolKindLabel(kind: unknown): string {
  if (!kind || typeof kind !== "object") {
    return "tool";
  }
  const record = kind as Record<string, unknown>;
  const type = record.type;
  if (typeof type === "string") {
    if (type === "mcp") {
      return `mcp:${String(record.server ?? "")}/${String(record.tool ?? "")}`;
    }
    if (type === "other") {
      return String(record.name ?? "other");
    }
    return type;
  }
  return "tool";
}

function textPartSummary(parts: unknown[] | undefined): string {
  if (!Array.isArray(parts) || parts.length === 0) {
    return "";
  }
  const first = parts[0];
  if (!first || typeof first !== "object") {
    return JSON.stringify(first);
  }
  const record = first as Record<string, unknown>;
  const value = record.text ?? record.summary ?? record.source ?? record.value ?? first;
  const text = typeof value === "string" ? value : JSON.stringify(value);
  return text.length > 160 ? `${text.slice(0, 160)}...` : text;
}

function valueMentionsThread(value: unknown, threadId: string): boolean {
  if (value === threadId) {
    return true;
  }
  if (Array.isArray(value)) {
    return value.some((item) => valueMentionsThread(item, threadId));
  }
  if (value && typeof value === "object") {
    return Object.values(value).some((item) => valueMentionsThread(item, threadId));
  }
  return false;
}

export function buildTraceSummary(trace: RolloutTrace): TraceSummary {
  return {
    traceId: trace.trace_id ?? "unknown",
    rolloutId: trace.rollout_id ?? "unknown",
    rootThreadId: trace.root_thread_id ?? "unknown",
    status: trace.status ?? "unknown",
    startedAtUnixMs: trace.started_at_unix_ms,
    endedAtUnixMs: trace.ended_at_unix_ms,
    counts: {
      threads: entries(trace.threads).length,
      turns: entries(trace.codex_turns).length,
      conversationItems: entries(trace.conversation_items).length,
      inferences: entries(trace.inference_calls).length,
      toolCalls: entries(trace.tool_calls).length,
      terminalOperations: entries(trace.terminal_operations).length,
      compactions: entries(trace.compactions).length,
      interactionEdges: entries(trace.interaction_edges).length
    }
  };
}

function parentThreadId(thread: AgentThread): string | undefined {
  const origin = thread.origin;
  if (!origin || typeof origin !== "object") {
    return undefined;
  }
  const record = origin as Record<string, unknown>;
  return typeof record.parent_thread_id === "string" ? record.parent_thread_id : undefined;
}

export function buildThreadTree(trace: RolloutTrace): ThreadTreeNode[] {
  const nodes = new Map<string, ThreadTreeNode>();
  for (const [id, thread] of entries(trace.threads)) {
    nodes.set(id, {
      id,
      label: thread.nickname ?? thread.agent_path ?? id,
      model: thread.default_model,
      status: executionStatus(thread),
      children: []
    });
  }

  const roots: ThreadTreeNode[] = [];
  for (const [id, thread] of entries(trace.threads)) {
    const node = nodes.get(id);
    if (!node) {
      continue;
    }
    const parentId = parentThreadId(thread);
    const parent = parentId ? nodes.get(parentId) : undefined;
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }
  }

  const rootId = trace.root_thread_id;
  roots.sort((a, b) => (a.id === rootId ? -1 : b.id === rootId ? 1 : a.label.localeCompare(b.label)));
  return roots;
}

export function buildTimeline(trace: RolloutTrace, threadId?: string): TimelineNode[] {
  const nodes: TimelineNode[] = [];

  for (const [id, turn] of entries(trace.codex_turns)) {
    if (threadId && turn.thread_id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "turn",
      label: `Turn ${id}`,
      threadId: turn.thread_id,
      turnId: id,
      startedAtUnixMs: executionStart(turn),
      endedAtUnixMs: executionEnd(turn),
      status: executionStatus(turn),
      summary: `${turn.input_item_ids?.length ?? 0} input items`
    });
  }

  for (const [id, item] of entries(trace.conversation_items)) {
    if (threadId && item.thread_id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "conversation",
      label: `${item.role ?? "conversation"}: ${item.kind ?? "item"}`,
      threadId: item.thread_id,
      turnId: item.codex_turn_id,
      startedAtUnixMs: item.first_seen_at_unix_ms,
      status: "completed",
      summary: textPartSummary(item.body?.parts),
      relatedIds: item.call_id ? [item.call_id] : undefined
    });
  }

  for (const [id, inference] of entries(trace.inference_calls)) {
    if (threadId && inference.thread_id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "inference",
      label: `Model Call: ${inference.model ?? "unknown"}`,
      threadId: inference.thread_id,
      turnId: inference.codex_turn_id,
      startedAtUnixMs: executionStart(inference),
      endedAtUnixMs: executionEnd(inference),
      status: executionStatus(inference),
      summary: `${inference.provider_name ?? "provider unknown"} · input ${inference.usage?.input_tokens ?? "?"} / output ${inference.usage?.output_tokens ?? "?"}`,
      rawPayloadRefs: [inference.raw_request_payload_id, inference.raw_response_payload_id].filter(Boolean) as string[]
    });
  }

  for (const [id, tool] of entries(trace.tool_calls)) {
    if (threadId && tool.thread_id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "tool",
      label: `Tool: ${toolKindLabel(tool.kind)}`,
      threadId: tool.thread_id,
      turnId: tool.started_by_codex_turn_id,
      startedAtUnixMs: executionStart(tool),
      endedAtUnixMs: executionEnd(tool),
      status: executionStatus(tool),
      summary: tool.model_visible_call_id ?? tool.code_mode_runtime_tool_id ?? undefined,
      rawPayloadRefs: [
        tool.raw_invocation_payload_id,
        tool.raw_result_payload_id,
        ...(tool.raw_runtime_payload_ids ?? [])
      ].filter(Boolean) as string[]
    });
  }

  for (const [id, op] of entries(trace.terminal_operations)) {
    const tool = op.tool_call_id ? trace.tool_calls?.[op.tool_call_id] : undefined;
    if (threadId && tool?.thread_id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "terminal",
      label: `Terminal: ${op.kind ?? "operation"}`,
      threadId: tool?.thread_id,
      turnId: tool?.started_by_codex_turn_id,
      startedAtUnixMs: executionStart(op),
      endedAtUnixMs: executionEnd(op),
      status: executionStatus(op),
      summary: JSON.stringify(op.request ?? {}),
      rawPayloadRefs: op.raw_payload_ids
    });
  }

  for (const [id, compaction] of entries(trace.compactions)) {
    if (threadId && compaction.thread_id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "compaction",
      label: "Compaction",
      threadId: compaction.thread_id,
      turnId: compaction.codex_turn_id,
      startedAtUnixMs: compaction.installed_at_unix_ms,
      status: "completed",
      summary: `${compaction.request_ids?.length ?? 0} requests`
    });
  }

  for (const [id, edge] of entries(trace.interaction_edges)) {
    if (threadId && !valueMentionsThread(edge, threadId)) {
      continue;
    }
    nodes.push({
      id,
      type: "agent_edge",
      label: `Agent Edge: ${edge.edge_type ?? id}`,
      status: "completed",
      summary: JSON.stringify(edge).slice(0, 200)
    });
  }

  return nodes.sort((a, b) => {
    const at = a.startedAtUnixMs ?? Number.MAX_SAFE_INTEGER;
    const bt = b.startedAtUnixMs ?? Number.MAX_SAFE_INTEGER;
    if (at !== bt) {
      return at - bt;
    }
    const ar = timelineSortRank(a);
    const br = timelineSortRank(b);
    if (ar !== br) {
      return ar - br;
    }
    return a.id.localeCompare(b.id);
  });
}

export function searchTrace(trace: RolloutTrace, query: string): TimelineNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return buildTimeline(trace).filter((node) => JSON.stringify(node).toLowerCase().includes(needle));
}

function timelineSortRank(node: TimelineNode): number {
  if (node.type === "turn") {
    return 0;
  }
  if (node.type === "conversation" && !node.label.startsWith("assistant:")) {
    return 1;
  }
  if (node.type === "inference") {
    return 2;
  }
  if (node.type === "tool" || node.type === "terminal") {
    return 3;
  }
  if (node.type === "conversation") {
    return 4;
  }
  if (node.type === "compaction") {
    return 5;
  }
  return 6;
}
