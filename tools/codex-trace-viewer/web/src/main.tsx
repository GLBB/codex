import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type {
  AgentGraph,
  BundleSummary,
  CodeCell,
  InferenceCall,
  PromptView,
  StatsSummary,
  TerminalOperation,
  ThreadTreeNode,
  TimelineNode,
  ToolCall,
  TraceSummary
} from "../../shared/types";
import "./styles.css";

type Tab = "timeline" | "prompt" | "agent" | "payload" | "stats";

export interface TimelineFilters {
  types: Set<TimelineNode["type"]>;
  thread: string;
  turn: string;
  status: string;
  model: string;
  tool: string;
  agentEdge: string;
  failedOnly: boolean;
  slowMs: string;
}

const timelineTypes: TimelineNode["type"][] = [
  "session",
  "thread",
  "turn",
  "conversation",
  "reasoning",
  "inference",
  "tool",
  "code_cell",
  "terminal",
  "compaction",
  "agent_edge"
];

interface BundlesUpdatedEvent {
  bundles?: BundleSummary[];
  added?: string[];
}

export function defaultFilters(): TimelineFilters {
  return {
    types: new Set(timelineTypes),
    thread: "",
    turn: "",
    status: "",
    model: "",
    tool: "",
    agentEdge: "",
    failedOnly: false,
    slowMs: ""
  };
}

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`${response.status} ${response.statusText}: ${body}`);
  }
  return (await response.json()) as T;
}

function formatTime(value?: number | null): string {
  if (!value) {
    return "";
  }
  return new Date(value).toLocaleTimeString();
}

function formatDuration(value?: number): string {
  if (value === undefined) {
    return "";
  }
  if (value < 1000) {
    return `${value}ms`;
  }
  return `${(value / 1000).toFixed(1)}s`;
}

function flattenThreads(nodes: ThreadTreeNode[]): ThreadTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenThreads(node.children)]);
}

function isFailedStatus(status?: string): boolean {
  return status === "failed" || status === "error" || status === "aborted" || status === "cancelled";
}

export function errorSummary(value: unknown): string | undefined {
  if (!value || typeof value !== "object") {
    return undefined;
  }
  const record = value as Record<string, unknown>;
  for (const key of ["error", "message", "stderr", "exit_code", "exitCode", "status"]) {
    const item = record[key];
    if (typeof item === "string" || typeof item === "number") {
      return `${key}: ${item}`;
    }
  }
  for (const item of Object.values(record)) {
    const nested = errorSummary(item);
    if (nested) {
      return nested;
    }
  }
  return undefined;
}

export function filterTimeline(nodes: TimelineNode[], filters: TimelineFilters): TimelineNode[] {
  const status = filters.status.trim().toLowerCase();
  const thread = filters.thread.trim().toLowerCase();
  const turn = filters.turn.trim().toLowerCase();
  const model = filters.model.trim().toLowerCase();
  const tool = filters.tool.trim().toLowerCase();
  const agentEdge = filters.agentEdge.trim().toLowerCase();
  const slowMs = Number(filters.slowMs);
  return nodes.filter((node) => {
    if (!filters.types.has(node.type)) {
      return false;
    }
    if (filters.failedOnly && !isFailedStatus(node.status)) {
      return false;
    }
    if (thread && !(node.threadId ?? "").toLowerCase().includes(thread)) {
      return false;
    }
    if (turn && !(node.turnId ?? "").toLowerCase().includes(turn)) {
      return false;
    }
    if (status && !(node.status ?? "").toLowerCase().includes(status)) {
      return false;
    }
    if (model && !(node.model ?? "").toLowerCase().includes(model)) {
      return false;
    }
    if (tool && !(node.toolName ?? node.agentEdgeType ?? "").toLowerCase().includes(tool)) {
      return false;
    }
    if (agentEdge && !(node.agentEdgeType ?? "").toLowerCase().includes(agentEdge)) {
      return false;
    }
    if (Number.isFinite(slowMs) && slowMs > 0 && (node.durationMs ?? 0) < slowMs) {
      return false;
    }
    return true;
  });
}

