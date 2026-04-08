'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'
import * as d3 from 'd3'

// react-force-graph-2d requires canvas — SSR must be disabled
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

// ─── Types ───────────────────────────────────────────────────────────────────

interface ConceptNode {
  id: string            // string form of numeric id (used by force-graph)
  numId: number
  name: string
  description: string
  chunk_count: number
  size: number
  color: string
  nodeType: 'concept'
  x?: number
  y?: number
}

interface GraphLink {
  source: string
  target: string
  weight: number
  label: string
  linkType: 'concept-concept'
}

interface GraphData {
  nodes: ConceptNode[]
  links: GraphLink[]
}

interface ConceptDoc {
  id: number
  title: string
  url?: string
  excerpt?: string
  captured_at?: string
}

interface ChunkNode {
  id: string
  numId: number
  label: string
  preview: string
  document_id: number
  document_title: string
  chunk_index: number
  edge_count: number
  tier: 'hub' | 'connected' | 'satellite' | 'isolated'
  size: number
  concept_id: number | null
  source_type: string
  color: string
  x?: number
  y?: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND = '/api'

const CLUSTER_COLORS = [
  '#22d3ee', // cyan
  '#a3e635', // chartreuse
  '#fb923c', // coral
  '#facc15', // yellow
  '#a78bfa', // purple
  '#34d399', // mint
  '#f97316', // orange
  '#c084fc', // lavender
  '#f472b6', // pink
  '#2dd4bf', // teal
]

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function authFetch(path: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch(`${BACKEND}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  })
  if (!res.ok) throw new Error(`${path} → ${res.status}`)
  return res.json()
}

// ─── Cluster color assignment (union-find on strong edges) ───────────────────

function assignClusterColors(nodes: ConceptNode[], links: GraphLink[]): ConceptNode[] {
  const parent: Record<string, string> = {}
  nodes.forEach(n => { parent[n.id] = n.id })

  function find(x: string): string {
    if (parent[x] !== x) parent[x] = find(parent[x])
    return parent[x]
  }

  // Union nodes connected by edges with weight > 0.75
  links
    .filter(l => (l.weight || 0) > 0.75)
    .forEach(l => {
      const sid = typeof l.source === 'object' ? (l.source as any).id : l.source
      const tid = typeof l.target === 'object' ? (l.target as any).id : l.target
      parent[find(String(sid))] = find(String(tid))
    })

  const clusterColors: Record<string, string> = {}
  let colorIdx = 0
  nodes.forEach(n => {
    const root = find(n.id)
    if (!clusterColors[root]) {
      clusterColors[root] = CLUSTER_COLORS[colorIdx % CLUSTER_COLORS.length]
      colorIdx++
    }
  })

  return nodes.map(n => ({ ...n, color: clusterColors[find(n.id)] }))
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function TopicsPage() {
  const fgRef       = useRef<any>(null)
  const starsRef    = useRef<{ x: number; y: number; r: number; a: number }[]>([])
  const hasZoomed   = useRef(false)

  const [graphData,    setGraphData]    = useState<GraphData>({ nodes: [], links: [] })
  const [panelDocs,    setPanelDocs]    = useState<ConceptDoc[]>([])
  const [panelLoading, setPanelLoading] = useState(false)

  const [loading,      setLoading]      = useState(true)
  const [building,     setBuilding]     = useState(false)
  const [graphReady,   setGraphReady]   = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [noData,       setNoData]       = useState(false)
  const [statsText,    setStatsText]    = useState('')

  const [graphMode,    setGraphMode]    = useState<'concepts' | 'chunks'>('concepts')
  const [buildStats,   setBuildStats]   = useState<string>('')
  const [selectedNode, setSelectedNode] = useState<ConceptNode | null>(null)
  const [selectedChunk, setSelectedChunk] = useState<ChunkNode | null>(null)
  const [hoveredId,    setHoveredId]    = useState<string | null>(null)
  const [dims,         setDims]         = useState({ w: 0, h: 0 })

  // Export briefing modal
  const [briefing,        setBriefing]        = useState<string>('')
  const [briefingMeta,    setBriefingMeta]    = useState<{ chunk_count: number; source_breakdown: Record<string, number> } | null>(null)
  const [briefingLoading, setBriefingLoading] = useState(false)
  const [showBriefing,    setShowBriefing]    = useState(false)
  const [briefingCopied,  setBriefingCopied]  = useState(false)

  // Track window dimensions
  useEffect(() => {
    const update = () => setDims({ w: window.innerWidth, h: window.innerHeight })
    update()
    window.addEventListener('resize', update)
    return () => window.removeEventListener('resize', update)
  }, [])

  // Generate 200 fixed stars once
  useEffect(() => {
    if (starsRef.current.length) return
    starsRef.current = Array.from({ length: 200 }, () => ({
      x: Math.random(),
      y: Math.random(),
      r: Math.random() * 1.2 + 0.2,
      a: Math.random() * 0.6 + 0.2,
    }))
  }, [])

  // ── Load concept graph ──────────────────────────────────────────────────────

  const loadConceptGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNoData(false)
    setGraphReady(false)
    try {
      const data = await authFetch('/concepts/graph')
      const rawNodes: any[] = data.nodes || []
      const rawEdges: any[] = data.edges || []

      if (rawNodes.length === 0) {
        setNoData(true)
        setStatsText('0 concepts · 0 connections')
        return
      }

      const spread = Math.min(200, 40 + rawNodes.length * 8)
      const nodes: ConceptNode[] = rawNodes.map((n, i) => {
        const chunks = n.chunk_count || 1
        const angle  = (i / rawNodes.length) * 2 * Math.PI
        return {
          id:          String(n.id),
          numId:       n.id,
          name:        n.name,
          description: n.description || '',
          chunk_count: chunks,
          size:        Math.max(6, Math.min(24, 6 + chunks * 2)),
          color:       CLUSTER_COLORS[i % CLUSTER_COLORS.length],
          nodeType:    'concept' as const,
          x:           Math.cos(angle) * spread * (0.5 + Math.random() * 0.5),
          y:           Math.sin(angle) * spread * (0.5 + Math.random() * 0.5),
        }
      })

      const idSet = new Set(nodes.map(n => n.id))
      const links: GraphLink[] = rawEdges
        .filter((e: any) => idSet.has(String(e.source)) && idSet.has(String(e.target)))
        .map((e: any) => ({
          source:   String(e.source),
          target:   String(e.target),
          weight:   e.weight || 0.5,
          label:    e.label  || '',
          linkType: 'concept-concept' as const,
        }))

      hasZoomed.current = false
      const coloredNodes = assignClusterColors(nodes, links)
      setGraphData({ nodes: coloredNodes, links })
      setStatsText(`${nodes.length} concepts · ${links.length} connections`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Load chunk graph ────────────────────────────────────────────────────────

  const loadChunkGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNoData(false)
    setGraphReady(false)
    setSelectedNode(null)
    setSelectedChunk(null)
    try {
      const data = await authFetch('/chunks/graph')
      const rawNodes: any[] = data.nodes || []
      const rawEdges: any[] = data.edges || []

      if (rawNodes.length === 0) {
        setNoData(true)
        setStatsText('0 chunks · 0 connections')
        return
      }

      const spread = Math.min(400, 60 + rawNodes.length * 5)
      const nodes: ChunkNode[] = rawNodes.map((n, i) => {
        const angle = (i / rawNodes.length) * 2 * Math.PI
        const color = n.tier === 'isolated'  ? 'rgba(80,80,100,0.4)'
                    : n.tier === 'satellite'  ? 'rgba(120,120,160,0.5)'
                    : CLUSTER_COLORS[((n.concept_id ?? n.id) as number) % CLUSTER_COLORS.length]
        return {
          ...n,
          id:    String(n.id),
          numId: n.id,
          color,
          x: Math.cos(angle) * spread * (0.5 + Math.random() * 0.5),
          y: Math.sin(angle) * spread * (0.5 + Math.random() * 0.5),
        }
      })

      const idSet = new Set(nodes.map(n => n.id))
      const links: GraphLink[] = rawEdges
        .filter((e: any) => idSet.has(String(e.source)) && idSet.has(String(e.target)))
        .map((e: any) => ({
          source:   String(e.source),
          target:   String(e.target),
          weight:   e.weight || 0.5,
          label:    '',
          linkType: 'concept-concept' as const,
        }))

      hasZoomed.current = false
      setGraphData({ nodes: nodes as any, links })
      const s = data.stats || {}
      setStatsText(`${s.visible_nodes ?? nodes.length} chunks · ${links.length} connections · ${s.hub_count ?? 0} hubs`)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  const loadGraph = useCallback((mode: 'concepts' | 'chunks') => {
    if (mode === 'chunks') return loadChunkGraph()
    return loadConceptGraph()
  }, [loadConceptGraph, loadChunkGraph])

  useEffect(() => { loadConceptGraph() }, [loadConceptGraph])

  // D3 force tuning — switches between concept and chunk simulation
  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return
    const fg = fgRef.current

    if (graphMode === 'chunks') {
      fg.d3Force('charge')?.strength((n: any) =>
        n.tier === 'hub' ? -150 : n.tier === 'connected' ? -60 : -20
      )
      fg.d3Force('link')
        ?.distance((l: GraphLink) => 100 - (l.weight || 0.5) * 60)
        ?.strength((l: GraphLink) => (l.weight || 0.5) * 0.8)
      fg.d3Force('center')?.strength(0.05)
      fg.d3Force('collision', d3.forceCollide((n: any) =>
        n.tier === 'hub' ? 18 : n.tier === 'connected' ? 10 : 6
      ).strength(0.7))
    } else {
      fg.d3Force('charge')?.strength((n: ConceptNode) =>
        (n.chunk_count || 1) > 5 ? -200 : -80
      )
      fg.d3Force('link')
        ?.distance((l: GraphLink) => 120 - (l.weight || 0.5) * 80)
        ?.strength((l: GraphLink) => l.weight || 0.5)
      fg.d3Force('center')?.strength(0.05)
      fg.d3Force('collision', d3.forceCollide((n: any) =>
        (n.chunk_count || 1) > 5 ? 20 : 10
      ).strength(0.8))
    }

    fg.d3ReheatSimulation()
  }, [graphData, graphMode])

  // ── Chunk node paint ────────────────────────────────────────────────────────

  const paintChunkNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n = node as ChunkNode
    const isHovered = n.id === hoveredId
    const isDimmed  = hoveredId !== null && !isHovered
    ctx.globalAlpha = isDimmed ? 0.15 : 1

    const size = n.tier === 'hub'       ? Math.min(20, 8 + n.edge_count)
               : n.tier === 'connected' ? 5
               : n.tier === 'satellite' ? 2.5 : 1.5

    // Glow for hubs
    if (n.tier === 'hub' || isHovered) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, size * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = n.color + '20'
      ctx.fill()
      ctx.beginPath()
      ctx.arc(node.x, node.y, size * 1.5, 0, Math.PI * 2)
      ctx.fillStyle = n.color + '40'
      ctx.fill()
    }

    ctx.beginPath()
    ctx.arc(node.x, node.y, size, 0, Math.PI * 2)
    ctx.fillStyle = n.color
    ctx.fill()

    // Label: hubs always, connected when zoomed, others on hover
    const showLabel = n.tier === 'hub' || isHovered ||
      (n.tier === 'connected' && globalScale > 1.5)
    if (showLabel) {
      const fontSize = Math.max(7, 10 / globalScale)
      ctx.font = `${fontSize}px system-ui, sans-serif`
      ctx.textAlign = 'center'
      const tw = ctx.measureText(n.label).width
      ctx.fillStyle = 'rgba(10,10,15,0.8)'
      ctx.fillRect(node.x - tw / 2 - 2, node.y + size + 2, tw + 4, fontSize + 3)
      ctx.fillStyle = 'rgba(255,255,255,0.9)'
      ctx.textBaseline = 'top'
      ctx.fillText(n.label, node.x, node.y + size + 3)
      ctx.textBaseline = 'middle'
    }

    ctx.globalAlpha = 1
  }, [hoveredId])

  // ── Build graph ─────────────────────────────────────────────────────────────

  const handleBuild = async () => {
    setBuilding(true)
    setBuildStats('')
    try {
      const res = await authFetch('/concepts/build-edges-from-chunks', { method: 'POST' })
      setBuildStats(
        `${res.chunks_reassigned ?? 0} chunks reassigned · ` +
        `${res.chunk_edges_processed ?? 0} chunk edges · ` +
        `${res.edges_created ?? 0} connections`
      )
      await authFetch('/concepts/build-hierarchy', { method: 'POST' })
      await loadGraph(graphMode)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setBuilding(false)
    }
  }

  // ── Canvas paint callbacks ──────────────────────────────────────────────────

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n      = node as ConceptNode
    const r      = n.size / 2
    const hovered = n.id === hoveredId
    const dimmed  = hoveredId !== null && !hovered
    ctx.globalAlpha = dimmed ? 0.2 : 1

    // Multi-layer bloom glow
    const layers = hovered ? 4 : 3
    for (let i = layers; i >= 1; i--) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, r + i * 5, 0, Math.PI * 2)
      ctx.fillStyle = n.color + Math.floor((0.05 / i) * 255).toString(16).padStart(2, '0')
      ctx.fill()
    }

    // Core radial gradient fill
    const grad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r)
    grad.addColorStop(0, '#ffffff55')
    grad.addColorStop(0.4, n.color + 'cc')
    grad.addColorStop(1,   n.color + '88')
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.fillStyle = grad
    ctx.fill()

    // Ring
    ctx.beginPath()
    ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
    ctx.strokeStyle = hovered ? '#ffffffaa' : n.color + 'aa'
    ctx.lineWidth   = hovered ? 1.5 : 0.8
    ctx.stroke()

    // Label
    const fontSize = Math.max(8, Math.min(12, 9 + n.chunk_count * 0.2)) / globalScale
    ctx.font        = `600 ${fontSize}px system-ui, sans-serif`
    ctx.textAlign   = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillStyle   = hovered ? '#ffffff' : '#ffffffcc'
    ctx.fillText(
      n.name.length > 20 ? n.name.slice(0, 18) + '…' : n.name,
      node.x,
      node.y + r + fontSize * 1.3,
    )

    ctx.globalAlpha = 1
  }, [hoveredId])

  const paintNodePointer = useCallback((node: any, paintColor: string, ctx: CanvasRenderingContext2D) => {
    const n = node as ConceptNode
    ctx.fillStyle = paintColor
    ctx.beginPath()
    ctx.arc(node.x, node.y, n.size / 2 + 8, 0, Math.PI * 2)
    ctx.fill()
  }, [])

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const s = link.source
    const t = link.target
    if (!s?.x || !t?.x) return

    const w  = link.weight || 0.5
    // Use cluster color assigned to each node (falls back to index-based)
    const sc = s.color || CLUSTER_COLORS[(s.numId || 0) % CLUSTER_COLORS.length]
    const tc = t.color || CLUSTER_COLORS[(t.numId || 0) % CLUSTER_COLORS.length]

    const isActive = hoveredId !== null && (s.id === hoveredId || t.id === hoveredId)
    const isDimmed = hoveredId !== null && !isActive

    let baseAlpha: number
    let lineWidth: number
    let dash: number[]

    if (w >= 0.90) {
      baseAlpha = 0.85; lineWidth = 2.2; dash = []
    } else if (w >= 0.80) {
      baseAlpha = 0.45; lineWidth = 1.3; dash = []
    } else {
      baseAlpha = 0.45; lineWidth = 1.3; dash = [3, 5]
    }

    ctx.globalAlpha = isDimmed ? baseAlpha * 0.08 : isActive ? Math.min(1, baseAlpha * 1.6) : baseAlpha
    ctx.setLineDash(dash)

    const opacity = w >= 0.90 ? 'cc' : '80'
    const grad = ctx.createLinearGradient(s.x, s.y, t.x, t.y)
    grad.addColorStop(0, sc + opacity)
    grad.addColorStop(1, tc + opacity)

    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(t.x, t.y)
    ctx.strokeStyle = grad
    ctx.lineWidth   = lineWidth
    ctx.stroke()

    // Show relationship label at midpoint when zoomed in
    if (globalScale > 1.8 && link.label) {
      const mx = (s.x + t.x) / 2
      const my = (s.y + t.y) / 2
      ctx.setLineDash([])
      ctx.globalAlpha = 0.5
      ctx.font = `${9 / globalScale}px system-ui, sans-serif`
      ctx.fillStyle = '#ffffff'
      ctx.textAlign = 'center'
      ctx.textBaseline = 'middle'
      ctx.fillText(link.label, mx, my)
    }

    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }, [hoveredId])

  const paintBackground = useCallback((ctx: CanvasRenderingContext2D) => {
    const w = ctx.canvas.width
    const h = ctx.canvas.height
    ctx.fillStyle = '#07070e'
    ctx.fillRect(0, 0, w, h)
    for (const s of starsRef.current) {
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${s.a})`
      ctx.fill()
    }
  }, [])

  // ── Node interaction ────────────────────────────────────────────────────────

  const handleNodeClick = useCallback(async (node: any) => {
    if (graphMode === 'chunks') {
      const n = node as ChunkNode
      if (selectedChunk?.id === n.id) { setSelectedChunk(null); return }
      setSelectedChunk(n)
      setSelectedNode(null)
      return
    }
    const n = node as ConceptNode
    if (selectedNode?.id === n.id) { setSelectedNode(null); return }
    setSelectedNode(n)
    setSelectedChunk(null)
    setPanelDocs([])
    setPanelLoading(true)
    try {
      const data = await authFetch(`/concepts/${n.numId}/chunks`)
      setPanelDocs(Array.isArray(data) ? data : [])
    } catch { setPanelDocs([]) }
    finally { setPanelLoading(false) }
  }, [graphMode, selectedNode, selectedChunk])

  const handleNodeHover = useCallback((node: any) => {
    setHoveredId(node ? (node as ConceptNode).id : null)
  }, [])

  const handleExport = useCallback(async () => {
    if (!selectedNode) return
    setBriefingLoading(true)
    setShowBriefing(true)
    setBriefing('')
    setBriefingMeta(null)
    try {
      const data = await authFetch(`/concepts/${selectedNode.numId}/export`, { method: 'POST' })
      setBriefing(data.briefing || '')
      setBriefingMeta({ chunk_count: data.chunk_count, source_breakdown: data.source_breakdown || {} })
    } catch {
      setBriefing('Failed to generate briefing. Please try again.')
    } finally {
      setBriefingLoading(false)
    }
  }, [selectedNode])

  // ─── Render ───────────────────────────────────────────────────────────────

  const selectedColor = selectedNode?.color || '#a89bff'

  return (
    <div style={{
      position: 'fixed', top: 0, left: 0,
      width: '100vw', height: '100vh',
      background: '#07070e',
      overflow: 'hidden',
      fontFamily: 'system-ui, sans-serif',
      color: '#e8e8f0',
    }}>
      <style>{`
        @keyframes spin    { to { transform: rotate(360deg) } }
        @keyframes fadeIn  { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideIn { from { transform: translateX(100%) } to { transform: translateX(0) } }
        @keyframes pulse   { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>

      {/* Graph canvas */}
      {dims.w > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dims.w}
          height={dims.h}

          nodeCanvasObject={graphMode === 'chunks' ? paintChunkNode : paintNode}
          nodePointerAreaPaint={paintNodePointer}
          linkCanvasObject={paintLink}
          linkCanvasObjectMode={() => 'replace'}
          onRenderFramePre={paintBackground}

          d3AlphaDecay={0.04}
          d3VelocityDecay={0.4}
          cooldownTicks={150}
          warmupTicks={100}
          onEngineStop={() => {
            setGraphReady(true)
            if (!hasZoomed.current) {
              fgRef.current?.zoomToFit(400, 80)
              hasZoomed.current = true
            }
          }}

          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={() => setSelectedNode(null)}
          nodeLabel={(n: any) => (n as ConceptNode).description || ''}
        />
      )}

      {/* ── Floating controls (top-left) ─────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 20, left: 20,
        background: 'rgba(10,10,18,0.78)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: '14px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
        zIndex: 30,
        minWidth: 220,
        animation: 'fadeIn 0.4s ease',
      }}>
        {/* Title + status dot */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 9 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: graphReady ? '#34d399' : '#facc15',
            boxShadow: graphReady ? '0 0 8px #34d399' : '0 0 8px #facc15',
            animation: graphReady ? 'none' : 'pulse 1.4s ease infinite',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px' }}>Knowledge Galaxy</span>
        </div>

        {/* Mode toggle */}
        <div style={{ display: 'flex', background: 'rgba(255,255,255,0.05)', borderRadius: 8, padding: 2, gap: 2 }}>
          {(['concepts', 'chunks'] as const).map(mode => (
            <button
              key={mode}
              onClick={() => {
                if (mode === graphMode) return
                setGraphMode(mode)
                setSelectedNode(null)
                setSelectedChunk(null)
                if (mode === 'chunks') loadChunkGraph()
                else loadConceptGraph()
              }}
              style={{
                flex: 1, padding: '5px 0',
                background: graphMode === mode ? 'rgba(124,106,247,0.25)' : 'transparent',
                border: graphMode === mode ? '1px solid rgba(124,106,247,0.4)' : '1px solid transparent',
                borderRadius: 6,
                color: graphMode === mode ? '#a89bff' : 'rgba(255,255,255,0.35)',
                fontSize: 11, fontWeight: 500, cursor: 'pointer',
                textTransform: 'capitalize', transition: 'all 0.15s',
              }}
            >
              {mode}
            </button>
          ))}
        </div>

        {/* Live stats */}
        {statsText && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', lineHeight: 1.7 }}>
            {statsText}
          </div>
        )}

        {/* Build debug stats */}
        {buildStats && (
          <div style={{ fontSize: 10, color: 'rgba(168,155,255,0.5)', lineHeight: 1.6, borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: 8 }}>
            {buildStats}
          </div>
        )}

        {/* Build button — concept mode only */}
        <button
          onClick={handleBuild}
          disabled={building || loading || graphMode === 'chunks'}
          style={{
            padding: '7px 0',
            background: (building || loading) ? 'rgba(120,100,240,0.2)' : 'rgba(124,106,247,0.15)',
            border: '1px solid rgba(124,106,247,0.3)',
            borderRadius: 9,
            color: (building || loading) ? 'rgba(160,148,255,0.5)' : '#a89bff',
            fontSize: 12, fontWeight: 500,
            cursor: (building || loading) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            transition: 'all 0.15s',
          }}
        >
          {building && (
            <div style={{
              width: 11, height: 11,
              border: '2px solid rgba(160,148,255,0.3)',
              borderTopColor: '#a89bff',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          )}
          {building ? 'Building…' : 'Rebuild Connections'}
        </button>

        {/* Back link */}
        <Link href="/">
          <div
            style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.28)', textAlign: 'center', cursor: 'pointer', transition: 'color 0.15s' }}
            onMouseOver={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
            onMouseOut={e => e.currentTarget.style.color = 'rgba(255,255,255,0.28)'}
          >
            ← Back to home
          </div>
        </Link>
      </div>

      {/* ── Overlays ─────────────────────────────────────────────────── */}
      {loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, zIndex: 40,
          background: 'rgba(7,7,14,0.7)',
          backdropFilter: 'blur(4px)',
          animation: 'fadeIn 0.3s ease',
        }}>
          <div style={{ width: 28, height: 28, border: '2px solid rgba(124,106,247,0.3)', borderTopColor: '#a89bff', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.5)', margin: 0 }}>Loading galaxy…</p>
        </div>
      )}

      {error && !loading && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 40 }}>
          <span style={{ fontSize: 14, color: '#f87171' }}>{error}</span>
          <button
            onClick={() => loadGraph(graphMode)}
            style={{ padding: '7px 18px', background: 'rgba(248,113,113,0.12)', border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8, color: '#f87171', fontSize: 12, cursor: 'pointer' }}
          >
            Retry
          </button>
        </div>
      )}

      {noData && !loading && !error && (
        <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 10, zIndex: 40, animation: 'fadeIn 0.4s ease' }}>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.35)', margin: 0 }}>No concepts yet</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', margin: 0 }}>Capture some pages then click Build Graph.</p>
        </div>
      )}

      {/* ── Concept detail panel (right side) ───────────────────────── */}
      {selectedNode && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 300,
          background: 'rgba(10,10,18,0.84)',
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          zIndex: 35,
          display: 'flex', flexDirection: 'column',
          animation: 'slideIn 0.22s ease',
          overflowY: 'auto',
        }}>
          {/* Color accent strip */}
          <div style={{ height: 3, background: selectedColor, flexShrink: 0 }} />

          <div style={{ padding: '18px 20px', flex: 1 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: selectedColor, textTransform: 'uppercase', marginBottom: 5 }}>Concept</div>
                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, color: '#f0f0ff' }}>
                  {selectedNode.name}
                </div>
              </div>
              <button
                onClick={() => setSelectedNode(null)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
              >×</button>
            </div>

            {selectedNode.description && (
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.4)', lineHeight: 1.65, margin: '0 0 14px' }}>
                {selectedNode.description}
              </p>
            )}

            {/* Chunk count badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px',
              background: `${selectedColor}18`,
              border: `1px solid ${selectedColor}33`,
              borderRadius: 20, marginBottom: 20,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: selectedColor }} />
              <span style={{ fontSize: 11.5, color: selectedColor }}>
                {selectedNode.chunk_count} chunk{selectedNode.chunk_count !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Relevant chunks */}
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 10 }}>
              Documents
            </div>

            {panelLoading && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 8, color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>
                <div style={{ width: 12, height: 12, border: '2px solid rgba(255,255,255,0.15)', borderTopColor: selectedColor, borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                Loading…
              </div>
            )}

            {!panelLoading && panelDocs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                {panelDocs.map((doc: ConceptDoc) => (
                  <Link key={doc.id} href={`/document/${doc.id}`}>
                    <div
                      style={{ padding: '10px 13px', background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.07)', borderRadius: 9, cursor: 'pointer', transition: 'background 0.15s, border-color 0.15s' }}
                      onMouseOver={e => { e.currentTarget.style.background = `${selectedColor}10`; e.currentTarget.style.borderColor = `${selectedColor}30` }}
                      onMouseOut={e =>  { e.currentTarget.style.background = 'rgba(255,255,255,0.04)'; e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)' }}
                    >
                      <div style={{ fontSize: 12.5, fontWeight: 500, color: 'rgba(255,255,255,0.75)', lineHeight: 1.4, marginBottom: doc.excerpt ? 4 : 0 }}>
                        {doc.title}
                      </div>
                      {doc.excerpt && (
                        <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.35)', lineHeight: 1.5 }}>
                          {doc.excerpt.length > 100 ? doc.excerpt.slice(0, 98) + '…' : doc.excerpt}
                        </div>
                      )}
                      <div style={{ marginTop: 5, fontSize: 10.5, color: selectedColor, opacity: 0.6 }}>
                        Open document →
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            )}

            {!panelLoading && panelDocs.length === 0 && (
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.2)', margin: 0 }}>No documents found for this concept.</p>
            )}

            {/* Export Briefing button */}
            <button
              onClick={handleExport}
              disabled={briefingLoading}
              style={{
                marginTop: 20, width: '100%',
                padding: '9px 0',
                background: briefingLoading ? 'rgba(168,155,255,0.08)' : 'rgba(168,155,255,0.12)',
                border: `1px solid ${selectedColor}44`,
                borderRadius: 9,
                color: briefingLoading ? 'rgba(168,155,255,0.4)' : '#a89bff',
                fontSize: 12, fontWeight: 500,
                cursor: briefingLoading ? 'not-allowed' : 'pointer',
                display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
                transition: 'all 0.15s',
              }}
            >
              {briefingLoading
                ? <><div style={{ width: 11, height: 11, border: '2px solid rgba(168,155,255,0.3)', borderTopColor: '#a89bff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />Generating…</>
                : '⬡ Export Briefing'
              }
            </button>
          </div>
        </div>
      )}

      {/* ── Chunk detail panel ───────────────────────────────────────── */}
      {selectedChunk && graphMode === 'chunks' && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 300,
          background: 'rgba(10,10,18,0.84)',
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          zIndex: 35,
          display: 'flex', flexDirection: 'column',
          animation: 'slideIn 0.22s ease',
          overflowY: 'auto',
        }}>
          <div style={{ height: 3, background: selectedChunk.color, flexShrink: 0 }} />
          <div style={{ padding: '18px 20px', flex: 1 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: selectedChunk.color, textTransform: 'uppercase', marginBottom: 5 }}>
                  {selectedChunk.tier} chunk
                </div>
                <Link href={`/document/${selectedChunk.document_id}`}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: '#a89bff', lineHeight: 1.3, cursor: 'pointer', textDecoration: 'underline', textDecorationColor: 'transparent' }}
                    onMouseOver={e => (e.currentTarget.style.textDecorationColor = '#a89bff')}
                    onMouseOut={e => (e.currentTarget.style.textDecorationColor = 'transparent')}
                  >
                    {selectedChunk.document_title}
                  </div>
                </Link>
              </div>
              <button onClick={() => setSelectedChunk(null)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '2px 4px', flexShrink: 0 }}
              >×</button>
            </div>

            {/* Edge count badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px',
              background: `${selectedChunk.color}18`,
              border: `1px solid ${selectedChunk.color}33`,
              borderRadius: 20, marginBottom: 16,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: selectedChunk.color }} />
              <span style={{ fontSize: 11.5, color: selectedChunk.color }}>
                Connected to {selectedChunk.edge_count} chunk{selectedChunk.edge_count !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Chunk preview */}
            <div style={{ fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em', textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)', marginBottom: 8 }}>
              Content
            </div>
            <div style={{
              fontSize: 12.5, color: 'rgba(255,255,255,0.55)', lineHeight: 1.7,
              background: 'rgba(255,255,255,0.03)', borderRadius: 8, padding: '10px 12px',
              border: '1px solid rgba(255,255,255,0.06)', marginBottom: 16,
            }}>
              {selectedChunk.preview}
              {selectedChunk.preview.length >= 120 && '…'}
            </div>

            {/* Find similar */}
            <Link href={`/?q=${encodeURIComponent(selectedChunk.preview.slice(0, 80))}`}>
              <button style={{
                width: '100%', padding: '9px 0',
                background: 'rgba(168,155,255,0.1)',
                border: '1px solid rgba(168,155,255,0.25)',
                borderRadius: 9, color: '#a89bff',
                fontSize: 12, fontWeight: 500, cursor: 'pointer',
              }}>
                Find similar →
              </button>
            </Link>
          </div>
        </div>
      )}

      {/* ── Export Briefing modal ─────────────────────────────────────── */}
      {showBriefing && (
        <div
          onClick={() => setShowBriefing(false)}
          style={{
            position: 'fixed', inset: 0,
            background: 'rgba(0,0,0,0.6)',
            backdropFilter: 'blur(6px)',
            zIndex: 60,
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            animation: 'fadeIn 0.2s ease',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            style={{
              width: 560, maxWidth: 'calc(100vw - 40px)',
              background: 'rgba(10,10,15,0.95)',
              backdropFilter: 'blur(20px)',
              WebkitBackdropFilter: 'blur(20px)',
              border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 16,
              padding: '22px 24px',
              display: 'flex', flexDirection: 'column', gap: 14,
            }}
          >
            {/* Modal header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div>
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', color: selectedColor, textTransform: 'uppercase', marginBottom: 4 }}>LLM Briefing</div>
                <div style={{ fontSize: 15, fontWeight: 600, color: '#f0f0ff' }}>{selectedNode?.name}</div>
              </div>
              <button
                onClick={() => setShowBriefing(false)}
                style={{ background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)', fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '2px 6px' }}
              >×</button>
            </div>

            {/* Briefing textarea */}
            {briefingLoading ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '20px 0', color: 'rgba(255,255,255,0.3)', fontSize: 13 }}>
                <div style={{ width: 14, height: 14, border: '2px solid rgba(168,155,255,0.3)', borderTopColor: '#a89bff', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                Compressing knowledge…
              </div>
            ) : (
              <textarea
                readOnly
                value={briefing}
                style={{
                  width: '100%', minHeight: 220,
                  background: '#0d0d14',
                  border: '1px solid #1a1a2e',
                  color: '#c0c0d0',
                  fontFamily: '"DM Mono", "Fira Mono", monospace',
                  fontSize: 13, lineHeight: 1.7,
                  padding: 16, borderRadius: 10,
                  resize: 'none', outline: 'none',
                  boxSizing: 'border-box',
                }}
              />
            )}

            {/* Metadata + copy button */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.25)', lineHeight: 1.6 }}>
                {briefingMeta && (
                  <>
                    Compressed from {briefingMeta.chunk_count} chunk{briefingMeta.chunk_count !== 1 ? 's' : ''} ·{' '}
                    {Object.entries(briefingMeta.source_breakdown).map(([k, v]) => `${v} ${k}`).join(', ')}
                  </>
                )}
              </div>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(briefing)
                  setBriefingCopied(true)
                  setTimeout(() => setBriefingCopied(false), 2000)
                }}
                disabled={briefingLoading || !briefing}
                style={{
                  padding: '7px 16px',
                  background: briefingCopied ? 'rgba(52,211,153,0.15)' : 'rgba(168,155,255,0.12)',
                  border: `1px solid ${briefingCopied ? 'rgba(52,211,153,0.4)' : 'rgba(168,155,255,0.3)'}`,
                  borderRadius: 8,
                  color: briefingCopied ? '#34d399' : '#a89bff',
                  fontSize: 12, fontWeight: 500,
                  cursor: 'pointer',
                  transition: 'all 0.2s',
                  flexShrink: 0,
                }}
              >
                {briefingCopied ? '✓ Copied' : 'Copy to clipboard'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom legend + hint */}
      {graphReady && graphData.nodes.length > 0 && (
        <div style={{ position: 'absolute', bottom: 18, left: 20, display: 'flex', flexDirection: 'column', gap: 6, pointerEvents: 'none', animation: 'fadeIn 1s ease' }}>
          {/* Edge legend */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* Strong */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="rgba(168,155,255,0.85)" strokeWidth="2.2"/></svg>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>strong ≥0.90</span>
            </div>
            {/* Medium */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="rgba(168,155,255,0.45)" strokeWidth="1.3"/></svg>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>related ≥0.80</span>
            </div>
            {/* Weak dashed */}
            <div style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
              <svg width="28" height="8"><line x1="0" y1="4" x2="28" y2="4" stroke="rgba(168,155,255,0.45)" strokeWidth="1.3" strokeDasharray="3 4"/></svg>
              <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.3)' }}>bridge ≥0.75</span>
            </div>
          </div>
          <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.12)' }}>Click node to inspect · Scroll to zoom · Drag to explore</span>
        </div>
      )}
    </div>
  )
}
