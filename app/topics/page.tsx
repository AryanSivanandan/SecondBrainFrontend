'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// react-force-graph-2d requires canvas — SSR must be disabled
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

// ─── Types ───────────────────────────────────────────────────────────────────

interface TopicNode {
  id: string
  numId: number
  name: string
  description: string
  chunk_count: number
  size: number
  color: string
  is_single: boolean
  nodeType: 'topic'
  x?: number
  y?: number
}

interface DocNode {
  id: string
  docId: number
  name: string
  parentTopic: string
  color: string
  nodeType: 'doc'
  x?: number
  y?: number
}

type GraphNode = TopicNode | DocNode

interface GraphLink {
  source: string
  target: string
  similarity: number
  linkType: 'topic-topic' | 'topic-doc'
}

interface GraphData {
  nodes: GraphNode[]
  links: GraphLink[]
}

interface TopicDoc {
  id: number
  title: string
  url?: string
  excerpt?: string
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND = '/api'

const CLUSTER_COLORS = [
  '#22d3ee', // cyan
  '#a3e635', // chartreuse
  '#fb923c', // coral/orange
  '#facc15', // yellow
  '#a78bfa', // purple
  '#34d399', // mint/emerald
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

// ─── Main component ───────────────────────────────────────────────────────────

export default function TopicsPage() {
  const fgRef    = useRef<any>(null)
  const starsRef = useRef<{ x: number; y: number; r: number; a: number }[]>([])

  const [graphData,     setGraphData]     = useState<GraphData>({ nodes: [], links: [] })
  const [topicDocsMap,  setTopicDocsMap]  = useState<Record<string, TopicDoc[]>>({})
  const [colorMap,      setColorMap]      = useState<Record<string, string>>({})

  const [loading,       setLoading]       = useState(true)
  const [rebuilding,    setRebuilding]    = useState(false)
  const [graphReady,    setGraphReady]    = useState(false)
  const [autoMsg,       setAutoMsg]       = useState<string | null>(null)
  const [error,         setError]         = useState<string | null>(null)
  const [noData,        setNoData]        = useState(false)

  const [selectedTopic, setSelectedTopic] = useState<TopicNode | null>(null)
  const [hoveredId,     setHoveredId]     = useState<string | null>(null)
  const [dims,          setDims]          = useState({ w: 0, h: 0 })

  // Track window dimensions for full-viewport canvas
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

  // ── Data loading ────────────────────────────────────────────────────────────

  const buildGraph = useCallback(async (topicData: any) => {
    const topics: any[] = topicData.nodes || []
    const edges: any[]  = topicData.edges || []

    if (topics.length === 0) { setNoData(true); return }
    setNoData(false)

    // Assign a stable color per topic index
    const newColorMap: Record<string, string> = {}
    topics.forEach((t, i) => {
      newColorMap[String(t.id)] = t.is_single
        ? 'rgba(160,130,220,0.55)'
        : CLUSTER_COLORS[i % CLUSTER_COLORS.length]
    })
    setColorMap(newColorMap)

    // Fetch all topic docs in parallel
    const docResults = await Promise.all(
      topics.map(t =>
        authFetch(`/topics/${t.id}/chunks`).catch(() => [])
      )
    )
    const newDocsMap: Record<string, TopicDoc[]> = {}
    topics.forEach((t, i) => {
      newDocsMap[String(t.id)] = docResults[i] || []
    })
    setTopicDocsMap(newDocsMap)

    // Save doc count for auto-rebuild detection
    const totalDocs = new Set(docResults.flat().map((d: any) => d.id)).size
    try { localStorage.setItem('sb_topics_rebuild_doc_count', String(totalDocs)) } catch {}

    // Build nodes
    const nodes: GraphNode[] = []
    const links: GraphLink[] = []

    for (const t of topics) {
      const color = newColorMap[String(t.id)]
      nodes.push({
        id:          String(t.id),
        numId:       t.id,
        name:        t.name,
        description: t.description || '',
        chunk_count: t.chunk_count,
        size:        t.is_single ? 4 : Math.max(10, Math.min(36, 10 + t.chunk_count * 2.5)),
        color,
        is_single:   t.is_single,
        nodeType:    'topic',
      })

      // Doc satellite nodes for non-single topics
      if (!t.is_single) {
        const docs = newDocsMap[String(t.id)] || []
        const unique = docs.filter((d, i, arr) => arr.findIndex(x => x.id === d.id) === i)
        for (const doc of unique) {
          const docNodeId = `doc-${doc.id}-topic-${t.id}`
          nodes.push({
            id:          docNodeId,
            docId:       doc.id,
            name:        doc.title || 'Untitled',
            parentTopic: String(t.id),
            color,
            nodeType:    'doc',
          })
          links.push({ source: String(t.id), target: docNodeId, similarity: 1, linkType: 'topic-doc' })
        }
      }
    }

    // Topic-to-topic edges
    for (const e of edges) {
      links.push({
        source:     String(e.source),
        target:     String(e.target),
        similarity: e.similarity,
        linkType:   'topic-topic',
      })
    }

    setGraphData({ nodes, links })
  }, [])

  const loadWithAutoRebuild = useCallback(async () => {
    setLoading(true)
    setError(null)
    setNoData(false)
    setGraphReady(false)
    try {
      const [topicData, docsData] = await Promise.all([
        authFetch('/topics'),
        authFetch('/documents?limit=500').catch(() => ({ documents: [] })),
      ])

      const topicNodes: any[] = topicData.nodes || []
      const currentDocCount   = (docsData.documents || []).length

      let storedCount = 0
      try { storedCount = parseInt(localStorage.getItem('sb_topics_rebuild_doc_count') || '0', 10) } catch {}

      const shouldRebuild =
        topicNodes.length === 0 ||
        (currentDocCount > storedCount + 4)

      if (shouldRebuild) {
        const msg = topicNodes.length === 0
          ? 'Building your knowledge galaxy for the first time…'
          : 'New captures detected — updating your galaxy…'
        setAutoMsg(msg)
        await authFetch('/topics/rebuild', { method: 'POST' })
        const fresh = await authFetch('/topics')
        await buildGraph(fresh)
        setAutoMsg(null)
      } else {
        await buildGraph(topicData)
      }
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [buildGraph])

  useEffect(() => { loadWithAutoRebuild() }, [loadWithAutoRebuild])

  // ── D3 force customization ──────────────────────────────────────────────────

  useEffect(() => {
    if (!fgRef.current || graphData.nodes.length === 0) return
    const fg = fgRef.current

    fg.d3Force('charge')?.strength((n: GraphNode) => {
      if (n.nodeType === 'doc') return -25
      const t = n as TopicNode
      return t.is_single ? -20 : -80 - t.chunk_count * 5
    })

    fg.d3Force('link')?.distance((l: GraphLink) => {
      if (l.linkType === 'topic-doc') return 45
      return Math.max(60, 120 - l.similarity * 50)
    })
  }, [graphData])

  // ── Rebuild ─────────────────────────────────────────────────────────────────

  const handleRebuild = async () => {
    setRebuilding(true)
    setGraphReady(false)
    try {
      await authFetch('/topics/rebuild', { method: 'POST' })
      const fresh = await authFetch('/topics')
      await buildGraph(fresh)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setRebuilding(false)
    }
  }

  // ── Canvas paint callbacks ──────────────────────────────────────────────────

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const n: GraphNode = node
    const isHovered    = n.id === hoveredId
    const isDimmed     = hoveredId !== null && !isHovered &&
                         !(n.nodeType === 'doc' && (n as DocNode).parentTopic === hoveredId)
    const alpha        = isDimmed ? 0.18 : 1

    ctx.globalAlpha = alpha

    if (n.nodeType === 'topic') {
      const t = n as TopicNode
      const r = t.size / 2

      if (!t.is_single) {
        // Multi-layer glow (bloom effect)
        const glowLayers = isHovered ? 4 : 3
        for (let i = glowLayers; i >= 1; i--) {
          ctx.beginPath()
          ctx.arc(node.x, node.y, r + i * 6, 0, Math.PI * 2)
          ctx.fillStyle = t.color + Math.floor((0.06 / i) * 255).toString(16).padStart(2, '0')
          ctx.fill()
        }

        // Core fill
        const grad = ctx.createRadialGradient(node.x - r * 0.3, node.y - r * 0.3, 0, node.x, node.y, r)
        grad.addColorStop(0, '#ffffff55')
        grad.addColorStop(0.4, t.color + 'cc')
        grad.addColorStop(1,   t.color + '88')
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
        ctx.fillStyle = grad
        ctx.fill()

        // Ring
        ctx.beginPath()
        ctx.arc(node.x, node.y, r, 0, Math.PI * 2)
        ctx.strokeStyle = isHovered ? '#ffffff88' : t.color + 'aa'
        ctx.lineWidth   = isHovered ? 1.5 : 0.8
        ctx.stroke()

        // Label
        const fontSize = Math.max(8, Math.min(12, 9 + t.chunk_count * 0.3)) / globalScale
        ctx.font        = `600 ${fontSize}px system-ui, sans-serif`
        ctx.textAlign   = 'center'
        ctx.textBaseline = 'middle'
        ctx.fillStyle   = isHovered ? '#ffffff' : '#ffffffcc'
        ctx.fillText(
          t.name.length > 20 ? t.name.slice(0, 18) + '…' : t.name,
          node.x,
          node.y + r + fontSize * 1.2,
        )
      } else {
        // Single-chunk node — small muted dot, label on hover only
        ctx.beginPath()
        ctx.arc(node.x, node.y, 3, 0, Math.PI * 2)
        ctx.fillStyle = t.color
        ctx.fill()

        if (isHovered) {
          const fontSize = 9 / globalScale
          ctx.font       = `${fontSize}px system-ui, sans-serif`
          ctx.textAlign  = 'center'
          ctx.fillStyle  = '#ffffffaa'
          ctx.fillText(t.name.length > 22 ? t.name.slice(0, 20) + '…' : t.name, node.x, node.y + 3 + fontSize * 1.3)
        }
      }
    } else {
      // Doc satellite — tiny white/colored dot
      const color = (n as DocNode).color
      ctx.beginPath()
      ctx.arc(node.x, node.y, isHovered ? 3.5 : 2.2, 0, Math.PI * 2)
      ctx.fillStyle = isHovered ? '#ffffff' : color + '99'
      ctx.fill()
    }

    ctx.globalAlpha = 1
  }, [hoveredId])

  const paintNodePointer = useCallback((node: any, paintColor: string, ctx: CanvasRenderingContext2D) => {
    const n: GraphNode = node
    ctx.fillStyle = paintColor
    if (n.nodeType === 'topic') {
      const t = n as TopicNode
      ctx.beginPath()
      ctx.arc(node.x, node.y, t.is_single ? 8 : t.size / 2 + 8, 0, Math.PI * 2)
      ctx.fill()
    } else {
      ctx.beginPath()
      ctx.arc(node.x, node.y, 10, 0, Math.PI * 2)
      ctx.fill()
    }
  }, [])

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const src = link.source
    const tgt = link.target
    if (!src?.x || !tgt?.x) return

    const srcColor: string = src.color || '#888'
    const tgtColor: string = tgt.color || '#888'

    const isActive = hoveredId !== null && (src.id === hoveredId || tgt.id === hoveredId)
    const isDimmed = hoveredId !== null && !isActive

    ctx.globalAlpha = isDimmed ? 0.04 : link.linkType === 'topic-topic' ? 0.5 : 0.15

    if (link.linkType === 'topic-topic') {
      const grad = ctx.createLinearGradient(src.x, src.y, tgt.x, tgt.y)
      grad.addColorStop(0, srcColor)
      grad.addColorStop(1, tgtColor)
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle = grad
      ctx.lineWidth   = Math.max(0.5, (link.similarity || 0.5) * 1.5)
      ctx.stroke()
    } else {
      ctx.beginPath()
      ctx.moveTo(src.x, src.y)
      ctx.lineTo(tgt.x, tgt.y)
      ctx.strokeStyle = srcColor
      ctx.lineWidth   = 0.5
      ctx.stroke()
    }

    ctx.globalAlpha = 1
  }, [hoveredId])

