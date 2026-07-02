export type JsonObject = Record<string, unknown>;

export type TraceStatus = "running" | "completed" | "failed" | "aborted" | string;

export interface ExecutionWindow {
  started_at_unix_ms?: number;
  ended_at_unix_ms?: number | null;
  status?: string;
}

export interface RawPayloadRef {
  raw_payload_id: string;
  kind?: unknown;
  path: string;
}

export interface AgentThread {
  thread_id: string;
  agent_path?: string;
  nickname?: string | null;
  origin?: unknown;
  execution?: ExecutionWindow;
  default_model?: string | null;
  conversation_item_ids?: string[];
}

export interface CodexTurn {
  codex_turn_id: string;
  thread_id: string;
  execution?: ExecutionWindow;
  input_item_ids?: string[];
}

export interface ConversationItem {
  item_id: string;
  thread_id: string;
  codex_turn_id?: string | null;
  first_seen_at_unix_ms?: number;
  role?: string;
  channel?: string | null;
  kind?: string;
  body?: {
    parts?: unknown[];
  };
  call_id?: string | null;
  produced_by?: unknown[];
}

export interface InferenceCall {
  inference_call_id: string;
  thread_id: string;
  codex_turn_id: string;
  execution?: ExecutionWindow;
  model?: string;
  provider_name?: string;
  response_id?: string | null;
  upstream_request_id?: string | null;
  request_item_ids?: string[];
  response_item_ids?: string[];
  tool_call_ids_started_by_response?: string[];
  usage?: {
    input_tokens?: number;
    cached_input_tokens?: number;
    output_tokens?: number;
    reasoning_output_tokens?: number;
  } | null;
  raw_request_payload_id?: string;
  raw_response_payload_id?: string | null;
}

export interface ToolCall {
  tool_call_id: string;
  mcp_call_id?: string | null;
  model_visible_call_id?: string | null;
  code_mode_runtime_tool_id?: string | null;
  thread_id: string;
  started_by_codex_turn_id?: string | null;
  execution?: ExecutionWindow;
  requester?: unknown;
  kind?: unknown;
  model_visible_call_item_ids?: string[];
  model_visible_output_item_ids?: string[];
  terminal_operation_id?: string | null;
  summary?: unknown;
  raw_invocation_payload_id?: string | null;
  raw_result_payload_id?: string | null;
  raw_runtime_payload_ids?: string[];
}

export interface TerminalOperation {
  operation_id: string;
  terminal_id?: string | null;
  tool_call_id?: string;
  kind?: string;
  execution?: ExecutionWindow;
  request?: unknown;
  result?: unknown;
  raw_payload_ids?: string[];
}

export interface Compaction {
  compaction_id: string;
  thread_id: string;
  codex_turn_id: string;
  installed_at_unix_ms?: number;
  marker_item_id?: string;
  request_ids?: string[];
}

export interface InteractionEdge {
  edge_id?: string;
  edge_type?: string;
  source?: unknown;
  target?: unknown;
  [key: string]: unknown;
}

export interface RolloutTrace {
  schema_version?: number;
  trace_id?: string;
  rollout_id?: string;
  started_at_unix_ms?: number;
  ended_at_unix_ms?: number | null;
  status?: TraceStatus;
  root_thread_id?: string;
  threads?: Record<string, AgentThread>;
  codex_turns?: Record<string, CodexTurn>;
  conversation_items?: Record<string, ConversationItem>;
  inference_calls?: Record<string, InferenceCall>;
  tool_calls?: Record<string, ToolCall>;
  terminal_operations?: Record<string, TerminalOperation>;
  compactions?: Record<string, Compaction>;
  interaction_edges?: Record<string, InteractionEdge>;
  raw_payloads?: Record<string, RawPayloadRef>;
  [key: string]: unknown;
}

export interface TraceSummary {
  traceId: string;
  rolloutId: string;
  rootThreadId: string;
  status: string;
  startedAtUnixMs?: number;
  endedAtUnixMs?: number | null;
  counts: {
    threads: number;
    turns: number;
    conversationItems: number;
    inferences: number;
    toolCalls: number;
    terminalOperations: number;
    compactions: number;
    interactionEdges: number;
  };
}

export interface DurationSummary {
  count: number;
  totalMs: number;
  maxMs: number;
}

export interface TokenSummary {
  inputTokens: number;
  cachedInputTokens: number;
  outputTokens: number;
  reasoningOutputTokens: number;
}

export interface StatsSummary {
  totalDurationMs?: number;
  turns: DurationSummary;
  inferences: DurationSummary;
  tools: DurationSummary;
  terminalOperations: DurationSummary;
  tokens: TokenSummary;
  failedToolCalls: number;
  retryCount: number;
  compactions: number;
  childThreads: number;
}

export interface BundleSummary {
  id: string;
  path: string;
  label: string;
  updatedAtUnixMs?: number;
  active: boolean;
}

export interface ThreadTreeNode {
  id: string;
  label: string;
  model?: string | null;
  status?: string;
  children: ThreadTreeNode[];
}

export type TimelineNodeType =
  | "turn"
  | "conversation"
  | "inference"
  | "tool"
  | "terminal"
  | "compaction"
  | "agent_edge";

export interface TimelineNode {
  id: string;
  type: TimelineNodeType;
  label: string;
  threadId?: string;
  turnId?: string | null;
  startedAtUnixMs?: number;
  endedAtUnixMs?: number | null;
  status?: string;
  summary?: string;
  rawPayloadRefs?: string[];
  relatedIds?: string[];
  model?: string;
  toolName?: string;
  agentEdgeType?: string;
  durationMs?: number;
}

export interface AgentGraphNode {
  id: string;
  label: string;
  parentId?: string;
  model?: string | null;
  status?: string;
  startedAtUnixMs?: number;
  endedAtUnixMs?: number | null;
}

export interface AgentGraphEdge {
  id: string;
  edgeType: string;
  sourceThreadId?: string;
  targetThreadId?: string;
  label: string;
  relatedTimelineNodeId?: string;
  rawPayloadRefs?: string[];
}

export interface AgentGraph {
  rootThreadId?: string;
  nodes: AgentGraphNode[];
  edges: AgentGraphEdge[];
}

export interface PromptSection {
  id: string;
  kind: string;
  label: string;
  source: string;
  role?: string;
  content: string;
  charCount: number;
  estimatedTokens?: number;
  included: boolean;
  rawPayloadRef?: string;
}

export interface PromptView {
  inferenceId: string;
  model?: string;
  provider?: string;
  wireRequestPayloadRef?: string;
  wireRequestJson: unknown;
  sections: PromptSection[];
  warnings: string[];
}
