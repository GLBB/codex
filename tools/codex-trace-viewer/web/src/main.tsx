import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import type { BundleSummary, PromptView, ThreadTreeNode, TimelineNode, TraceSummary } from "../../shared/types";
import "./styles.css";

type Tab = "timeline" | "prompt" | "payload" | "stats";

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

function flattenThreads(nodes: ThreadTreeNode[]): ThreadTreeNode[] {
  return nodes.flatMap((node) => [node, ...flattenThreads(node.children)]);
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
  if (!prompt) {
    return <div className="empty">选择一个 model call 后查看 Prompt。</div>;
  }
  return (
    <div className="prompt">
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
        {prompt.sections.map((section) => (
          <details key={section.id} open={section.kind === "metadata" || section.source === "current_query"}>
            <summary>
              <strong>{section.label}</strong>
              <span>{section.source}</span>
              <span>{section.charCount} chars</span>
            </summary>
            <pre>{section.content}</pre>
          </details>
        ))}
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

function Stats({ summary }: { summary?: TraceSummary }) {
  if (!summary) {
    return <div className="empty">暂无统计。</div>;
  }
  return (
    <div className="stats">
      {Object.entries(summary.counts).map(([key, value]) => (
        <div className="stat" key={key}>
          <strong>{value}</strong>
          <span>{key}</span>
        </div>
      ))}
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
  const flatThreads = useMemo(() => flattenThreads(threads), [threads]);

  const load = async (threadId = selectedThread) => {
    const [bundleList, traceSummary, tree, nodes] = await Promise.all([
      getJson<BundleSummary[]>("/api/bundles"),
      getJson<TraceSummary & { bundlePath?: string }>("/api/trace"),
      getJson<ThreadTreeNode[]>("/api/threads"),
      getJson<TimelineNode[]>(threadId ? `/api/timeline?threadId=${encodeURIComponent(threadId)}` : "/api/timeline")
    ]);
    setBundles(bundleList);
    setSummary(traceSummary);
    setThreads(tree);
    setTimeline(nodes);
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
          {(["timeline", "prompt", "payload", "stats"] as Tab[]).map((item) => (
            <button key={item} className={tab === item ? "selected tab" : "tab"} onClick={() => setTab(item)}>
              {item}
            </button>
          ))}
        </nav>
        {tab === "timeline" ? <Timeline nodes={timeline} selectedNode={selectedNode} onSelect={setSelectedNode} /> : null}
        {tab === "prompt" ? <PromptInspector prompt={prompt} /> : null}
        {tab === "payload" ? <RawPayload payload={payload} /> : null}
        {tab === "stats" ? <Stats summary={summary} /> : null}
      </section>
      <aside className="right">
        <Details node={selectedNode} onOpenPrompt={openPrompt} onOpenPayload={openPayload} />
      </aside>
    </main>
  );
}

createRoot(document.getElementById("root")!).render(<App />);
