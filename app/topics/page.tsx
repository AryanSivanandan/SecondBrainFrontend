"use client";

import { useEffect, useState, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import dynamic from "next/dynamic";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

// react-force-graph-2d uses browser APIs — must be dynamically imported
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), { ssr: false });

const BACKEND = "/api";

// ── Types ──────────────────────────────────────────────────── //
type TopicNode = {
  id: number;
  name: string;
  description: string;
  chunk_count: number;
  size: number;
  // Injected by D3 force simulation
  x?: number;
  y?: number;
};

type GraphLink = {
  source: number | TopicNode;
  target: number | TopicNode;
  similarity: number;
};

type GraphData = { nodes: TopicNode[]; links: GraphLink[] };

type TopicDoc = {
  id: number;
  title: string;
  url: string;
  excerpt: string;
  captured_at: string;
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

  const [graphData, setGraphData]       = useState<GraphData>({ nodes: [], links: [] });
  const [gaps, setGaps]                 = useState<Gap[]>([]);
  const [selectedTopic, setSelectedTopic] = useState<TopicNode | null>(null);
  const [topicDocs, setTopicDocs]       = useState<TopicDoc[]>([]);
  const [docsLoading, setDocsLoading]   = useState(false);
  const [hoveredNode, setHoveredNode]   = useState<TopicNode | null>(null);
  const [highlightNodes, setHighlightNodes] = useState<Set<number>>(new Set());
  const [loadingGraph, setLoadingGraph] = useState(true);
  const [rebuilding, setRebuilding]     = useState(false);
  const [rebuildMsg, setRebuildMsg]     = useState("");
  const [dimensions, setDimensions]     = useState({ width: 800, height: 600 });

  // Refs for stable callbacks
  const hoveredNodeRef    = useRef<TopicNode | null>(null);
  const highlightNodesRef = useRef<Set<number>>(new Set());
  hoveredNodeRef.current    = hoveredNode;
  highlightNodesRef.current = highlightNodes;

  // Track canvas dimensions
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

  // Auth check + initial data
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (!session) { router.push("/"); return; }
      fetchTopics();
      fetchGaps();
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function fetchTopics() {
    setLoadingGraph(true);
    try {
      const res  = await authFetch(`${BACKEND}/topics`);
      const data = await res.json();
      setGraphData({
        nodes: data.nodes ?? [],
        links: (data.edges ?? []).map((e: { source: number; target: number; similarity: number }) => ({
          source: e.source,
          target: e.target,
          similarity: e.similarity,
        })),
      });
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingGraph(false);
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

  async function handleNodeClick(node: TopicNode) {
    setSelectedTopic(node);
    setTopicDocs([]);
    setDocsLoading(true);
    try {
      const res  = await authFetch(`${BACKEND}/topics/${node.id}/chunks`);
      const data = await res.json();
      setTopicDocs(Array.isArray(data) ? data : []);
    } catch (e) {
      console.error(e);
    } finally {
      setDocsLoading(false);
    }
  }

  const handleNodeHover = useCallback((node: TopicNode | null) => {
    setHoveredNode(node ?? null);
    const hl = new Set<number>();
    if (node) {
      hl.add(node.id);
      // After D3 runs, link.source / link.target may be objects
      setGraphData(prev => {
        prev.links.forEach(link => {
          const s = typeof link.source === "object" ? (link.source as TopicNode).id : link.source;
          const t = typeof link.target === "object" ? (link.target as TopicNode).id : link.target;
          if (s === node.id) hl.add(t);
          if (t === node.id) hl.add(s);
        });
        return prev; // no re-render needed, just reading
      });
    }
    setHighlightNodes(hl);
  }, []);

  // Node canvas renderer
  const paintNode = useCallback((
    node: TopicNode,
    ctx: CanvasRenderingContext2D,
    globalScale: number,
  ) => {
    const r  = Math.max(4, (node.size ?? 12) / 4);
    const nx = node.x ?? 0;
    const ny = node.y ?? 0;
    const hovered    = hoveredNodeRef.current;
    const highlighted = highlightNodesRef.current;
    const isHovered    = hovered?.id === node.id;
    const isConnected  = highlighted.has(node.id);
    const dimmed       = hovered !== null && !isConnected && !isHovered;
    const alpha        = dimmed ? 0.12 : Math.min(0.45 + (node.chunk_count ?? 1) * 0.04, 0.95);

    // Glow ring for hovered / connected nodes
    if (isHovered || isConnected) {
      ctx.beginPath();
      ctx.arc(nx, ny, r + 5, 0, 2 * Math.PI);
      ctx.fillStyle = "rgba(124,106,247,0.1)";
      ctx.fill();
    }

    // Node fill
    ctx.beginPath();
    ctx.arc(nx, ny, r, 0, 2 * Math.PI);
    ctx.fillStyle = `rgba(124,106,247,${alpha})`;
    ctx.fill();

    // Border on hover
    if (isHovered) {
      ctx.strokeStyle = "rgba(124,106,247,0.9)";
      ctx.lineWidth   = 1.5 / globalScale;
      ctx.stroke();
    }

    // Label below node
    const fontSize = Math.max(9, 12 / globalScale);
    ctx.font         = `${fontSize}px -apple-system, sans-serif`;
    ctx.textAlign    = "center";
    ctx.textBaseline = "top";
    ctx.fillStyle    = dimmed ? "rgba(238,238,248,0.15)" : "rgba(238,238,248,0.88)";
    ctx.fillText(node.name, nx, ny + r + 2 / globalScale);
  }, []);

  // Extend pointer hit area to cover label
  const paintNodePointer = useCallback((
    node: TopicNode,
    color: string,
    ctx: CanvasRenderingContext2D,
  ) => {
    const r = Math.max(4, (node.size ?? 12) / 4) + 6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI);
    ctx.fill();
  }, []);

  const getLinkColor = useCallback((link: GraphLink) => {
    const hovered = hoveredNodeRef.current;
    const sim     = (link as GraphLink).similarity ?? 0.5;
    if (hovered) {
      const s = typeof link.source === "object" ? (link.source as TopicNode).id : link.source;
      const t = typeof link.target === "object" ? (link.target as TopicNode).id : link.target;
      if (s !== hovered.id && t !== hovered.id) return "rgba(124,106,247,0.04)";
      return sim > 0.7 ? "rgba(124,106,247,0.7)" : "rgba(124,106,247,0.4)";
    }
    return sim > 0.7 ? "rgba(124,106,247,0.5)" : "rgba(124,106,247,0.18)";
  }, []);

  const isEmpty = !loadingGraph && graphData.nodes.length === 0;

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

      {/* ── Main content ────────────────────────────── */}
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
            {!loadingGraph && graphData.nodes.length > 0 && (
              <p style={{ fontSize: "11.5px", color: "var(--text-3)", marginTop: "4px" }}>
                {graphData.nodes.length} topics · {graphData.links.length} connections
              </p>
            )}
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "10px" }}>
            {rebuildMsg && (
              <span style={{
                fontSize: "12px",
                color: rebuildMsg.startsWith("Need") ? "var(--amber)" : "var(--green)",
              }}>
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
              display: "flex", alignItems: "center", justifyContent: "center",
              gap: "10px", color: "var(--text-2)", fontSize: "14px",
            }}>
              <div className="spinner" /> Loading graph...
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
              graphData={graphData}
              width={dimensions.width}
              height={dimensions.height}
              backgroundColor="#07070e"
              nodeLabel="name"
              nodeCanvasObject={paintNode as any}
              nodeCanvasObjectMode={() => "replace"}
              nodePointerAreaPaint={paintNodePointer as any}
              onNodeClick={handleNodeClick as any}
              onNodeHover={handleNodeHover as any}
              linkColor={getLinkColor as any}
              linkWidth={(link) => ((link as GraphLink).similarity ?? 0.5) > 0.7 ? 1.5 : 0.8}
              linkDirectionalParticles={0}
              cooldownTicks={120}
              d3AlphaDecay={0.02}
              d3VelocityDecay={0.3}
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
          {/* Panel header */}
          <div style={{
            padding: "20px 20px 16px",
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
              <span className="badge badge-accent" style={{ marginTop: "10px" }}>
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
            <div className="section-label" style={{ marginBottom: "10px" }}>Documents</div>

            {docsLoading ? (
              <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "var(--text-2)", fontSize: "13px" }}>
                <div className="spinner spinner-sm" /> Loading...
              </div>
            ) : topicDocs.length === 0 ? (
              <p style={{ fontSize: "13px", color: "var(--text-3)" }}>No documents found.</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                {topicDocs.map(doc => (
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
