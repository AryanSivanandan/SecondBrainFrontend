'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { supabase } from '@/lib/supabase'

// ─── Types ──────────────────────────────────────────────────────────────────

interface Concept {
  id: number
  name: string
  description: string
  document_count: number
  chunk_count?: number
}

interface ConceptEdge {
  source: number
  target: number
  type: string
  weight: number
}

interface Chunk {
  id: number
  chunk: string
  document_id: number
  score?: number
}

interface Document {
  id: number
  title: string
  url: string
  excerpt: string
  captured_at: string
}

interface GraphNode extends d3.SimulationNodeDatum {
  id: number
  name: string
  description: string
  document_count: number
  chunk_count: number
  radius: number
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  similarity: number
}

// ─── Constants ───────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_BACKEND_URL || 'https://your-api.railway.app'

const COLORS = {
  bg: '#0a0a0f',
  surface: '#111118',
  surfaceHover: '#1a1a26',
  border: '#1e1e2e',
  borderBright: '#2e2e4e',
  accent: '#7c6af7',
  accentDim: '#4a3fa0',
  accentGlow: 'rgba(124, 106, 247, 0.15)',
  accentGlow2: 'rgba(124, 106, 247, 0.35)',
  text: '#e8e8f0',
  textMuted: '#6b6b8a',
  textDim: '#3d3d5a',
  nodeMin: '#2d2d4a',
  nodeMax: '#7c6af7',
  link: '#2a2a3e',
  linkBright: '#4a4a7a',
  success: '#34d399',
  danger: '#f87171',
}

// ─── API helpers ─────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

async function apiFetch(path: string) {
  const token = await getToken()
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(`API ${path} → ${res.status}`)
  return res.json()
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 18, height: 18,
      border: `2px solid ${COLORS.accentDim}`,
      borderTopColor: COLORS.accent,
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  )
}

function ChunkCard({
  chunk, index, onOpenDoc,
}: {
  chunk: Chunk
  index: number
  onOpenDoc: (docId: number) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const preview = chunk.chunk.slice(0, 160)
  const isLong = chunk.chunk.length > 160

  return (
    <div
      style={{
        background: COLORS.surface,
        border: `1px solid ${COLORS.border}`,
        borderRadius: 10,
        padding: '12px 14px',
        animation: `fadeSlideIn 0.25s ease both`,
        animationDelay: `${index * 40}ms`,
        transition: 'border-color 0.15s',
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = COLORS.borderBright)}
      onMouseLeave={e => (e.currentTarget.style.borderColor = COLORS.border)}
    >
      <p style={{
        margin: 0,
        fontSize: 12,
        lineHeight: 1.65,
        color: COLORS.text,
        fontFamily: 'Georgia, serif',
      }}>
        {expanded ? chunk.chunk : preview}
        {isLong && !expanded && <span style={{ color: COLORS.textMuted }}>…</span>}
      </p>
      <div style={{ display: 'flex', gap: 8, marginTop: 10, alignItems: 'center' }}>
        {isLong && (
          <button
            onClick={() => setExpanded(e => !e)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: COLORS.textMuted, fontSize: 11, padding: 0,
            }}
          >
            {expanded ? '↑ Collapse' : '↓ Read more'}
          </button>
        )}
        <button
          onClick={() => onOpenDoc(chunk.document_id)}
          style={{
            marginLeft: 'auto',
            background: COLORS.accentGlow,
            border: `1px solid ${COLORS.accentDim}`,
            borderRadius: 6,
            color: COLORS.accent,
            fontSize: 11,
            padding: '3px 10px',
            cursor: 'pointer',
            transition: 'background 0.15s',
          }}
          onMouseEnter={e => (e.currentTarget.style.background = COLORS.accentGlow2)}
          onMouseLeave={e => (e.currentTarget.style.background = COLORS.accentGlow)}
        >
          Open document →
        </button>
      </div>
    </div>
  )
}