  const paintBackground = useCallback((ctx: CanvasRenderingContext2D) => {
    const canvas = ctx.canvas
    const w = canvas.width
    const h = canvas.height
    ctx.fillStyle = '#07070e'
    ctx.fillRect(0, 0, w, h)

    // Star field
    for (const s of starsRef.current) {
      ctx.beginPath()
      ctx.arc(s.x * w, s.y * h, s.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${s.a})`
      ctx.fill()
    }
  }, [])

  // ── Node interaction ────────────────────────────────────────────────────────

  const handleNodeClick = useCallback((node: any) => {
    const n: GraphNode = node
    if (n.nodeType === 'doc') {
      window.open(`/document/${(n as DocNode).docId}`, '_blank')
    } else {
      const t = n as TopicNode
      setSelectedTopic(prev => prev?.id === t.id ? null : t)
    }
  }, [])

  const handleNodeHover = useCallback((node: any) => {
    setHoveredId(node ? (node as GraphNode).id : null)
  }, [])

  // ─── Render ───────────────────────────────────────────────────────────────

  const topicList = selectedTopic ? (topicDocsMap[selectedTopic.id] || []) : []
  const selectedColor = selectedTopic ? colorMap[selectedTopic.id] : 'var(--accent)'

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
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeIn { from { opacity: 0 } to { opacity: 1 } }
        @keyframes slideInRight { from { transform: translateX(100%) } to { transform: translateX(0) } }
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
      `}</style>

      {/* Graph canvas */}
      {dims.w > 0 && (
        <ForceGraph2D
          ref={fgRef}
          graphData={graphData}
          width={dims.w}
          height={dims.h}

          // Rendering
          nodeCanvasObject={paintNode}
          nodePointerAreaPaint={paintNodePointer}
          linkCanvasObject={paintLink}
          linkCanvasObjectMode={() => 'replace'}
          onRenderFramePre={paintBackground}

          // Forces
          d3AlphaDecay={0.015}
          d3VelocityDecay={0.25}
          cooldownTicks={300}
          warmupTicks={50}
          onEngineStop={() => setGraphReady(true)}

          // Interaction
          onNodeClick={handleNodeClick}
          onNodeHover={handleNodeHover}
          onBackgroundClick={() => setSelectedTopic(null)}
          nodeLabel={(n: any) => (n as GraphNode).nodeType === 'doc' ? (n as DocNode).name : ''}
        />
      )}

      {/* ── Floating controls (top-left) ─────────────────────────────── */}
      <div style={{
        position: 'absolute', top: 20, left: 20,
        background: 'rgba(10,10,18,0.75)',
        backdropFilter: 'blur(18px)',
        WebkitBackdropFilter: 'blur(18px)',
        border: '1px solid rgba(255,255,255,0.08)',
        borderRadius: 14,
        padding: '14px 18px',
        display: 'flex', flexDirection: 'column', gap: 10,
        zIndex: 30,
        minWidth: 210,
        animation: 'fadeIn 0.5s ease',
      }}>
        {/* Title row */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{
            width: 8, height: 8, borderRadius: '50%',
            background: graphReady ? '#34d399' : '#facc15',
            boxShadow: graphReady ? '0 0 8px #34d399' : '0 0 8px #facc15',
            animation: graphReady ? 'none' : 'pulse 1.4s ease infinite',
            flexShrink: 0,
          }} />
          <span style={{ fontSize: 13, fontWeight: 600, letterSpacing: '-0.2px' }}>Knowledge Galaxy</span>
        </div>

        {/* Stats */}
        {graphData.nodes.length > 0 && (
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.45)', lineHeight: 1.7 }}>
            {graphData.nodes.filter(n => n.nodeType === 'topic').length} topics ·{' '}
            {graphData.nodes.filter(n => n.nodeType === 'doc').length} documents
          </div>
        )}

        {/* Rebuild button */}
        <button
          onClick={handleRebuild}
          disabled={rebuilding || loading}
          style={{
            padding: '7px 0',
            background: (rebuilding || loading) ? 'rgba(120,100,240,0.25)' : 'rgba(124,106,247,0.18)',
            border: '1px solid rgba(124,106,247,0.35)',
            borderRadius: 9,
            color: (rebuilding || loading) ? 'rgba(160,148,255,0.6)' : '#a89bff',
            fontSize: 12, fontWeight: 500,
            cursor: (rebuilding || loading) ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 7,
            transition: 'all 0.15s',
          }}
        >
          {rebuilding && (
            <div style={{
              width: 11, height: 11,
              border: '2px solid rgba(160,148,255,0.3)',
              borderTopColor: '#a89bff',
              borderRadius: '50%',
              animation: 'spin 0.7s linear infinite',
            }} />
          )}
          {rebuilding ? 'Rebuilding…' : 'Rebuild Galaxy'}
        </button>

        {/* Back link */}
        <Link href="/">
          <div style={{
            fontSize: 11.5, color: 'rgba(255,255,255,0.3)',
            textAlign: 'center', cursor: 'pointer',
            transition: 'color 0.15s',
          }}
            onMouseOver={e => e.currentTarget.style.color = 'rgba(255,255,255,0.6)'}
            onMouseOut={e => e.currentTarget.style.color = 'rgba(255,255,255,0.3)'}
          >
            ← Back to home
          </div>
        </Link>
      </div>

      {/* ── Overlays (loading / error / empty) ──────────────────────── */}
      {(loading || autoMsg) && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 16, zIndex: 40,
          background: 'rgba(7,7,14,0.75)',
          backdropFilter: 'blur(4px)',
          animation: 'fadeIn 0.3s ease',
        }}>
          <div style={{
            width: 28, height: 28,
            border: '2px solid rgba(124,106,247,0.3)',
            borderTopColor: '#a89bff',
            borderRadius: '50%',
            animation: 'spin 0.8s linear infinite',
          }} />
          <p style={{ fontSize: 14, color: 'rgba(255,255,255,0.6)', margin: 0, maxWidth: 320, textAlign: 'center', lineHeight: 1.6 }}>
            {autoMsg || 'Loading…'}
          </p>
        </div>
      )}

      {error && !loading && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, zIndex: 40,
        }}>
          <span style={{ fontSize: 14, color: '#f87171' }}>{error}</span>
          <button
            onClick={loadWithAutoRebuild}
            style={{
              padding: '7px 18px', background: 'rgba(248,113,113,0.15)',
              border: '1px solid rgba(248,113,113,0.3)', borderRadius: 8,
              color: '#f87171', fontSize: 12, cursor: 'pointer',
            }}
          >
            Retry
          </button>
        </div>
      )}

      {noData && !loading && !error && (
        <div style={{
          position: 'absolute', inset: 0,
          display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
          gap: 10, zIndex: 40,
          animation: 'fadeIn 0.4s ease',
        }}>
          <p style={{ fontSize: 16, color: 'rgba(255,255,255,0.4)', margin: 0 }}>No topics yet</p>
          <p style={{ fontSize: 13, color: 'rgba(255,255,255,0.2)', margin: 0 }}>
            Capture some pages, then rebuild the galaxy.
          </p>
        </div>
      )}

      {/* ── Topic detail panel (right side) ─────────────────────────── */}
      {selectedTopic && (
        <div style={{
          position: 'absolute', right: 0, top: 0, bottom: 0,
          width: 300,
          background: 'rgba(10,10,18,0.82)',
          backdropFilter: 'blur(22px)',
          WebkitBackdropFilter: 'blur(22px)',
          borderLeft: '1px solid rgba(255,255,255,0.07)',
          zIndex: 35,
          display: 'flex', flexDirection: 'column',
          animation: 'slideInRight 0.22s ease',
          overflowY: 'auto',
        }}>
          {/* Color accent strip */}
          <div style={{ height: 3, background: selectedColor, flexShrink: 0 }} />

          <div style={{ padding: '18px 20px', flex: 1 }}>
            {/* Header */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
              <div>
                <div style={{
                  fontSize: 10, fontWeight: 700, letterSpacing: '0.08em',
                  color: selectedColor, textTransform: 'uppercase', marginBottom: 5,
                }}>Topic</div>
                <div style={{ fontSize: 17, fontWeight: 600, lineHeight: 1.3, color: '#f0f0ff' }}>
                  {selectedTopic.name}
                </div>
              </div>
              <button
                onClick={() => setSelectedTopic(null)}
                style={{
                  background: 'none', border: 'none', color: 'rgba(255,255,255,0.3)',
                  fontSize: 22, cursor: 'pointer', lineHeight: 1, padding: '2px 4px',
                  flexShrink: 0,
                }}
              >×</button>
            </div>

            {selectedTopic.description && (
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.45)', lineHeight: 1.65, margin: '0 0 16px' }}>
                {selectedTopic.description}
              </p>
            )}

            {/* Chunk count badge */}
            <div style={{
              display: 'inline-flex', alignItems: 'center', gap: 6,
              padding: '4px 10px',
              background: `${selectedColor}18`,
              border: `1px solid ${selectedColor}33`,
              borderRadius: 20,
              marginBottom: 20,
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: selectedColor }} />
              <span style={{ fontSize: 11.5, color: selectedColor }}>
                {selectedTopic.chunk_count} chunk{selectedTopic.chunk_count !== 1 ? 's' : ''}
              </span>
            </div>

            {/* Documents */}
            {topicList.length > 0 && (
              <div>
                <div style={{
                  fontSize: 10.5, fontWeight: 700, letterSpacing: '0.07em',
                  textTransform: 'uppercase', color: 'rgba(255,255,255,0.25)',
                  marginBottom: 10,
                }}>Documents</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {topicList.map(doc => (
                    <Link key={doc.id} href={`/document/${doc.id}`}>
                      <div
                        style={{
                          padding: '10px 14px',
                          background: 'rgba(255,255,255,0.04)',
                          border: '1px solid rgba(255,255,255,0.07)',
                          borderRadius: 10,
                          cursor: 'pointer',
                          transition: 'background 0.15s, border-color 0.15s',
                        }}
                        onMouseOver={e => {
                          e.currentTarget.style.background = `${selectedColor}12`
                          e.currentTarget.style.borderColor = `${selectedColor}33`
                        }}
                        onMouseOut={e => {
                          e.currentTarget.style.background = 'rgba(255,255,255,0.04)'
                          e.currentTarget.style.borderColor = 'rgba(255,255,255,0.07)'
                        }}
                      >
                        <div style={{ fontSize: 12.5, fontWeight: 500, color: '#e0e0f5', lineHeight: 1.4, marginBottom: doc.excerpt ? 4 : 0 }}>
                          {doc.title || 'Untitled'}
                        </div>
                        {doc.excerpt && (
                          <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
                            {doc.excerpt.slice(0, 80)}{doc.excerpt.length > 80 ? '…' : ''}
                          </div>
                        )}
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}

            {topicList.length === 0 && !selectedTopic.is_single && (
              <p style={{ fontSize: 12.5, color: 'rgba(255,255,255,0.25)', margin: 0 }}>No documents found for this topic.</p>
            )}
          </div>
        </div>
      )}

      {/* Hint text (bottom-left, fades in after graph settles) */}
      {graphReady && graphData.nodes.length > 0 && (
        <div style={{
          position: 'absolute', bottom: 18, left: 20,
          fontSize: 11, color: 'rgba(255,255,255,0.18)',
          pointerEvents: 'none',
          animation: 'fadeIn 1s ease',
        }}>
          Click topic node to inspect · Click doc node to open · Scroll to zoom · Drag to explore
        </div>
      )}
    </div>
  )
}