export function highlightedText(text: string, query: string): React.ReactNode {
  const needle = query.trim();
  if (!needle) {
    return text;
  }
  const lowerText = text.toLowerCase();
  const lowerNeedle = needle.toLowerCase();
  const parts: React.ReactNode[] = [];
  let cursor = 0;
  let matchIndex = lowerText.indexOf(lowerNeedle);
  while (matchIndex !== -1) {
    if (matchIndex > cursor) {
      parts.push(text.slice(cursor, matchIndex));
    }
    const end = matchIndex + needle.length;
    parts.push(<mark key={`${matchIndex}:${end}`}>{text.slice(matchIndex, end)}</mark>);
    cursor = end;
    matchIndex = lowerText.indexOf(lowerNeedle, cursor);
  }
  if (cursor < text.length) {
    parts.push(text.slice(cursor));
  }
  return parts.length ? parts : text;
}

function ThreadTree({
  nodes,
  selectedThread,
  onSelect
}: {
  nodes: ThreadTreeNode[];
  selectedThread?: string;
  onSelect: (threadId?: string) => void;
}) {
  return (
    <div className="tree">
      <button className={!selectedThread ? "selected rowButton" : "rowButton"} onClick={() => onSelect(undefined)}>
        全部 threads
      </button>
      {nodes.map((node) => (
        <ThreadNode key={node.id} node={node} selectedThread={selectedThread} onSelect={onSelect} depth={0} />
      ))}
    </div>
  );
}

function ThreadNode({
  node,
  selectedThread,
  onSelect,
  depth
}: {
  node: ThreadTreeNode;
  selectedThread?: string;
  onSelect: (threadId: string) => void;
  depth: number;
}) {
  return (
    <>
      <button
        className={selectedThread === node.id ? "selected rowButton" : "rowButton"}
        style={{ paddingLeft: `${8 + depth * 16}px` }}
        onClick={() => onSelect(node.id)}
      >
        <span>{node.children.length ? "▾ " : "• "}</span>
        <span>{node.label}</span>
        {node.status ? <small>{node.status}</small> : null}
      </button>
      {node.children.map((child) => (
        <ThreadNode key={child.id} node={child} selectedThread={selectedThread} onSelect={onSelect} depth={depth + 1} />
      ))}
    </>
  );
}

function TimelineFilterPanel({
  filters,
  onChange
}: {
  filters: TimelineFilters;
  onChange: (filters: TimelineFilters) => void;
}) {
  const toggleType = (type: TimelineNode["type"]) => {
    const next = new Set(filters.types);
    if (next.has(type)) {
      next.delete(type);
    } else {
      next.add(type);
    }
    onChange({ ...filters, types: next });
  };
  return (
    <div className="filters">
      <h3>Filters</h3>
      <div className="typeGrid">
        {timelineTypes.map((type) => (
          <label key={type}>
            <input type="checkbox" checked={filters.types.has(type)} onChange={() => toggleType(type)} />
            {type}
          </label>
        ))}
      </div>
      <label>
        Thread
        <input value={filters.thread} onChange={(event) => onChange({ ...filters, thread: event.currentTarget.value })} />
      </label>
      <label>
        Turn
        <input value={filters.turn} onChange={(event) => onChange({ ...filters, turn: event.currentTarget.value })} />
      </label>
      <label>
        Status
        <input value={filters.status} onChange={(event) => onChange({ ...filters, status: event.currentTarget.value })} />
      </label>
      <label>
        Model
        <input value={filters.model} onChange={(event) => onChange({ ...filters, model: event.currentTarget.value })} />
      </label>
      <label>
        Tool / edge
        <input value={filters.tool} onChange={(event) => onChange({ ...filters, tool: event.currentTarget.value })} />
      </label>
      <label>
        Agent edge
        <input value={filters.agentEdge} onChange={(event) => onChange({ ...filters, agentEdge: event.currentTarget.value })} />
      </label>
      <label>
        Slow &gt;= ms
        <input value={filters.slowMs} onChange={(event) => onChange({ ...filters, slowMs: event.currentTarget.value })} />
      </label>
      <label className="inlineToggle">
        <input type="checkbox" checked={filters.failedOnly} onChange={(event) => onChange({ ...filters, failedOnly: event.currentTarget.checked })} />
        Failed only
      </label>
      <button onClick={() => onChange(defaultFilters())}>Reset filters</button>
    </div>
  );
}

