import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AgentGraph, BundleSummary, PromptView, StatsSummary, ThreadTreeNode, TimelineNode, TraceSummary } from "../../shared/types";
import "./styles.css";

type Tab = "timeline" | "prompt" | "agent" | "payload" | "stats";

interface TimelineFilters {
  types: Set<TimelineNode["type"]>;
  status: string;
  model: string;
  tool: string;
  failedOnly: boolean;
  slowMs: string;
}

const timelineTypes: TimelineNode["type"][] = ["turn", "conversation", "inference", "tool", "terminal", "compaction", "agent_edge"];

function defaultFilters(): TimelineFilters {
  return {
    types: new Set(timelineTypes),
    status: "",
    model: "",
    tool: "",
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

function filterTimeline(nodes: TimelineNode[], filters: TimelineFilters): TimelineNode[] {
  const status = filters.status.trim().toLowerCase();
  const model = filters.model.trim().toLowerCase();
  const tool = filters.tool.trim().toLowerCase();
  const slowMs = Number(filters.slowMs);
  return nodes.filter((node) => {
    if (!filters.types.has(node.type)) {
      return false;
    }
    if (filters.failedOnly && !isFailedStatus(node.status)) {
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
    if (Number.isFinite(slowMs) && slowMs > 0 && (node.durationMs ?? 0) < slowMs) {
      return false;
    }
    return true;
  });
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
  selectedNode,
  onSelect
}: {
  nodes: TimelineNode[];
  selectedNode?: TimelineNode;
  onSelect: (node: TimelineNode) => void;
}) {
  return (
    <div className="timeline">
      {nodes.map((node) => (
        <button
          key={`${node.type}:${node.id}`}
          className={selectedNode?.id === node.id && selectedNode.type === node.type ? "timelineNode selected" : "timelineNode"}
          onClick={() => onSelect(node)}
        >
          <div className="nodeHeader">
            <span className={`pill ${node.type}`}>{node.type}</span>
            <strong>{node.label}</strong>
            <span>{formatTime(node.startedAtUnixMs)}</span>
          </div>
          {node.summary ? <p>{node.summary}</p> : null}
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
  onOpenPrompt,
  onOpenPayload
}: {
  node?: TimelineNode;
  onOpenPrompt: (inferenceId: string) => void;
  onOpenPayload: (payloadId: string) => void;
}) {
  if (!node) {
    return <div className="empty">选择一个 timeline 节点查看详情。</div>;
  }
  return (
    <div className="details">
      <h2>{node.label}</h2>
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

function PromptInspector({ prompt }: { prompt?: PromptView }) {
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

function RawPayload({ payload }: { payload?: unknown }) {
  if (payload === undefined) {
    return <div className="empty">从详情面板选择 raw payload。</div>;
  }
  return <pre className="payload">{JSON.stringify(payload, null, 2)}</pre>;
}

function AgentGraphView({
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
    </>
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
  const [selectedThread, setSelectedThread] = useState<string>();
  const [selectedNode, setSelectedNode] = useState<TimelineNode>();
  const [tab, setTab] = useState<Tab>("timeline");
  const [prompt, setPrompt] = useState<PromptView>();
  const [payload, setPayload] = useState<unknown>();
  const [query, setQuery] = useState("");
  const [liveState, setLiveState] = useState("connecting");
  const [followLatest, setFollowLatest] = useState(true);
  const [filters, setFilters] = useState<TimelineFilters>(() => defaultFilters());
  const flatThreads = useMemo(() => flattenThreads(threads), [threads]);
  const filteredTimeline = useMemo(() => filterTimeline(timeline, filters), [timeline, filters]);

  const load = async (threadId = selectedThread) => {
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
      load().catch((error) => setLiveState(`error: ${error.message}`));
    });
    events.addEventListener("bundles_updated", () => {
      setLiveState("live");
      load().catch((error) => setLiveState(`error: ${error.message}`));
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

  const selectThread = (threadId?: string) => {
    setSelectedThread(threadId);
    setSelectedNode(undefined);
    load(threadId).catch((error) => setLiveState(`error: ${error.message}`));
  };

  const selectBundle = async (bundleId: string) => {
    setSelectedThread(undefined);
    setSelectedNode(undefined);
    setPrompt(undefined);
    setPayload(undefined);
    setAgentGraph(undefined);
    setStats(undefined);
    setTab("timeline");
    await getJson(`/api/bundles/select?id=${encodeURIComponent(bundleId)}`);
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
    setPayload(await getJson(`/api/payloads/${encodeURIComponent(payloadId)}`));
    setTab("payload");
  };

  const selectAgentEdge = (edgeNodeId: string) => {
    const node = timeline.find((item) => item.type === "agent_edge" && item.id === edgeNodeId);
    if (node) {
      setSelectedNode(node);
      setTab("timeline");
    }
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
        {tab === "timeline" ? <Timeline nodes={filteredTimeline} selectedNode={selectedNode} onSelect={setSelectedNode} /> : null}
        {tab === "prompt" ? <PromptInspector prompt={prompt} /> : null}
        {tab === "agent" ? <AgentGraphView graph={agentGraph} onSelectEdge={selectAgentEdge} /> : null}
        {tab === "payload" ? <RawPayload payload={payload} /> : null}
        {tab === "stats" ? <Stats summary={summary} stats={stats} /> : null}
      </section>
      <aside className="right">
        <Details node={selectedNode} onOpenPrompt={openPrompt} onOpenPayload={openPayload} />
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
