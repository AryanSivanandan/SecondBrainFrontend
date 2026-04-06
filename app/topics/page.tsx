'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { supabase } from '@/lib/supabase'

// ─── Types ───────────────────────────────────────────────────────────────────

interface GraphNode extends d3.SimulationNodeDatum {
  id: number
  name: string
  description: string
  chunk_count: number
  radius: number
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  label: string
  weight: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const API = process.env.NEXT_PUBLIC_BACKEND_URL || ''

const COLORS = {
  bg:        '#0a0a0f',
  surface:   '#111118',
  border:    '#1e1e2e',
  accent:    '#7c6af7',
  accentDim: '#4a3fa0',
  text:      '#e8e8f0',
  textMuted: '#6b6b8a',
  textDim:   '#3d3d5a',
  nodeMin:   '#2d2d4a',
  nodeMax:   '#7c6af7',
  link:      '#4a4a7a',
  success:   '#34d399',
  danger:    '#f87171',
}

// ─── API helper ───────────────────────────────────────────────────────────────

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

async function apiFetch(path: string, options?: RequestInit) {
  const token = await getToken()
  const res = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options?.headers || {}),
    },
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}: ${await res.text()}`)
  return res.json()
}

// ─── Spinner ──────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <div style={{
      width: 20, height: 20,
      border: `2px solid ${COLORS.accentDim}`,
      borderTopColor: COLORS.accent,
      borderRadius: '50%',
      animation: 'spin 0.7s linear infinite',
      flexShrink: 0,
    }} />
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ConceptGraph() {
  const svgRef       = useRef<SVGSVGElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const [nodes,       setNodes]       = useState<GraphNode[]>([])
  const [links,       setLinks]       = useState<GraphLink[]>([])
  const [loading,     setLoading]     = useState(true)
  const [building,    setBuilding]    = useState(false)
  const [error,       setError]       = useState<string | null>(null)
  const [buildMsg,    setBuildMsg]    = useState<string | null>(null)
  const [selectedNode, setSelectedNode] = useState<GraphNode | null>(null)

  // ── Load stored graph ──────────────────────────────────────────────────────
  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await apiFetch('/concepts/graph')

      // Guard: empty nodes → return early without crashing D3
      if (!data.nodes || data.nodes.length === 0) {
        setNodes([])
        setLinks([])
        return
      }

      // Fix: Math.max(...[]) = -Infinity — guard with explicit fallback
      const maxChunks = data.nodes.reduce(
        (m: number, n: any) => Math.max(m, n.chunk_count || 1), 1
      )

      const graphNodes: GraphNode[] = data.nodes.map((n: any) => ({
        id:          n.id,
        name:        n.name,
        description: n.description || '',
        chunk_count: n.chunk_count || 1,
        radius:      8 + ((n.chunk_count || 1) / maxChunks) * 20,
      }))

      const idSet = new Set(graphNodes.map(n => n.id))
      const graphLinks: GraphLink[] = (data.edges || [])
        .filter((e: any) => idSet.has(e.source) && idSet.has(e.target))
        .map((e: any) => ({
          source: e.source,
          target: e.target,
          label:  e.label  || 'related to',
          weight: e.weight || 0.5,
        }))

      setNodes(graphNodes)
      setLinks(graphLinks)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGraph() }, [loadGraph])

  // ── Build Graph handler ────────────────────────────────────────────────────
  const handleBuild = useCallback(async () => {
    setBuilding(true)
    setBuildMsg(null)
    try {
      const r1 = await apiFetch('/concepts/build-edges', { method: 'POST' })
      const r2 = await apiFetch('/concepts/build-hierarchy', { method: 'POST' })
      setBuildMsg(
        `Done — ${r1.edges_created ?? 0} semantic + ${r2.edges_created ?? 0} hierarchy edges`
      )
      await loadGraph()
    } catch (e: any) {
      setBuildMsg(`Failed: ${e.message}`)
    } finally {
      setBuilding(false)
      setTimeout(() => setBuildMsg(null), 6000)
    }
  }, [loadGraph])

  // ── D3 force graph ────────────────────────────────────────────────────────
  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = svgRef.current.clientWidth  || 900
    const H = svgRef.current.clientHeight || 600

    const g = svg.append('g')

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.2, 4])
        .on('zoom', e => g.attr('transform', e.transform))
    )

    // Arrow marker for directed edges
    svg.append('defs').append('marker')
      .attr('id', 'arrow')
      .attr('viewBox', '0 0 10 10')
      .attr('refX', 18).attr('refY', 5)
      .attr('markerWidth', 6).attr('markerHeight', 6)
      .attr('orient', 'auto-start-reverse')
      .append('path')
      .attr('d', 'M2 1L8 5L2 9')
      .attr('fill', 'none')
      .attr('stroke', COLORS.link)
      .attr('stroke-width', 1.5)

    const sim = d3.forceSimulation<GraphNode>(nodes)
      .force('link', d3.forceLink<GraphNode, GraphLink>(links)
        .id(d => d.id)
        .distance((d: any) => 80 + (1 - d.weight) * 100)
        .strength(0.3)
      )
      .force('charge',    d3.forceManyBody().strength(-120))
      .force('center',    d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide<GraphNode>().radius(d => d.radius + 10))

    // Links
    const link = g.append('g').selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke',         COLORS.link)
      .attr('stroke-width',   (d: any) => 0.5 + d.weight * 2)
      .attr('stroke-opacity', 0.6)
      .attr('stroke-dasharray', '4,3')
      .attr('marker-end', 'url(#arrow)')

    // Edge labels
    const edgeLabel = g.append('g').selectAll('text')
      .data(links)
      .join('text')
      .text((d: any) => d.label)
      .attr('text-anchor', 'middle')
      .attr('fill',      COLORS.textDim)
      .attr('font-size', 9)
      .attr('pointer-events', 'none')

    // Node groups
    const node = g.append('g').selectAll<SVGGElement, GraphNode>('g')
      .data(nodes)
      .join('g')
      .attr('cursor', 'pointer')
      .on('click', (_, d) => setSelectedNode(prev => prev?.id === d.id ? null : d))
      .call(
        d3.drag<SVGGElement, GraphNode>()
          .on('start', (e, d) => { if (!e.active) sim.alphaTarget(0.1).restart(); d.fx = d.x; d.fy = d.y })
          .on('drag',  (e, d) => { d.fx = e.x; d.fy = e.y })
          .on('end',   (e, d) => { if (!e.active) sim.alphaTarget(0); d.fx = null; d.fy = null })
      )

    node.append('circle')
      .attr('r',    d => d.radius)
      .attr('fill', d => {
        const t = Math.min(d.chunk_count / 15, 1)
        return d3.interpolateRgb(COLORS.nodeMin, COLORS.nodeMax)(t)
      })
      .attr('stroke',       COLORS.accent)
      .attr('stroke-width', 0.5)
      .attr('stroke-opacity', 0.3)

    node.append('text')
      .text(d => d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name)
      .attr('text-anchor', 'middle')
      .attr('dy',          d => d.radius + 13)
      .attr('fill',        COLORS.textMuted)
      .attr('font-size',   10)
      .attr('font-family', 'system-ui, sans-serif')
      .attr('pointer-events', 'none')

    sim.on('tick', () => {
      link
        .attr('x1', d => (d.source as GraphNode).x!)
        .attr('y1', d => (d.source as GraphNode).y!)
        .attr('x2', d => (d.target as GraphNode).x!)
        .attr('y2', d => (d.target as GraphNode).y!)

      edgeLabel
        .attr('x', d => ((d.source as GraphNode).x! + (d.target as GraphNode).x!) / 2)
        .attr('y', d => ((d.source as GraphNode).y! + (d.target as GraphNode).y!) / 2 - 4)

      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    svg.on('click', () => setSelectedNode(null))

    return () => { sim.stop() }
  }, [nodes, links])

  // ─── Render ───────────────────────────────────────────────────────────────
  return (
    <div style={{
      width: '100%', height: '100vh',
      background: COLORS.bg,
      color: COLORS.text,
      fontFamily: 'system-ui, sans-serif',
      display: 'flex', flexDirection: 'column',
      overflow: 'hidden',
      position: 'relative',
    }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>

      {/* Header */}
      <div style={{
        padding: '12px 20px',
        borderBottom: `1px solid ${COLORS.border}`,
        display: 'flex', alignItems: 'center', gap: 12,
        background: 'rgba(10,10,15,0.9)',
        backdropFilter: 'blur(10px)',
        flexShrink: 0,
        zIndex: 10,
      }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>Concept Graph</div>
          <div style={{ fontSize: 11, color: COLORS.textMuted, marginTop: 1 }}>
            {nodes.length} concepts · {links.length} connections
          </div>
        </div>

        <div style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 10 }}>
          {buildMsg && (
            <span style={{
              fontSize: 12,
              color: buildMsg.startsWith('Failed') ? COLORS.danger : COLORS.success,
            }}>
              {buildMsg}
            </span>
          )}
          <button
            onClick={handleBuild}
            disabled={building}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              background: building ? COLORS.accentDim : COLORS.accent,
              border: 'none', borderRadius: 7,
              color: '#fff', fontSize: 12, fontWeight: 500,
              padding: '6px 14px',
              cursor: building ? 'not-allowed' : 'pointer',
              opacity: building ? 0.7 : 1,
              transition: 'background 0.15s',
            }}
          >
            {building && <Spinner />}
            {building ? 'Building…' : 'Build Graph'}
          </button>
        </div>
      </div>

      {/* Canvas */}
      <div ref={containerRef} style={{ flex: 1, position: 'relative' }}>

        {/* Loading overlay */}
        {loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10,
            color: COLORS.textMuted, fontSize: 13,
          }}>
            <Spinner /> Loading graph…
          </div>
        )}

        {/* Error state */}
        {error && !loading && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <span style={{ fontSize: 22 }}>⚠</span>
            <p style={{ color: COLORS.danger, fontSize: 13, margin: 0 }}>{error}</p>
          </div>
        )}

        {/* Empty state */}
        {!loading && !error && nodes.length === 0 && (
          <div style={{
            position: 'absolute', inset: 0, zIndex: 5,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            flexDirection: 'column', gap: 8,
          }}>
            <p style={{ color: COLORS.textMuted, fontSize: 14, margin: 0 }}>No concepts yet.</p>
            <p style={{ color: COLORS.textDim, fontSize: 12, margin: 0 }}>
              Capture some pages, then click Build Graph.
            </p>
          </div>
        )}

        <svg ref={svgRef} style={{ width: '100%', height: '100%', display: 'block' }} />

        {!loading && nodes.length > 0 && (
          <div style={{
            position: 'absolute', bottom: 14, left: 16,
            fontSize: 11, color: COLORS.textDim, pointerEvents: 'none',
          }}>
            Scroll to zoom · Drag to pan · Click node to inspect
          </div>
        )}
      </div>

      {/* Node detail panel */}
      {selectedNode && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 280,
          background: COLORS.surface,
          borderLeft: `1px solid ${COLORS.border}`,
          padding: '20px 16px',
          zIndex: 20,
          display: 'flex', flexDirection: 'column', gap: 10,
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
            <div>
              <div style={{
                fontSize: 10, color: COLORS.accent, textTransform: 'uppercase',
                letterSpacing: '0.5px', fontWeight: 600, marginBottom: 6,
              }}>Concept</div>
              <div style={{ fontSize: 16, fontWeight: 600, color: COLORS.text }}>
                {selectedNode.name}
              </div>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              style={{
                background: 'none', border: 'none',
                color: COLORS.textMuted, fontSize: 18, cursor: 'pointer', lineHeight: 1,
              }}
            >×</button>
          </div>

          {selectedNode.description && (
            <p style={{ fontSize: 12, color: COLORS.textMuted, margin: 0, lineHeight: 1.6 }}>
              {selectedNode.description}
            </p>
          )}

          <div style={{
            marginTop: 4, padding: '8px 12px',
            background: COLORS.bg, borderRadius: 8,
            border: `1px solid ${COLORS.border}`,
          }}>
            <div style={{ fontSize: 18, fontWeight: 700, color: COLORS.text }}>
              {selectedNode.chunk_count}
            </div>
            <div style={{ fontSize: 10, color: COLORS.textMuted, textTransform: 'uppercase' }}>
              chunks
            </div>
          </div>

          <div style={{ marginTop: 4 }}>
            <div style={{ fontSize: 11, color: COLORS.textDim, marginBottom: 6, textTransform: 'uppercase' }}>
              Connections
            </div>
            {links
              .filter(l => {
                const s = typeof l.source === 'object' ? (l.source as GraphNode).id : l.source
                const t = typeof l.target === 'object' ? (l.target as GraphNode).id : l.target
                return s === selectedNode.id || t === selectedNode.id
              })
              .map((l, i) => {
                const s    = typeof l.source === 'object' ? (l.source as GraphNode) : nodes.find(n => n.id === l.source)
                const t    = typeof l.target === 'object' ? (l.target as GraphNode) : nodes.find(n => n.id === l.target)
                const other = s?.id === selectedNode.id ? t : s
                return other ? (
                  <div key={i} style={{
                    fontSize: 11, padding: '4px 0',
                    borderBottom: `1px solid ${COLORS.border}`,
                    color: COLORS.textMuted,
                    display: 'flex', justifyContent: 'space-between',
                  }}>
                    <span>{other.name}</span>
                    <span style={{ color: COLORS.textDim, fontStyle: 'italic' }}>{l.label}</span>
                  </div>
                ) : null
              })}
          </div>
        </div>
      )}
    </div>
  )
}