function DocPreviewModal({
  doc, onClose,
}: {
  doc: Document
  onClose: () => void
}) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])

  return (
    <div
      onClick={onClose}
      style={{
        position: 'fixed', inset: 0, zIndex: 200,
        background: 'rgba(0,0,0,0.7)',
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        backdropFilter: 'blur(6px)',
        animation: 'fadeIn 0.15s ease',
      }}
    >
      <div
        onClick={e => e.stopPropagation()}
        style={{
          background: COLORS.surface,
          border: `1px solid ${COLORS.borderBright}`,
          borderRadius: 16,
          padding: '28px 32px',
          maxWidth: 540,
          width: '90%',
          animation: 'scaleIn 0.2s ease',
          boxShadow: `0 0 60px rgba(0,0,0,0.6), 0 0 30px ${COLORS.accentGlow}`,
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
          <h2 style={{
            margin: 0, fontSize: 17, fontWeight: 600,
            color: COLORS.text, lineHeight: 1.4,
            fontFamily: 'Georgia, serif',
          }}>
            {doc.title}
          </h2>
          <button
            onClick={onClose}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              color: COLORS.textMuted, fontSize: 18, padding: '0 0 0 12px', lineHeight: 1,
            }}
          >×</button>
        </div>

        <p style={{
          margin: '0 0 20px',
          fontSize: 13, lineHeight: 1.7,
          color: COLORS.textMuted,
          fontFamily: 'Georgia, serif',
        }}>
          {doc.excerpt || 'No excerpt available.'}
        </p>

        <div style={{ display: 'flex', gap: 8 }}>
          <a
            href={doc.url}
            target="_blank"
            rel="noopener noreferrer"
            style={{
              flex: 1, textAlign: 'center',
              background: COLORS.accent,
              color: '#fff', border: 'none',
              borderRadius: 8, padding: '10px 0',
              fontSize: 13, fontWeight: 500,
              textDecoration: 'none',
              transition: 'opacity 0.15s',
            }}
            onMouseEnter={e => (e.currentTarget.style.opacity = '0.85')}
            onMouseLeave={e => (e.currentTarget.style.opacity = '1')}
          >
            Open original source ↗
          </a>
          <button
            onClick={onClose}
            style={{
              background: COLORS.surfaceHover, border: `1px solid ${COLORS.border}`,
              borderRadius: 8, padding: '10px 16px',
              color: COLORS.textMuted, fontSize: 13, cursor: 'pointer',
            }}
          >
            Close
          </button>
        </div>

        <p style={{ margin: '14px 0 0', fontSize: 11, color: COLORS.textDim }}>
          Captured {new Date(doc.captured_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
        </p>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ConceptGraph() {
  const svgRef = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])

  // Panel state
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)
  const [panelChunks, setPanelChunks] = useState<Chunk[]>([])
  const [chunksLoading, setChunksLoading] = useState(false)

  // Doc preview
  const [previewDoc, setPreviewDoc] = useState<Document | null>(null)
  const [docLoading, setDocLoading] = useState(false)

  // Search
  const [search, setSearch] = useState('')

  // Build graph
  const [building, setBuilding] = useState(false)
  const [buildResult, setBuildResult] = useState<string | null>(null)

  // ── Shared graph loader (used on mount and after build) ──────────────────────
  const loadGraph = useCallback(async () => {
    try {
      setLoading(true)
      setError(null)
      const data = await apiFetch('/concepts')

      const maxChunks = data.nodes.length
        ? Math.max(...data.nodes.map((n: any) => n.chunk_count ?? 1))
        : 1

      const graphNodes: GraphNode[] = data.nodes.map((n: any) => ({
        id: n.id,
        name: n.name,
        description: n.description ?? '',
        document_count: n.document_count ?? 1,
        chunk_count: n.chunk_count ?? 1,
        radius: 10 + ((n.chunk_count ?? 1) / maxChunks) * 28,
      }))

      const idSet = new Set(graphNodes.map(n => n.id))
      const graphLinks: GraphLink[] = data.edges
        .filter((e: any) => idSet.has(e.source) && idSet.has(e.target))
        .map((e: any) => ({
          source: e.source,
          target: e.target,
          similarity: e.weight ?? 0.5,
        }))

      setNodes(graphNodes)
      setLinks(graphLinks)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Load graph data on mount ─────────────────────────────────────────────────
  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  // ── Auto-clear build result message (leak-safe) ─────────────────────────────
  useEffect(() => {
    if (!buildResult) return
    const t = setTimeout(() => setBuildResult(null), 5000)
    return () => clearTimeout(t)
  }, [buildResult])

  // ── Build Graph handler ──────────────────────────────────────────────────────
  const handleBuildGraph = useCallback(async () => {
    setBuilding(true)
    setBuildResult(null)
    try {
      const token = await getToken()
      const res = await fetch(`${API}/concepts/build-graph`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        setBuildResult(`Failed: ${body.detail ?? res.status}`)
        return
      }
      const result = await res.json()
      const edgeCount = result.edges_created ?? result.edges ?? 0
      setBuildResult(
        result.status === 'not_enough_concepts'
          ? 'Need at least 2 concepts — capture more pages first.'
          : `Done — ${edgeCount} connection${edgeCount === 1 ? '' : 's'} built across ${result.concepts} concepts.`
      )
      // Reload graph so new edges appear immediately
      await loadGraph()
    } catch (e: any) {
      setBuildResult(`Error: ${e.message}`)
    } finally {
      setBuilding(false)
    }
  }, [loadGraph])

  // ── Click concept → load chunks ─────────────────────────────────────────────
  const handleNodeClick = useCallback(async (node: GraphNode) => {
    setSelectedNode(node)
    setPanelChunks([])
    setChunksLoading(true)
    try {
      const token = await getToken()
      const res = await fetch(`${API}/concepts/${node.id}/chunks`, {
        headers: { Authorization: `Bearer ${token}` },
      })
      if (!res.ok) {
        setPanelChunks([])
        return
      }
      const data = await res.json()
      setPanelChunks(
        Array.isArray(data)
          ? data.slice(0, 8).map((c: any) => ({
              id: c.chunk_id,
              chunk: c.chunk,
              document_id: c.document_id,
            }))
          : []
      )
    } catch {
      setPanelChunks([])
    } finally {
      setChunksLoading(false)
    }
  }, [])

  // ── Click chunk → load doc preview ──────────────────────────────────────────
  const handleOpenDoc = useCallback(async (docId: number) => {
    setDocLoading(true)
    try {
      const doc = await apiFetch(`/documents/${docId}`)
      setPreviewDoc(doc)
    } catch {
      setPreviewDoc(null)
    } finally {
      setDocLoading(false)
    }
  }, [])

  // ── D3 force graph ───────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = svgRef.current.clientWidth || 900
    const H = svgRef.current.clientHeight || 600

    const g = svg.append('g')

    const zoom = d3.zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.3, 3])
      .on('zoom', (event) => g.attr('transform', event.transform))
    svg.call(zoom)

    const defs = svg.append('defs')

    const glow = defs.append('filter').attr('id', 'glow')
    glow.append('feGaussianBlur').attr('stdDeviation', '4').attr('result', 'blur')
    const feMerge = glow.append('feMerge')
    feMerge.append('feMergeNode').attr('in', 'blur')
    feMerge.append('feMergeNode').attr('in', 'SourceGraphic')

    const glowSoft = defs.append('filter').attr('id', 'glowSoft')
    glowSoft.append('feGaussianBlur').attr('stdDeviation', '2').attr('result', 'blur')
    const feMerge2 = glowSoft.append('feMerge')
    feMerge2.append('feMergeNode').attr('in', 'blur')
    feMerge2.append('feMergeNode').attr('in', 'SourceGraphic')

    const activeIds = search.trim()
      ? new Set(nodes.filter(n => n.name.toLowerCase().includes(search.toLowerCase())).map(n => n.id))
      : null

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance(d => 120 - d.similarity * 60)
        .strength(d => d.similarity * 0.6))
      .force('charge', d3.forceManyBody().strength(-280))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => d.radius + 14))

    const link = g.append('g').selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', d => d.similarity > 0.75 ? COLORS.linkBright : COLORS.link)
      .attr('stroke-width', d => Math.max(0.5, d.similarity * 2))
      .attr('stroke-opacity', d => 0.3 + d.similarity * 0.4)

    const node = g.append('g').selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (event: any, d: GraphNode) => {
            if (!event.active) sim.alphaTarget(0.3).restart()
            d.fx = d.x; d.fy = d.y
          })
          .on('drag', (event: any, d: GraphNode) => { d.fx = event.x; d.fy = event.y })
          .on('end', (event: any, d: GraphNode) => {
            if (!event.active) sim.alphaTarget(0)
            d.fx = null; d.fy = null
          })
      )
      .on('click', (event: any, d: GraphNode) => {
        event.stopPropagation()
        handleNodeClick(d)
      })

    node.append('circle')
      .attr('r', d => d.radius + 6)
      .attr('fill', 'none')
      .attr('stroke', COLORS.accent)
      .attr('stroke-width', 1.5)
      .attr('stroke-opacity', d => activeIds
        ? (activeIds.has(d.id) ? 0.7 : 0.05)
        : 0.15)
      .attr('filter', 'url(#glow)')
      .attr('class', 'ring')

    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => {
        const t = Math.min(d.chunk_count / 20, 1)
        return d3.interpolateRgb(COLORS.nodeMin, COLORS.nodeMax)(t)
      })
      .attr('stroke', COLORS.borderBright)
      .attr('stroke-width', 1)
      .attr('opacity', d => activeIds ? (activeIds.has(d.id) ? 1 : 0.2) : 0.9)
      .attr('filter', d => d.chunk_count > 5 ? 'url(#glowSoft)' : 'none')

    node.append('text')
      .text(d => d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.radius + 14)
      .attr('fill', d => activeIds ? (activeIds.has(d.id) ? COLORS.text : COLORS.textDim) : COLORS.textMuted)
      .attr('font-size', d => Math.max(10, Math.min(13, 9 + d.radius * 0.18)))
      .attr('font-family', 'system-ui, sans-serif')
      .attr('font-weight', '500')
      .attr('pointer-events', 'none')

    node.append('text')
      .text(d => d.chunk_count)
      .attr('text-anchor', 'middle')
      .attr('dy', '0.35em')
      .attr('fill', '#fff')
      .attr('font-size', d => Math.max(8, Math.min(12, d.radius * 0.55)))
      .attr('font-family', 'system-ui, sans-serif')
      .attr('font-weight', '600')
      .attr('pointer-events', 'none')
      .attr('opacity', d => d.radius > 14 ? 0.85 : 0)

    sim.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!)

      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    svg.on('click', () => setSelectedNode(null))

    return () => { sim.stop() }
  }, [nodes, links, search, handleNodeClick])

  // ── Highlight selected node ──────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current) return
    d3.select(svgRef.current)
      .selectAll<SVGCircleElement, GraphNode>('.ring')
      .attr('stroke-opacity', (d: GraphNode) =>
        selectedNode?.id === d.id ? 1 : (search ? 0.05 : 0.15))
      .attr('r', (d: GraphNode) =>
        selectedNode?.id === d.id ? d.radius + 9 : d.radius + 6)
  }, [selectedNode, search])

  // ─── Render ─────────────────────────────────────────────────────────────────
  return (
    <div style={{
      minHeight: '100vh',
      background: COLORS.bg,
      display: 'flex',
      flexDirection: 'column',
      fontFamily: 'system-ui, -apple-system, sans-serif',
      color: COLORS.text,
      overflow: 'hidden',
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeSlideIn {
          from { opacity: 0; transform: translateY(6px) }
          to   { opacity: 1; transform: translateY(0) }
        }
        @keyframes fadeIn {
          from { opacity: 0 } to { opacity: 1 }
        }
        @keyframes scaleIn {
          from { opacity: 0; transform: scale(0.96) }
          to   { opacity: 1; transform: scale(1) }
        }
        @keyframes panelIn {
          from { opacity: 0; transform: translateX(16px) }
          to   { opacity: 1; transform: translateX(0) }
        }
        ::-webkit-scrollbar { width: 4px }
        ::-webkit-scrollbar-track { background: transparent }
        ::-webkit-scrollbar-thumb { background: ${COLORS.borderBright}; border-radius: 4px }
      `}</style>

      {/* ── Header ── */}
      <header style={{
        padding: '16px 24px',
        borderBottom: `1px solid ${COLORS.border}`,
        display: 'flex',
        alignItems: 'center',
        gap: 16,
        flexShrink: 0,
        background: 'rgba(10,10,15,0.8)',
        backdropFilter: 'blur(12px)',
        position: 'sticky',
        top: 0,
        zIndex: 10,
      }}>
        <div>
          <h1 style={{ margin: 0, fontSize: 16, fontWeight: 600, letterSpacing: '-0.3px', color: COLORS.text }}>
            Concept Graph
          </h1>
          <p style={{ margin: 0, fontSize: 12, color: COLORS.textMuted, marginTop: 1 }}>
            {nodes.length} concepts · {links.length} connections
          </p>
        </div>

        {/* Search */}
        <input
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Filter concepts…"
          style={{
            marginLeft: 'auto',
            background: COLORS.surface,
            border: `1px solid ${COLORS.border}`,
            borderRadius: 8,
            padding: '7px 14px',
            color: COLORS.text,
            fontSize: 13,
            width: 220,
            outline: 'none',
            transition: 'border-color 0.15s',
          }}
          onFocus={e => (e.target.style.borderColor = COLORS.accentDim)}
          onBlur={e => (e.target.style.borderColor = COLORS.border)}
        />

        {/* Build Graph button + inline result message */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
          {buildResult && (
            <span style={{
              fontSize: 12,
              color: buildResult.startsWith('Failed') || buildResult.startsWith('Error')
                ? COLORS.danger
                : COLORS.success,
              maxWidth: 260,
              animation: 'fadeIn 0.2s ease',
            }}>
              {buildResult}
            </span>
          )}
          <button
            onClick={handleBuildGraph}
            disabled={building}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 7,
              background: building ? COLORS.accentDim : COLORS.accent,
              border: 'none',
              borderRadius: 8,
              color: '#fff',
              fontSize: 13,
              fontWeight: 500,
              padding: '7px 14px',
              cursor: building ? 'not-allowed' : 'pointer',
              opacity: building ? 0.7 : 1,
              transition: 'background 0.15s, opacity 0.15s',
              whiteSpace: 'nowrap',
            }}
            onMouseEnter={e => { if (!building) e.currentTarget.style.background = COLORS.accentDim }}
            onMouseLeave={e => { if (!building) e.currentTarget.style.background = COLORS.accent }}
          >
            {building && <Spinner />}
            {building ? 'Building…' : 'Build Graph'}
          </button>
        </div>

        {/* Legend */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: `linear-gradient(135deg, ${COLORS.nodeMin}, ${COLORS.nodeMax})`,
          }} />
          <span style={{ fontSize: 11, color: COLORS.textMuted }}>chunk density</span>
        </div>
      </header>

      {/* ── Body ── */}
      <div style={{ flex: 1, display: 'flex', position: 'relative', overflow: 'hidden' }}>

        {/* Graph canvas */}
        <div ref={containerRef} style={{ flex: 1, position: 'relative' }}>
          {loading && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center', gap: 12,
              color: COLORS.textMuted, fontSize: 14,
            }}>
              <Spinner />
              {building ? 'Rebuilding graph…' : 'Loading concept graph…'}
            </div>
          )}

          {error && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 8,
            }}>
              <span style={{ fontSize: 24 }}>⚠</span>
              <p style={{ color: COLORS.danger, fontSize: 13, margin: 0 }}>{error}</p>
            </div>
          )}

          {!loading && nodes.length === 0 && !error && (
            <div style={{
              position: 'absolute', inset: 0, display: 'flex',
              alignItems: 'center', justifyContent: 'center',
              flexDirection: 'column', gap: 10,
            }}>
              <p style={{ color: COLORS.textMuted, fontSize: 14, margin: 0 }}>
                No concepts yet.
              </p>
              <p style={{ color: COLORS.textDim, fontSize: 12, margin: 0 }}>
                Capture some pages, then click Build Graph.
              </p>
            </div>
          )}

          <svg
            ref={svgRef}
            style={{ width: '100%', height: '100%', display: 'block' }}
          />

          {!loading && nodes.length > 0 && (
            <div style={{
              position: 'absolute', bottom: 16, left: 16,
              color: COLORS.textDim, fontSize: 11,
              pointerEvents: 'none',
            }}>
              Scroll to zoom · Drag to pan · Click node to explore
            </div>
          )}
        </div>

        {/* ── Side panel ── */}
        {selectedNode && (
          <div style={{
            width: 340,
            background: COLORS.surface,
            borderLeft: `1px solid ${COLORS.border}`,
            display: 'flex',
            flexDirection: 'column',
            animation: 'panelIn 0.2s ease',
            overflow: 'hidden',
            flexShrink: 0,
          }}>
            {/* Panel header */}
            <div style={{
              padding: '18px 20px 14px',
              borderBottom: `1px solid ${COLORS.border}`,
              flexShrink: 0,
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
                <div>
                  <div style={{
                    display: 'inline-block',
                    background: COLORS.accentGlow,
                    border: `1px solid ${COLORS.accentDim}`,
                    borderRadius: 6,
                    padding: '2px 8px',
                    fontSize: 10,
                    color: COLORS.accent,
                    marginBottom: 8,
                    textTransform: 'uppercase',
                    letterSpacing: '0.5px',
                    fontWeight: 600,
                  }}>
                    Concept
                  </div>
                  <h2 style={{
                    margin: 0,
                    fontSize: 17,
                    fontWeight: 600,
                    color: COLORS.text,
                    lineHeight: 1.3,
                    fontFamily: 'Georgia, serif',
                  }}>
                    {selectedNode.name}
                  </h2>
                  {selectedNode.description && (
                    <p style={{
                      margin: '6px 0 0',
                      fontSize: 12,
                      color: COLORS.textMuted,
                      lineHeight: 1.55,
                    }}>
                      {selectedNode.description}
                    </p>
                  )}
                </div>
                <button
                  onClick={() => setSelectedNode(null)}
                  style={{
                    background: 'none', border: 'none', cursor: 'pointer',
                    color: COLORS.textMuted, fontSize: 18,
                    padding: '0 0 0 8px', lineHeight: 1, flexShrink: 0,
                  }}
                >×</button>
              </div>

              <div style={{ marginTop: 12, display: 'flex', gap: 12 }}>
                <Stat label="chunks" value={selectedNode.chunk_count} />
              </div>
            </div>

            {/* Chunks list */}
            <div style={{
              flex: 1,
              overflowY: 'auto',
              padding: '14px 16px',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}>
              <p style={{
                margin: '0 0 4px',
                fontSize: 11,
                color: COLORS.textDim,
                textTransform: 'uppercase',
                letterSpacing: '0.5px',
                fontWeight: 600,
              }}>
                Relevant chunks
              </p>

              {chunksLoading && (
                <div style={{ display: 'flex', gap: 10, alignItems: 'center', padding: '8px 0', color: COLORS.textMuted, fontSize: 13 }}>
                  <Spinner /> Loading chunks…
                </div>
              )}

              {!chunksLoading && panelChunks.length === 0 && (
                <p style={{ fontSize: 13, color: COLORS.textMuted, margin: 0 }}>
                  No chunks found for this concept.
                </p>
              )}

              {!chunksLoading && panelChunks.map((chunk, i) => (
                <ChunkCard
                  key={chunk.id}
                  chunk={chunk}
                  index={i}
                  onOpenDoc={handleOpenDoc}
                />
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Doc preview modal */}
      {previewDoc && (
        <DocPreviewModal
          doc={previewDoc}
          onClose={() => setPreviewDoc(null)}
        />
      )}

      {/* Doc loading overlay */}
      {docLoading && (
        <div style={{
          position: 'fixed', inset: 0, zIndex: 150,
          background: 'rgba(0,0,0,0.5)',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}>
          <Spinner />
        </div>
      )}
    </div>
  )
}

// ─── Small helper ─────────────────────────────────────────────────────────────

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div style={{
      background: COLORS.bg,
      border: `1px solid ${COLORS.border}`,
      borderRadius: 8,
      padding: '6px 12px',
    }}>
      <div style={{ fontSize: 16, fontWeight: 700, color: COLORS.text }}>{value}</div>
      <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase', letterSpacing: '0.4px' }}>{label}</div>
    </div>
  )
}