function Timeline({
  nodes,
  freshNodeKeys,
  selectedNode,
  highlightQuery,
  onSelect
}: {
  nodes: TimelineNode[];
  freshNodeKeys: Set<string>;
  selectedNode?: TimelineNode;
  highlightQuery: string;
  onSelect: (node: TimelineNode) => void;
}) {
  return (
    <div className="timeline">
      {nodes.map((node) => (
        <button
          key={`${node.type}:${node.id}`}
          className={[
            "timelineNode",
            selectedNode?.id === node.id && selectedNode.type === node.type ? "selected" : "",
            freshNodeKeys.has(`${node.type}:${node.id}`) ? "fresh" : ""
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={() => onSelect(node)}
        >
          <div className="nodeHeader">
            <span className={`pill ${node.type}`}>{node.type}</span>
            <strong>{highlightedText(node.label, highlightQuery)}</strong>
            <span>{formatTime(node.startedAtUnixMs)}</span>
          </div>
          {node.summary ? <p>{highlightedText(node.summary, highlightQuery)}</p> : null}
          <div className="nodeMeta">
            {node.status ? <span>{node.status}</span> : null}
            {node.turnId ? <span>turn {node.turnId}</span> : null}
          </div>
        </button>
      ))}
    </div>
  );
}

function Details({
  node,
  inference,
  tool,
  codeCell,
  terminal,
  onOpenPrompt,
  onOpenPayload
}: {
  node?: TimelineNode;
  inference?: InferenceCall;
  tool?: ToolCall;
  codeCell?: CodeCell;
  terminal?: TerminalOperation;
  onOpenPrompt: (inferenceId: string) => void;
  onOpenPayload: (payloadId: string) => void;
}) {
  if (!node) {
    return <div className="empty">选择一个 timeline 节点查看详情。</div>;
  }
  const failureSummary =
    isFailedStatus(node.status) &&
    (errorSummary(tool?.summary) ?? errorSummary(tool) ?? errorSummary(codeCell?.result) ?? errorSummary(terminal?.result) ?? node.summary);
  return (
    <div className="details">
      <h2>{node.label}</h2>
      {failureSummary ? <div className="errorBox">Failure: {failureSummary}</div> : null}
      <dl>
        <dt>类型</dt>
        <dd>{node.type}</dd>
        <dt>ID</dt>
        <dd className="mono">{node.id}</dd>
        <dt>Thread</dt>
        <dd className="mono">{node.threadId ?? "-"}</dd>
        <dt>Turn</dt>
        <dd className="mono">{node.turnId ?? "-"}</dd>
        <dt>Status</dt>
        <dd>{node.status ?? "-"}</dd>
        <dt>Duration</dt>
        <dd>{formatDuration(node.durationMs) || "-"}</dd>
        <dt>Model</dt>
        <dd>{node.model ?? "-"}</dd>
        <dt>Tool</dt>
        <dd>{node.toolName ?? node.agentEdgeType ?? "-"}</dd>
      </dl>
      {node.type === "inference" ? (
        <button className="primary" onClick={() => onOpenPrompt(node.id)}>
          查看完整 Prompt
        </button>
      ) : null}
      {inference ? (
        <div className="detailBlock">
          <h3>Model Call</h3>
          <dl>
            <dt>Provider</dt>
            <dd>{inference.provider_name ?? "-"}</dd>
            <dt>Response</dt>
            <dd className="mono">{inference.response_id ?? "-"}</dd>
            <dt>Upstream</dt>
            <dd className="mono">{inference.upstream_request_id ?? "-"}</dd>
            <dt>Input</dt>
            <dd>{inference.usage?.input_tokens ?? "-"}</dd>
            <dt>Cached</dt>
            <dd>{inference.usage?.cached_input_tokens ?? "-"}</dd>
            <dt>Output</dt>
            <dd>{inference.usage?.output_tokens ?? "-"}</dd>
            <dt>Reasoning</dt>
            <dd>{inference.usage?.reasoning_output_tokens ?? "-"}</dd>
          </dl>
        </div>
      ) : null}
      {tool ? (
        <div className="detailBlock">
          <h3>Tool Call</h3>
          <dl>
            <dt>Call ID</dt>
            <dd className="mono">{tool.model_visible_call_id ?? tool.mcp_call_id ?? tool.code_mode_runtime_tool_id ?? "-"}</dd>
            <dt>Terminal</dt>
            <dd className="mono">{tool.terminal_operation_id ?? "-"}</dd>
          </dl>
          <h4>Kind</h4>
          <pre>{JSON.stringify(tool.kind ?? {}, null, 2)}</pre>
          {tool.requester ? (
            <>
              <h4>Requester</h4>
              <pre>{JSON.stringify(tool.requester, null, 2)}</pre>
            </>
          ) : null}
          {tool.summary ? (
            <>
              <h4>Summary</h4>
              <pre>{JSON.stringify(tool.summary, null, 2)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
      {codeCell ? (
        <div className="detailBlock">
          <h3>Code Cell</h3>
          <dl>
            <dt>Language</dt>
            <dd>{codeCell.language ?? "-"}</dd>
          </dl>
          {codeCell.source ? (
            <>
              <h4>Source</h4>
              <pre>{JSON.stringify(codeCell.source, null, 2)}</pre>
            </>
          ) : null}
          {codeCell.result ? (
            <>
              <h4>Result</h4>
              <pre>{JSON.stringify(codeCell.result, null, 2)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
      {terminal ? (
        <div className="detailBlock">
          <h3>Terminal Operation</h3>
          <dl>
            <dt>Terminal</dt>
            <dd className="mono">{terminal.terminal_id ?? "-"}</dd>
            <dt>Tool</dt>
            <dd className="mono">{terminal.tool_call_id ?? "-"}</dd>
          </dl>
          {terminal.request ? (
            <>
              <h4>Request</h4>
              <pre>{JSON.stringify(terminal.request, null, 2)}</pre>
            </>
          ) : null}
          {terminal.result ? (
            <>
              <h4>Result</h4>
              <pre>{JSON.stringify(terminal.result, null, 2)}</pre>
            </>
          ) : null}
        </div>
      ) : null}
      {node.rawPayloadRefs?.length ? (
        <div>
          <h3>Raw Payloads</h3>
          {node.rawPayloadRefs.map((id) => (
            <button key={id} className="linkButton mono" onClick={() => onOpenPayload(id)}>
              {id}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function PromptInspector({
  prompt,
  onOpenTimelineNode,
  onOpenToolCalls
}: {
  prompt?: PromptView;
  onOpenTimelineNode?: (timelineNodeId: string) => void;
  onOpenToolCalls?: (toolName: string) => void;
}) {
  const [promptQuery, setPromptQuery] = useState("");
  const [copyState, setCopyState] = useState("");
  if (!prompt) {
    return <div className="empty">选择一个 model call 后查看 Prompt。</div>;
  }
  const needle = promptQuery.trim().toLowerCase();
  const sections = needle
    ? prompt.sections.filter((section) => `${section.label} ${section.source} ${section.content}`.toLowerCase().includes(needle))
    : prompt.sections;
  const copyText = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopyState("copied");
    } catch (error) {
      setCopyState(error instanceof Error ? error.message : "copy failed");
    }
  };
  return (
    <div className="prompt">
      <div className="privacyNote">本地 trace 可能包含完整 prompt、工具输出、文件路径和用户数据；raw 内容只在你打开时加载。</div>
      <div className="promptToolbar">
        <input value={promptQuery} onChange={(event) => setPromptQuery(event.currentTarget.value)} placeholder="在当前 Prompt 中搜索" />
        <button onClick={() => copyText(JSON.stringify(prompt.wireRequestJson, null, 2))}>Copy request JSON</button>
        {copyState ? <span>{copyState}</span> : null}
      </div>
      <div className="section">
        <h2>Wire Request</h2>
        <pre>{JSON.stringify(prompt.wireRequestJson, null, 2)}</pre>
      </div>
      <div className="section">
        <h2>Prompt Sections</h2>
        {prompt.warnings.map((warning) => (
          <p className="warning" key={warning}>
            {warning}
          </p>
        ))}
        {sections.map((section) => (
          <details key={section.id} open={section.kind === "metadata" || section.source === "current_query" || Boolean(needle)}>
            <summary>
              <strong>{section.label}</strong>
              <span>{section.source}</span>
              <span>{section.charCount} chars</span>
              <span>{section.estimatedTokens ?? 0} est tokens</span>
            </summary>
            <div className="sectionActions">
              <button onClick={() => copyText(section.content)}>Copy section</button>
              {section.relatedTimelineNodeId ? (
                <button onClick={() => onOpenTimelineNode?.(section.relatedTimelineNodeId!)}>Show timeline item</button>
              ) : null}
              {section.relatedToolName ? <button onClick={() => onOpenToolCalls?.(section.relatedToolName!)}>Show tool calls</button> : null}
              {section.rawPayloadRef ? <span className="mono">{section.rawPayloadRef}</span> : null}
            </div>
            <pre>{section.content}</pre>
          </details>
        ))}
        {sections.length === 0 ? <div className="empty">当前 Prompt 中没有匹配内容。</div> : null}
      </div>
    </div>
  );
}

export function RawPayload({ payload, error }: { payload?: unknown; error?: string }) {
  const [copyState, setCopyState] = useState("");
  const copyPayload = async () => {
    try {
      await navigator.clipboard.writeText(JSON.stringify(payload, null, 2));
      setCopyState("copied");
    } catch (copyError) {
      setCopyState(copyError instanceof Error ? copyError.message : "copy failed");
    }
  };
  if (error) {
    return <div className="errorBox">{error}</div>;
  }
  if (payload === undefined) {
    return <div className="empty">从详情面板选择 raw payload。</div>;
  }
  return (
    <div className="rawPayload">
      <div className="payloadToolbar">
        <button onClick={copyPayload}>Copy payload JSON</button>
        {copyState ? <span>{copyState}</span> : null}
      </div>
      <pre className="payload">{JSON.stringify(payload, null, 2)}</pre>
    </div>
  );
}

export function AgentGraphView({
  graph,
  onSelectEdge
}: {
  graph?: AgentGraph;
  onSelectEdge: (edgeNodeId: string) => void;
}) {
  if (!graph) {
    return <div className="empty">暂无 Agent Graph。</div>;
  }
  const nodeById = new Map(graph.nodes.map((node) => [node.id, node]));
  return (
    <div className="agentGraph">
      <div className="graphNodes">
        {graph.nodes.map((node) => (
          <div key={node.id} className={node.id === graph.rootThreadId ? "graphNode root" : "graphNode"}>
            <strong>{node.label}</strong>
            <span className="mono">{node.id}</span>
            <span>{node.status ?? "unknown"}</span>
            {node.parentId ? <span>parent {node.parentId}</span> : null}
          </div>
        ))}
      </div>
      <div className="graphEdges">
        <h3>Edges</h3>
        {graph.edges.map((edge) => (
          <button
            key={edge.id}
            className="edgeButton"
            onClick={() => (edge.relatedTimelineNodeId ? onSelectEdge(edge.relatedTimelineNodeId) : undefined)}
          >
            <span className="pill agent_edge">{edge.edgeType}</span>
            <strong>
              {nodeById.get(edge.sourceThreadId ?? "")?.label ?? edge.sourceThreadId ?? "unknown"} {"->"}{" "}
              {nodeById.get(edge.targetThreadId ?? "")?.label ?? edge.targetThreadId ?? "unknown"}
            </strong>
            <span className="mono">{edge.id}</span>
          </button>
        ))}
      </div>
    </div>
  );
}

function Stats({ summary, stats }: { summary?: TraceSummary; stats?: StatsSummary }) {
  if (!summary) {
    return <div className="empty">暂无统计。</div>;
  }
  const durationStats = stats
    ? [
        ["total", stats.totalDurationMs],
        ["turns", stats.turns.totalMs],
        ["inferences", stats.inferences.totalMs],
        ["tools", stats.tools.totalMs],
        ["code cells", stats.codeCells.totalMs],
        ["terminal", stats.terminalOperations.totalMs]
      ]
    : [];
  return (
    <>
      <div className="stats">
        {Object.entries(summary.counts).map(([key, value]) => (
          <div className="stat" key={key}>
            <strong>{value}</strong>
            <span>{key}</span>
          </div>
        ))}
        {stats ? (
          <>
            <div className="stat">
              <strong>{stats.failedToolCalls}</strong>
              <span>failed tools</span>
            </div>
            <div className="stat">
              <strong>{stats.childThreads}</strong>
              <span>child threads</span>
            </div>
            <div className="stat">
              <strong>{stats.tokens.inputTokens}</strong>
              <span>input tokens</span>
            </div>
            <div className="stat">
              <strong>{stats.tokens.cachedInputTokens}</strong>
              <span>cached input</span>
            </div>
            <div className="stat">
              <strong>{stats.tokens.outputTokens}</strong>
              <span>output tokens</span>
            </div>
            <div className="stat">
              <strong>{stats.tokens.reasoningOutputTokens}</strong>
              <span>reasoning output</span>
            </div>
          </>
        ) : null}
      </div>
      {durationStats.length ? (
        <div className="durationTable">
          <h3>Duration</h3>
          {durationStats.map(([label, value]) => (
            <div key={label}>
              <span>{label}</span>
              <strong>{formatDuration(typeof value === "number" ? value : undefined) || "-"}</strong>
            </div>
          ))}
        </div>
      ) : null}
      {stats ? (
        <div className="tokenTables">
          <TokenUsageTable title="Tokens By Inference" rows={stats.tokenUsageByInference} />
          <TokenUsageTable title="Tokens By Turn" rows={stats.tokenUsageByTurn} />
        </div>
      ) : null}
    </>
  );
}

function TokenUsageTable({
  title,
  rows
}: {
  title: string;
  rows: StatsSummary["tokenUsageByInference"];
}) {
  if (rows.length === 0) {
    return null;
  }
  return (
    <div className="tokenTable">
      <h3>{title}</h3>
      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>Input</th>
            <th>Cached</th>
            <th>Output</th>
            <th>Reasoning</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.id}>
              <td className="mono">{row.id}</td>
              <td>{row.inputTokens}</td>
              <td>{row.cachedInputTokens}</td>
              <td>{row.outputTokens}</td>
              <td>{row.reasoningOutputTokens}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function BundleList({
  bundles,
  onSelect
}: {
  bundles: BundleSummary[];
  onSelect: (bundleId: string) => void;
}) {
  if (bundles.length <= 1) {
    return null;
  }
  return (
    <div className="bundleList">
      <h3>Trace Bundles</h3>
      {bundles.map((bundle) => (
        <button key={bundle.id} className={bundle.active ? "selected bundleButton" : "bundleButton"} onClick={() => onSelect(bundle.id)}>
          <strong>{bundle.label}</strong>
          <span>{bundle.updatedAtUnixMs ? new Date(bundle.updatedAtUnixMs).toLocaleString() : ""}</span>
        </button>
      ))}
    </div>
  );
}

function App() {
  const [bundles, setBundles] = useState<BundleSummary[]>([]);
  const [summary, setSummary] = useState<TraceSummary & { bundlePath?: string }>();
  const [stats, setStats] = useState<StatsSummary>();
  const [agentGraph, setAgentGraph] = useState<AgentGraph>();
  const [threads, setThreads] = useState<ThreadTreeNode[]>([]);
  const [timeline, setTimeline] = useState<TimelineNode[]>([]);
  const timelineRef = useRef<TimelineNode[]>([]);
  const [freshNodeKeys, setFreshNodeKeys] = useState<Set<string>>(() => new Set());
  const [selectedThread, setSelectedThread] = useState<string>();
  const [selectedNode, setSelectedNode] = useState<TimelineNode>();
  const [selectedInference, setSelectedInference] = useState<InferenceCall>();
  const [selectedTool, setSelectedTool] = useState<ToolCall>();
  const [selectedCodeCell, setSelectedCodeCell] = useState<CodeCell>();
  const [selectedTerminal, setSelectedTerminal] = useState<TerminalOperation>();
  const [tab, setTab] = useState<Tab>("timeline");
  const [prompt, setPrompt] = useState<PromptView>();
  const [payload, setPayload] = useState<unknown>();
  const [payloadError, setPayloadError] = useState<string>();
  const [query, setQuery] = useState("");
  const [liveState, setLiveState] = useState("connecting");
  const [followLatest, setFollowLatest] = useState(true);
  const [filters, setFilters] = useState<TimelineFilters>(() => defaultFilters());
  const flatThreads = useMemo(() => flattenThreads(threads), [threads]);
  const filteredTimeline = useMemo(() => filterTimeline(timeline, filters), [timeline, filters]);

  const load = async (threadId = selectedThread, options: { markNew?: boolean } = {}) => {
    const [bundleList, traceSummary, tree, nodes, graph, statsSummary] = await Promise.all([
      getJson<BundleSummary[]>("/api/bundles"),
      getJson<TraceSummary & { bundlePath?: string }>("/api/trace"),
      getJson<ThreadTreeNode[]>("/api/threads"),
      getJson<TimelineNode[]>(threadId ? `/api/timeline?threadId=${encodeURIComponent(threadId)}` : "/api/timeline"),
      getJson<AgentGraph>("/api/agent-graph"),
      getJson<StatsSummary>("/api/stats")
    ]);
    setBundles(bundleList);
    setSummary(traceSummary);
    setThreads(tree);
    if (options.markNew) {
      const previous = new Set(timelineRef.current.map((node) => `${node.type}:${node.id}`));
      setFreshNodeKeys(new Set(nodes.map((node) => `${node.type}:${node.id}`).filter((key) => !previous.has(key))));
    } else {
      setFreshNodeKeys(new Set());
    }
    timelineRef.current = nodes;
    setTimeline(nodes);
    setAgentGraph(graph);
    setStats(statsSummary);
    if (followLatest && nodes.length > 0) {
      setSelectedNode(nodes[nodes.length - 1]);
    }
  };

  useEffect(() => {
    load().catch((error) => setLiveState(`error: ${error.message}`));
  }, []);

  useEffect(() => {
    const events = new EventSource("/api/watch");
    events.addEventListener("connected", () => setLiveState("live"));
    events.addEventListener("trace_updated", () => {
      setLiveState("live");
      load(selectedThread, { markNew: true }).catch((error) => setLiveState(`error: ${error.message}`));
    });
    events.addEventListener("bundles_updated", (event) => {
      setLiveState("live");
      const data = JSON.parse((event as MessageEvent).data) as BundlesUpdatedEvent;
      const latest = data.bundles?.[0];
      if (followLatest && latest && !latest.active) {
        setSelectedThread(undefined);
        setSelectedNode(undefined);
        setPrompt(undefined);
        setPayload(undefined);
        getJson(`/api/bundles/select?id=${encodeURIComponent(latest.id)}`)
          .then(() => load(undefined, { markNew: true }))
          .catch((error) => setLiveState(`error: ${error.message}`));
        return;
      }
      load(selectedThread, { markNew: true }).catch((error) => setLiveState(`error: ${error.message}`));
    });
    events.addEventListener("bundle_selected", () => {
      setLiveState("live");
      load(undefined).catch((error) => setLiveState(`error: ${error.message}`));
    });
    events.addEventListener("trace_error", (event) => {
      setLiveState(`error: ${(event as MessageEvent).data}`);
    });
    events.onerror = () => setLiveState("reconnecting");
    return () => events.close();
  }, [selectedThread, followLatest]);

  useEffect(() => {
    setSelectedInference(undefined);
    setSelectedTool(undefined);
    setSelectedCodeCell(undefined);
    setSelectedTerminal(undefined);
    if (!selectedNode) {
      return;
    }
    if (selectedNode.type === "inference") {
      getJson<InferenceCall>(`/api/inferences/${encodeURIComponent(selectedNode.id)}`)
        .then(setSelectedInference)
        .catch((error) => setLiveState(`error: ${error.message}`));
    }
    if (selectedNode.type === "tool") {
      getJson<ToolCall>(`/api/tools/${encodeURIComponent(selectedNode.id)}`)
        .then(setSelectedTool)
        .catch((error) => setLiveState(`error: ${error.message}`));
    }
    if (selectedNode.type === "code_cell") {
      getJson<CodeCell>(`/api/code-cells/${encodeURIComponent(selectedNode.id)}`)
        .then(setSelectedCodeCell)
        .catch((error) => setLiveState(`error: ${error.message}`));
    }
    if (selectedNode.type === "terminal") {
      getJson<TerminalOperation>(`/api/terminals/${encodeURIComponent(selectedNode.id)}`)
        .then(setSelectedTerminal)
        .catch((error) => setLiveState(`error: ${error.message}`));
    }
  }, [selectedNode]);

  const selectThread = (threadId?: string) => {
    setSelectedThread(threadId);
    setSelectedNode(undefined);
    timelineRef.current = [];
    load(threadId).catch((error) => setLiveState(`error: ${error.message}`));
  };

  const selectBundle = async (bundleId: string) => {
    setSelectedThread(undefined);
    setSelectedNode(undefined);
    setPrompt(undefined);
    setPayload(undefined);
    setPayloadError(undefined);
    setSelectedInference(undefined);
    setSelectedTool(undefined);
    setSelectedCodeCell(undefined);
    setSelectedTerminal(undefined);
    setAgentGraph(undefined);
    setStats(undefined);
    setTab("timeline");
    await getJson(`/api/bundles/select?id=${encodeURIComponent(bundleId)}`);
    timelineRef.current = [];
    await load(undefined);
  };

  const runSearch = async () => {
    if (!query.trim()) {
      await load();
      return;
    }
    setTimeline(await getJson<TimelineNode[]>(`/api/search?q=${encodeURIComponent(query)}`));
  };

  const openPrompt = async (inferenceId: string) => {
    setPrompt(await getJson<PromptView>(`/api/inferences/${encodeURIComponent(inferenceId)}/prompt`));
    setTab("prompt");
  };

  const openPayload = async (payloadId: string) => {
    setPayload(undefined);
    setPayloadError(undefined);
    setTab("payload");
    try {
      setPayload(await getJson(`/api/payloads/${encodeURIComponent(payloadId)}`));
    } catch (error) {
      setPayloadError(error instanceof Error ? error.message : String(error));
    }
  };

  const selectAgentEdge = (edgeNodeId: string) => {
    const node = timeline.find((item) => item.type === "agent_edge" && item.id === edgeNodeId);
    if (node) {
      setSelectedNode(node);
      setTab("timeline");
    }
  };

  const selectTimelineNodeById = (nodeId: string) => {
    const node = timeline.find((item) => item.id === nodeId);
    if (node) {
      setSelectedNode(node);
      setTab("timeline");
    }
  };

  const showToolCalls = (toolName: string) => {
    setFilters({ ...defaultFilters(), tool: toolName });
    setTab("timeline");
  };

  return (
    <main>
      <header>
        <div>
          <h1>Codex Trace Viewer</h1>
          <p>{summary?.bundlePath ?? "loading..."}</p>
        </div>
        <div className="headerActions">
          <label>
            <input type="checkbox" checked={followLatest} onChange={(event) => setFollowLatest(event.currentTarget.checked)} />
            跟随最新请求
          </label>
          <span className="live">{liveState}</span>
        </div>
      </header>
      <aside>
        <BundleList bundles={bundles} onSelect={(bundleId) => selectBundle(bundleId).catch((error) => setLiveState(`error: ${error.message}`))} />
        <div className="search">
          <input value={query} onChange={(event) => setQuery(event.currentTarget.value)} placeholder="搜索 call_id / 文本" />
          <button onClick={runSearch}>搜索</button>
        </div>
        <TimelineFilterPanel filters={filters} onChange={setFilters} />
        <ThreadTree nodes={threads} selectedThread={selectedThread} onSelect={selectThread} />
        <div className="smallList">
          <h3>Threads</h3>
          {flatThreads.map((thread) => (
            <span key={thread.id} className="mono">
              {thread.id}
            </span>
          ))}
        </div>
      </aside>
      <section className="center">
        <nav>
          {(["timeline", "prompt", "agent", "payload", "stats"] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? "selected tab" : "tab"} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </nav>
        {tab === "timeline" ? (
          <Timeline
            nodes={filteredTimeline}
            freshNodeKeys={freshNodeKeys}
            selectedNode={selectedNode}
            highlightQuery={query}
            onSelect={setSelectedNode}
          />
        ) : null}
        {tab === "prompt" ? (
          <PromptInspector prompt={prompt} onOpenTimelineNode={selectTimelineNodeById} onOpenToolCalls={showToolCalls} />
        ) : null}
        {tab === "agent" ? <AgentGraphView graph={agentGraph} onSelectEdge={selectAgentEdge} /> : null}
        {tab === "payload" ? <RawPayload payload={payload} error={payloadError} /> : null}
        {tab === "stats" ? <Stats summary={summary} stats={stats} /> : null}
      </section>
      <aside className="right">
        <Details
          node={selectedNode}
          inference={selectedInference}
          tool={selectedTool}
          codeCell={selectedCodeCell}
          terminal={selectedTerminal}
          onOpenPrompt={openPrompt}
          onOpenPayload={openPayload}
        />
      </aside>
    </main>
  );
}

const root = document.getElementById("root");
if (root) {
  createRoot(root).render(<App />);
}
