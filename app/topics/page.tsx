"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const BACKEND = "/api";

const TOPIC_COLORS = [
  "#6366f1", "#8b5cf6", "#06b6d4", "#10b981",
  "#f59e0b", "#ef4444", "#ec4899", "#84cc16",
];

// ── Types ──────────────────────────────────────────────────── //
type TopicNode = {
  id: number;
  name: string;
  description: string;
  chunk_count: number;
  color: string;
  nodeType: "topic";
  x?: number;
  y?: number;
};

type DocNode = {
  id: string;          // "doc-{id}"
  docId: number;
  name: string;
  nodeType: "document";
  parentTopic: number;
  x?: number;
  y?: number;
};

type GraphNode = TopicNode | DocNode;

type GraphLink = {
  source: number | string | GraphNode;
  target: number | string | GraphNode;
  similarity: number;
};

type GraphData = { nodes: GraphNode[]; links: GraphLink[] };

type TopicDoc = {
  id: number;
  title: string;
  url: string;
  excerpt: string;
  captured_at: string;
  topic_id: number;
};

type Gap = {
  topic_a: string;
  topic_b: string;
  similarity: number;
  suggestion: string;
};

// ── Helpers ────────────────────────────────────────────────── //
async function authFetch(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });
}

function timeAgo(dateStr: string) {
  const d    = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days < 1)  return "today";
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function hostname(url: string) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
}

function nodeId(n: GraphNode | number | string): number | string {
  return typeof n === "object" ? n.id : n;
}

// ── Icons ──────────────────────────────────────────────────── //
const IconBrain = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
    <path d="M17.599 6.5a3 3 0 0 0 .399-1.375"/>
    <path d="M6.003 5.125A3 3 0 0 0 6.401 6.5"/>
    <path d="M3.477 10.896a4 4 0 0 1 .585-.396"/>
    <path d="M19.938 10.5a4 4 0 0 1 .585.396"/>
    <path d="M6 18a4 4 0 0 1-1.967-.516"/>
    <path d="M19.967 17.484A4 4 0 0 1 18 18"/>
  </svg>
);

const IconHome = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const IconGraph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);

const IconRefresh = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="23 4 23 10 17 10"/>
    <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"/>
  </svg>
);

