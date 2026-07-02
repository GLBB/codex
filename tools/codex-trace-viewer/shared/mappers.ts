import type {
  AgentGraph,
  AgentGraphEdge,
  AgentThread,
  DurationSummary,
  RolloutTrace,
  StatsSummary,
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

function durationMs(value: { execution?: { started_at_unix_ms?: number; ended_at_unix_ms?: number | null } }): number | undefined {
  const start = value.execution?.started_at_unix_ms;
  const end = value.execution?.ended_at_unix_ms;
  if (start === undefined || end === undefined || end === null) {
    return undefined;
  }
  return Math.max(0, end - start);
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
      codeCells: entries(trace.code_cells).length,
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

function threadRef(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["thread_id", "threadId", "parent_thread_id", "child_thread_id", "target_thread_id", "source_thread_id"]) {
    if (typeof record[key] === "string") {
      return record[key];
    }
  }
  return undefined;
}

function rawRefsFromValue(value: unknown): string[] {
  const refs = new Set<string>();
  function visit(item: unknown): void {
    if (Array.isArray(item)) {
      item.forEach(visit);
      return;
    }
    if (!item || typeof item !== "object") {
      return;
    }
    for (const [key, child] of Object.entries(item as Record<string, unknown>)) {
      if (key.includes("raw") && key.includes("payload") && typeof child === "string") {
        refs.add(child);
      }
      visit(child);
    }
  }
  visit(value);
  return [...refs];
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

  if (!threadId) {
    nodes.push({
      id: trace.trace_id ?? "session",
      type: "session",
      label: `Session: ${trace.rollout_id ?? trace.trace_id ?? "unknown"}`,
      startedAtUnixMs: trace.started_at_unix_ms,
      endedAtUnixMs: trace.ended_at_unix_ms,
      status: trace.status,
      summary: `root ${trace.root_thread_id ?? "unknown"}`
    });
  }

  for (const [id, thread] of entries(trace.threads)) {
    if (threadId && id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "thread",
      label: `Thread: ${thread.nickname ?? thread.agent_path ?? id}`,
      threadId: id,
      startedAtUnixMs: executionStart(thread),
      endedAtUnixMs: executionEnd(thread),
      status: executionStatus(thread),
      summary: thread.default_model ?? undefined
    });
  }

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
      summary: `${turn.input_item_ids?.length ?? 0} input items`,
      durationMs: durationMs(turn)
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
      rawPayloadRefs: [inference.raw_request_payload_id, inference.raw_response_payload_id].filter(Boolean) as string[],
      model: inference.model,
      durationMs: durationMs(inference)
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
      ].filter(Boolean) as string[],
      toolName: toolKindLabel(tool.kind),
      durationMs: durationMs(tool)
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
      rawPayloadRefs: op.raw_payload_ids,
      durationMs: durationMs(op)
    });
  }

  for (const [id, cell] of entries(trace.code_cells)) {
    if (threadId && cell.thread_id !== threadId) {
      continue;
    }
    nodes.push({
      id,
      type: "code_cell",
      label: `Code Cell${cell.language ? `: ${cell.language}` : ""}`,
      threadId: cell.thread_id,
      turnId: cell.codex_turn_id,
      startedAtUnixMs: executionStart(cell),
      endedAtUnixMs: executionEnd(cell),
      status: executionStatus(cell),
      summary: textPartSummary([cell.source ?? cell.result].filter(Boolean)),
      rawPayloadRefs: cell.raw_payload_ids,
      relatedIds: [...(cell.tool_call_ids ?? []), ...(cell.terminal_operation_ids ?? [])],
      durationMs: durationMs(cell)
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
      summary: JSON.stringify(edge).slice(0, 200),
      threadId: threadRef(edge.source),
      relatedIds: [threadRef(edge.source), threadRef(edge.target)].filter(Boolean) as string[],
      rawPayloadRefs: rawRefsFromValue(edge),
      agentEdgeType: edge.edge_type
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

export function buildAgentGraph(trace: RolloutTrace): AgentGraph {
  const nodes = entries(trace.threads).map(([id, thread]) => ({
    id,
    label: thread.nickname ?? thread.agent_path ?? id,
    parentId: parentThreadId(thread),
    model: thread.default_model,
    status: executionStatus(thread),
    startedAtUnixMs: executionStart(thread),
    endedAtUnixMs: executionEnd(thread)
  }));
  const edges: AgentGraphEdge[] = [];

  for (const node of nodes) {
    if (node.parentId) {
      edges.push({
        id: `origin:${node.parentId}:${node.id}`,
        edgeType: "spawn",
        sourceThreadId: node.parentId,
        targetThreadId: node.id,
        label: "spawn"
      });
    }
  }

  for (const [id, edge] of entries(trace.interaction_edges)) {
    const sourceThreadId = threadRef(edge.source);
    const targetThreadId = threadRef(edge.target);
    edges.push({
      id,
      edgeType: edge.edge_type ?? "interaction",
      sourceThreadId,
      targetThreadId,
      label: edge.edge_type ?? id,
      relatedTimelineNodeId: id,
      rawPayloadRefs: rawRefsFromValue(edge)
    });
  }

  return {
    rootThreadId: trace.root_thread_id,
    nodes,
    edges
  };
}

function emptyDurationSummary(): DurationSummary {
  return { count: 0, totalMs: 0, maxMs: 0 };
}

function addDuration(summary: DurationSummary, value: number | undefined): void {
  summary.count += 1;
  if (value === undefined) {
    return;
  }
  summary.totalMs += value;
  summary.maxMs = Math.max(summary.maxMs, value);
}

export function buildStatsSummary(trace: RolloutTrace): StatsSummary {
  const turns = emptyDurationSummary();
  const inferences = emptyDurationSummary();
  const tools = emptyDurationSummary();
  const codeCells = emptyDurationSummary();
  const terminalOperations = emptyDurationSummary();

  for (const [, turn] of entries(trace.codex_turns)) {
    addDuration(turns, durationMs(turn));
  }
  const tokens = {
    inputTokens: 0,
    cachedInputTokens: 0,
    outputTokens: 0,
    reasoningOutputTokens: 0
  };
  for (const [, inference] of entries(trace.inference_calls)) {
    addDuration(inferences, durationMs(inference));
    tokens.inputTokens += inference.usage?.input_tokens ?? 0;
    tokens.cachedInputTokens += inference.usage?.cached_input_tokens ?? 0;
    tokens.outputTokens += inference.usage?.output_tokens ?? 0;
    tokens.reasoningOutputTokens += inference.usage?.reasoning_output_tokens ?? 0;
  }
  let failedToolCalls = 0;
  for (const [, tool] of entries(trace.tool_calls)) {
    addDuration(tools, durationMs(tool));
    const status = executionStatus(tool);
    if (status === "failed" || status === "error") {
      failedToolCalls += 1;
    }
  }
  for (const [, cell] of entries(trace.code_cells)) {
    addDuration(codeCells, durationMs(cell));
  }
  for (const [, operation] of entries(trace.terminal_operations)) {
    addDuration(terminalOperations, durationMs(operation));
  }

  const totalDurationMs =
    trace.started_at_unix_ms !== undefined && trace.ended_at_unix_ms !== undefined && trace.ended_at_unix_ms !== null
      ? Math.max(0, trace.ended_at_unix_ms - trace.started_at_unix_ms)
      : undefined;

  return {
    totalDurationMs,
    turns,
    inferences,
    tools,
    codeCells,
    terminalOperations,
    tokens,
    failedToolCalls,
    retryCount: Math.max(0, entries(trace.inference_calls).length - entries(trace.codex_turns).length),
    compactions: entries(trace.compactions).length,
    childThreads: entries(trace.threads).filter(([, thread]) => Boolean(parentThreadId(thread))).length
  };
}

export function searchTrace(trace: RolloutTrace, query: string): TimelineNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return [];
  }
  return buildTimeline(trace).filter((node) => JSON.stringify(node).toLowerCase().includes(needle));
}

function timelineSortRank(node: TimelineNode): number {
  if (node.type === "session") {
    return 0;
  }
  if (node.type === "thread") {
    return 1;
  }
  if (node.type === "turn") {
    return 2;
  }
  if (node.type === "conversation" && !node.label.startsWith("assistant:")) {
    return 3;
  }
  if (node.type === "inference") {
    return 4;
  }
  if (node.type === "tool" || node.type === "code_cell" || node.type === "terminal") {
    return 5;
  }
  if (node.type === "conversation") {
    return 6;
  }
  if (node.type === "compaction") {
    return 7;
  }
  return 8;
}