// ── Page ───────────────────────────────────────────────────── //
export default function TopicsPage() {
  const router = useRouter();
  const fgRef  = useRef<any>(null);

  const [graphData, setGraphData]           = useState<GraphData>({ nodes: [], links: [] });
  const [topicDocsMap, setTopicDocsMap]     = useState<Record<number, TopicDoc[]>>({});
  const [gaps, setGaps]                     = useState<Gap[]>([]);
  const [selectedTopic, setSelectedTopic]   = useState<TopicNode | null>(null);
  const [hoveredNode, setHoveredNode]       = useState<GraphNode | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<number | string>>(new Set());
  const [loadingGraph, setLoadingGraph]     = useState(true);
  const [rebuilding, setRebuilding]         = useState(false);
  const [rebuildMsg, setRebuildMsg]         = useState("");
  const [autoRebuildMsg, setAutoRebuildMsg] = useState("");
  const [notEnoughData, setNotEnoughData]   = useState(false);
  const [dimensions, setDimensions]         = useState({ width: 800, height: 600 });

  // Stable refs so canvas callbacks don't capture stale closure values
  const hoveredNodeRef    = useRef<GraphNode | null>(null);
  const highlightNodesRef = useRef<Set<number | string>>(new Set());
  hoveredNodeRef.current    = hoveredNode;
  highlightNodesRef.current = highlightNodes;

  // Canvas dimensions
  useEffect(() => {
    const update = () =>
      setDimensions({
        width:  Math.max(400, window.innerWidth - 228),
        height: Math.max(400, window.innerHeight - 120),
      });
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);

  // Auth + initial load
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/"); return; }
      loadWithAutoRebuild();
      fetchGaps();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Customise D3 forces whenever graphData changes and the component is mounted
  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return;

    const charge = fgRef.current.d3Force("charge");
    if (charge) {
      charge.strength((node: GraphNode) =>
        node.nodeType === "topic" ? -200 : -30
      );
    }

    const link = fgRef.current.d3Force("link");
    if (link) {
      link.distance((l: any) => {
        const tgt = nodeId(l.target);
        return typeof tgt === "string" && tgt.startsWith("doc-") ? 35 : 80;
      });
    }

    fgRef.current.d3ReheatSimulation();
  }, [graphData]);

  // ── Data fetching ─────────────────────────────────────────── //

  // Shared graph-building logic — accepts already-fetched topic data.
  // Fetches doc satellites, saves docCount to localStorage, updates state.
  async function buildGraph(topicData: { nodes: any[]; edges: any[] }) {
    const topicNodes: TopicNode[] = (topicData.nodes ?? []).map((n: any) => ({
      ...n,
      nodeType: "topic",
      color: TOPIC_COLORS[n.id % TOPIC_COLORS.length],
    }));

    const topicEdges: GraphLink[] = (topicData.edges ?? []).map((e: any) => ({
      source: e.source,
      target: e.target,
      similarity: e.similarity,
    }));

    const docResults: TopicDoc[][] = await Promise.all(
      topicNodes.map(t =>
        authFetch(`${BACKEND}/topics/${t.id}/chunks`)
          .then(r => r.json())
          .catch(() => [])
      )
    );

    const newDocsMap: Record<number, TopicDoc[]> = {};
    const docNodes:  DocNode[]   = [];
    const docLinks:  GraphLink[] = [];

    topicNodes.forEach((topic, i) => {
      const docs: TopicDoc[] = Array.isArray(docResults[i]) ? docResults[i] : [];
      newDocsMap[topic.id] = docs;
      docs.forEach(doc => {
        docNodes.push({
          id: `doc-${doc.id}`,
          docId: doc.id,
          name: (doc.title ?? "Untitled").slice(0, 30),
          nodeType: "document",
          parentTopic: topic.id,
        });
        docLinks.push({ source: topic.id, target: `doc-${doc.id}`, similarity: 0.3 });
      });
    });

    // Persist the doc count so future page loads can detect new captures
    localStorage.setItem("sb_topics_rebuild_doc_count", String(docNodes.length));

    setTopicDocsMap(newDocsMap);
    setGraphData({
      nodes: [...topicNodes, ...docNodes],
      links: [...topicEdges, ...docLinks],
    });
  }

  // Used by manual Rebuild button — fetches fresh data then builds the graph.
  async function fetchTopics() {
    setLoadingGraph(true);
    try {
      const res  = await authFetch(`${BACKEND}/topics`);
      const data = await res.json();
      await buildGraph(data);
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGraph(false);
    }
  }

  // Initial page load — auto-rebuilds if no topics exist or new captures detected.
  async function loadWithAutoRebuild() {
    setLoadingGraph(true);
    setNotEnoughData(false);
    try {
      // Fetch topics and current capture count in parallel
      const [topicsRes, docsRes] = await Promise.all([
        authFetch(`${BACKEND}/topics`),
        authFetch(`${BACKEND}/documents?limit=500`),
      ]);
      const topicsData     = await topicsRes.json();
      const docsData       = await docsRes.json();
      const currentCount   = Array.isArray(docsData) ? docsData.length : 0;
      const storedCount    = parseInt(localStorage.getItem("sb_topics_rebuild_doc_count") ?? "0", 10);

      const noTopics    = !topicsData.nodes || topicsData.nodes.length === 0;
      const newCaptures = !noTopics && currentCount > storedCount + 4;

      if (noTopics || newCaptures) {
        const msg = noTopics
          ? "Building your knowledge graph for the first time..."
          : `${currentCount - storedCount} new captures detected — updating your graph...`;
        setAutoRebuildMsg(msg);
        setRebuilding(true);

        const rebuildRes  = await authFetch(`${BACKEND}/topics/rebuild`, { method: "POST" });
        const rebuildData = await rebuildRes.json();

        if (rebuildData.status === "not_enough_data") {
          setNotEnoughData(true);
          return;
        }

        const freshRes  = await authFetch(`${BACKEND}/topics`);
        const freshData = await freshRes.json();
        await buildGraph(freshData);
        setAutoRebuildMsg("");
      } else {
        await buildGraph(topicsData);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGraph(false);
      setRebuilding(false);
    }
  }

  async function fetchGaps() {
    try {
      const res  = await authFetch(`${BACKEND}/topics/gaps`);
      const data = await res.json();
      setGaps(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    }
  }

  async function handleRebuild() {
    setRebuilding(true);
    setRebuildMsg("");
    try {
      const res  = await authFetch(`${BACKEND}/topics/rebuild`, { method: "POST" });
      const data = await res.json();
      if (data.status === "not_enough_data") {
        setRebuildMsg("Need at least 10 captures to build topics.");
      } else {
        setRebuildMsg(`Rebuilt — ${data.topics_created} topics created.`);
        await Promise.all([fetchTopics(), fetchGaps()]);
      }
    } catch (e) {
      console.error(e);
      setRebuildMsg("Rebuild failed. Try again.");
    } finally {
      setRebuilding(false);
      setTimeout(() => setRebuildMsg(""), 6000);
    }
  }

  // ── Graph interaction ─────────────────────────────────────── //
  function handleNodeClick(node: GraphNode) {
    if (node.nodeType === "document") {
      router.push(`/document/${(node as DocNode).docId}`);
      return;
    }
    const topic = node as TopicNode;
    setSelectedTopic(topic);
  }

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoveredNode(node ?? null);
    const hl = new Set<number | string>();
    if (node) {
      hl.add(node.id);
      // Walk links — after D3 runs, source/target may be node objects
      setGraphData(prev => {
        prev.links.forEach(link => {
          const s = nodeId(link.source);
          const t = nodeId(link.target);
          if (s === node.id) hl.add(t);
          if (t === node.id) hl.add(s);
        });
        return prev;
      });
    }
    setHighlightNodes(hl);
  }, []);

  // ── Canvas renderers ──────────────────────────────────────── //
  const paintNode = useCallback((
    node: GraphNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const nx       = node.x ?? 0;
    const ny       = node.y ?? 0;
    const hovered   = hoveredNodeRef.current;
    const highlight = highlightNodesRef.current;
    const isHovered    = hovered?.id === node.id;
    const isConnected  = highlight.has(node.id);
    const dimmed       = hovered !== null && !isConnected && !isHovered;

    if (node.nodeType === "topic") {
      const t = node as TopicNode;
      const r = Math.sqrt(t.chunk_count ?? 1) * 3 + 4;

      // Glow
      ctx.shadowBlur  = isHovered ? 22 : 12;
      ctx.shadowColor = t.color;

      ctx.beginPath();
      ctx.arc(nx, ny, r, 0, 2 * Math.PI);
      ctx.fillStyle = dimmed ? t.color + "44" : t.color;
      ctx.fill();
      ctx.shadowBlur = 0;

      // Label (only when zoomed enough)
      if (globalScale > 0.5) {
        const fontSize = Math.max(10, 12 / globalScale);
        ctx.font         = `${fontSize}px -apple-system, sans-serif`;
        ctx.textAlign    = "center";
        ctx.textBaseline = "top";
        ctx.fillStyle    = dimmed ? "rgba(255,255,255,0.2)" : "rgba(255,255,255,0.9)";
        ctx.fillText(t.name, nx, ny + r + 4 / globalScale);
      }
    } else {
      // Document satellite — small white dot
      ctx.beginPath();
      ctx.arc(nx, ny, 2.5, 0, 2 * Math.PI);
      ctx.fillStyle = dimmed ? "rgba(255,255,255,0.1)" : "rgba(255,255,255,0.6)";
      ctx.fill();
    }
  }, []);

  const paintNodePointer = useCallback((
    node: GraphNode,
    color: string,
    ctx: CanvasRenderingContext2D,
  ) => {
    const r = node.nodeType === "topic"
      ? Math.sqrt((node as TopicNode).chunk_count ?? 1) * 3 + 10
      : 8;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const getLinkColor = useCallback((link: GraphLink) => {
    const hovered = hoveredNodeRef.current;
    const sim     = (link as any).similarity ?? 0.5;
    const isDocLink = sim <= 0.3;

    if (hovered) {
      const s = nodeId(link.source);
      const t = nodeId(link.target);
      if (s !== hovered.id && t !== hovered.id) return "rgba(255,255,255,0.03)";
      return `rgba(255,255,255,${sim * 0.55})`;
    }
    return isDocLink
      ? "rgba(255,255,255,0.07)"
      : `rgba(255,255,255,${sim * 0.3})`;
  }, []);

  const getLinkWidth = useCallback((link: GraphLink) => {
    const sim = (link as any).similarity ?? 0.5;
    return sim <= 0.3 ? 0.4 : sim * 1.5;
  }, []);

  // ── Derived counts ────────────────────────────────────────── //
  const topicCount = graphData.nodes.filter(n => n.nodeType === "topic").length;
  const docCount   = graphData.nodes.filter(n => n.nodeType === "document").length;
  const isEmpty    = !loadingGraph && topicCount === 0;

  return (
    <div className="app-layout">

      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <Link href="/" className="sidebar-logo">
          <div className="sidebar-logo-icon"><IconBrain /></div>
          <span className="sidebar-logo-text">Second Brain</span>
        </Link>

        <nav className="sidebar-nav">
          <Link href="/" className="sidebar-item">
            <IconHome /><span>Home</span>
          </Link>
          <Link href="/topics" className="sidebar-item active">
            <IconGraph /><span>Topics</span>
          </Link>
        </nav>

        <div className="sidebar-footer">
          <button
            className="sidebar-signout"
            onClick={() => supabase.auth.signOut().then(() => router.push("/"))}
          >
            Sign out
          </button>
        </div>
      </aside>

      {/* ── Main ────────────────────────────────────── */}
      <main className="main-content" style={{ overflow: "hidden", display: "flex", flexDirection: "column" }}>

        {/* Title bar */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "20px 28px", height: "64px", flexShrink: 0,
        }}>
          <div>
            <h1 style={{ fontSize: "18px", fontWeight: 600, color: "var(--text-1)", lineHeight: 1 }}>
              Knowledge Graph
            </h1>
            {!loadingGraph && topicCount > 0 && (
              <p style={{ fontSize: "11.5px", color: "var(--text-3)", marginTop: "4px" }}>
                {topicCount} topics · {docCount} documents · {graphData.links.filter(l => (l as any).similarity > 0.3).length} connections
              </p>
            )}
          </div>

          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {rebuildMsg && (
              <span style={{ fontSize: "12px", color: rebuildMsg.startsWith("Need") ? "var(--amber)" : "var(--green)" }}>
                {rebuildMsg}
              </span>
            )}
            <button className="btn btn-primary" onClick={handleRebuild} disabled={rebuilding}>
              {rebuilding
                ? <><div className="spinner spinner-sm spinner-white" />Rebuilding...</>
                : <><IconRefresh />Rebuild Graph</>}
            </button>
          </div>
        </div>

        {/* Graph */}
        <div style={{ flex: 1, position: "relative" }}>
          {loadingGraph ? (
            <div style={{
              height: dimensions.height,
              display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center",
              gap: "14px", color: "var(--text-2)", fontSize: "14px",
            }}>
              <div className="spinner" />
              <span>{autoRebuildMsg || "Loading graph..."}</span>
              {autoRebuildMsg && (
                <span style={{ fontSize: "12px", color: "var(--text-3)" }}>
                  This may take 10–20 seconds
                </span>
              )}
            </div>
          ) : notEnoughData ? (
            <div style={{ padding: "28px" }}>
              <div className="empty-state">
                <p>Not enough captures yet.<br />
                  <span style={{ fontSize: "12px", color: "var(--text-3)" }}>
                    Save at least 10 pages using the extension, then come back.
                  </span>
                </p>
              </div>
            </div>
          ) : isEmpty ? (
            <div style={{ padding: "28px" }}>
              <div className="empty-state">
                <p>No topics yet.<br />
                  <span style={{ fontSize: "12px", color: "var(--text-3)" }}>
                    Capture at least 10 pages and click Rebuild Graph.
                  </span>
                </p>
              </div>
            </div>
          ) : (
            <ForceGraph2D
              ref={fgRef}
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="#0a0a0f"
              nodeLabel={(node) => (node as GraphNode).nodeType === "topic" ? "" : (node as GraphNode).name}
              nodeCanvasObject={paintNode as any}
              nodeCanvasObjectMode={() => "replace"}
              nodePointerAreaPaint={paintNodePointer as any}
              onNodeClick={handleNodeClick as any}
              onNodeHover={handleNodeHover as any}
              linkColor={getLinkColor as any}
              linkWidth={getLinkWidth as any}
              linkDirectionalParticles={0}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
              cooldownTime={3000}
            />
          )}
        </div>

        {/* Knowledge Gaps */}
        {gaps.length > 0 && (
          <div style={{ padding: "0 28px 40px", flexShrink: 0 }}>
            <div className="section-label" style={{ marginBottom: "12px" }}>Knowledge Gaps</div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {gaps.map((gap, i) => (
                <div
                  key={i}
                  className="card"
                  style={{ padding: "14px 18px", display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px" }}
                >
                  <p style={{ fontSize: "13.5px", color: "var(--text-2)", lineHeight: 1.55, flex: 1 }}>
                    {gap.suggestion}
                  </p>
                  <button
                    className="btn btn-ghost"
                    style={{ flexShrink: 0, fontSize: "12px", padding: "6px 12px" }}
                    onClick={() => router.push(`/?q=${encodeURIComponent(`${gap.topic_a} ${gap.topic_b}`)}`)}
                  >
                    Explore →
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}
      </main>

      {/* ── Side panel ──────────────────────────────── */}
      {selectedTopic && (
        <div style={{
          position: "fixed", top: 0, right: 0, bottom: 0, width: "320px",
          background: "var(--surface)",
          borderLeft: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
          zIndex: 30,
          animation: "slideIn 0.18s ease forwards",
        }}>
          {/* Colour accent strip */}
          <div style={{ height: "3px", background: selectedTopic.color, flexShrink: 0 }} />

          {/* Header */}
          <div style={{
            padding: "18px 20px 14px",
            borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "flex-start", gap: "12px",
          }}>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ fontSize: "15px", fontWeight: 600, color: "var(--text-1)", lineHeight: 1.3 }}>
                {selectedTopic.name}
              </h2>
              {selectedTopic.description && (
                <p style={{ fontSize: "12.5px", color: "var(--text-2)", marginTop: "6px", lineHeight: 1.55 }}>
                  {selectedTopic.description}
                </p>
              )}
              <span
                className="badge"
                style={{
                  marginTop: "10px",
                  background: selectedTopic.color + "22",
                  color: selectedTopic.color,
                  border: `1px solid ${selectedTopic.color}44`,
                }}
              >
                {selectedTopic.chunk_count} capture{selectedTopic.chunk_count !== 1 ? "s" : ""}
              </span>
            </div>
            <button
              onClick={() => setSelectedTopic(null)}
              style={{
                background: "none", border: "none", color: "var(--text-3)",
                fontSize: "20px", lineHeight: 1, padding: "2px", flexShrink: 0,
              }}
              onMouseOver={e => (e.currentTarget.style.color = "var(--text-1)")}
              onMouseOut={e  => (e.currentTarget.style.color = "var(--text-3)")}
            >
              ×
            </button>
          </div>

          {/* Document list */}
          <div style={{ flex: 1, overflowY: "auto", padding: "16px" }}>
            <div className="section-label" style={{ marginBottom: "10px" }}>
              Documents · {(topicDocsMap[selectedTopic.id] ?? []).length}
            </div>

            {(topicDocsMap[selectedTopic.id] ?? []).length === 0 ? (
              <p style={{ fontSize: "13px", color: "var(--text-3)" }}>No documents found.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {(topicDocsMap[selectedTopic.id] ?? []).map(doc => (
                  <Link
                    key={doc.id}
                    href={`/document/${doc.id}`}
                    className="card card-link"
                    style={{ padding: "12px 14px", display: "block" }}
                  >
                    <p style={{
                      fontSize: "13px", fontWeight: 500, color: "var(--text-1)",
                      lineHeight: 1.4, marginBottom: "3px",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap",
                    }}>
                      {doc.title || "Untitled"}
                    </p>
                    <p style={{ fontSize: "11px", color: "var(--text-3)", marginBottom: "5px" }}>
                      {hostname(doc.url)} · {timeAgo(doc.captured_at)}
                    </p>
                    {doc.excerpt && (
                      <p style={{
                        fontSize: "12px", color: "var(--text-2)", lineHeight: 1.5,
                        display: "-webkit-box",
                        WebkitLineClamp: 2,
                        WebkitBoxOrient: "vertical",
                        overflow: "hidden",
                      }}>
                        {doc.excerpt}
                      </p>
                    )}
                  </Link>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
