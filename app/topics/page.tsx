'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

const BACKEND = '/api'
const COLORS = [
  '#22d3ee','#a3e635','#fb923c','#facc15','#a78bfa',
  '#34d399','#f97316','#c084fc','#f472b6','#2dd4bf',
  '#60a5fa','#4ade80','#fbbf24','#e879f9','#38bdf8',
]

async function authFetch(path: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  return fetch(`${BACKEND}${path}`, {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  }).then(r => r.json())
}

export default function GraphPage() {
  const fgRef     = useRef<any>(null)
  const starsRef  = useRef<any[]>([])
  const hasZoomed = useRef(false)

  const [graphData, setGraphData] = useState<{ nodes: any[]; links: any[] }>({ nodes: [], links: [] })
  const [stats, setStats]         = useState<any>({})
  const [loading, setLoading]     = useState(true)
  const [building, setBuilding]   = useState(false)
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selected, setSelected]   = useState<any>(null)
  const [dims, setDims]           = useState({ w: 0, h: 0 })
  const [mousePos, setMousePos]   = useState({ x: 0, y: 0 })
  const [tooltip, setTooltip]     = useState<any>(null)

  useEffect(() => {
    const upd = () => setDims({ w: window.innerWidth, h: window.innerHeight })
    upd()
    window.addEventListener('resize', upd)
    return () => window.removeEventListener('resize', upd)
  }, [])

  const load = useCallback(async () => {
    setLoading(true)
    hasZoomed.current = false
    try {
      const data = await authFetch('/documents/graph')
      const rawNodes: any[] = data.nodes || []
      const rawEdges: any[] = data.edges || []

      const domainColors: Record<string, string> = {}
      const docColorMap: Record<number, string>  = {}
      let ci = 0
      rawNodes.filter(n => n.type === 'document').forEach(n => {
        const d = n.domain || 'unknown'
        if (!domainColors[d]) domainColors[d] = COLORS[ci++ % COLORS.length]
        n.color = domainColors[d]
        docColorMap[n.document_id] = n.color
      })
      rawNodes.filter(n => n.type === 'chunk').forEach(n => {
        n.color = docColorMap[n.document_id] || '#6366f1'
      })

      setGraphData({ nodes: rawNodes, links: rawEdges })
      setStats(data.stats || {})
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { load() }, [load])

  const handleEngineStop = useCallback(() => {
    if (fgRef.current && !hasZoomed.current) {
      fgRef.current.zoomToFit(800, 80)
      hasZoomed.current = true
    }
  }, [])

  const applyForces = useCallback(() => {
    const fg = fgRef.current
    if (!fg) return
    fg.d3Force('charge').strength((n: any) => n.is_hub ? -180 : -18)
    fg.d3Force('link')
      .distance((l: any) =>
        l.type === 'parent'     ? 28 :      // tighter orbit — chunks stay close to hub
        l.type === 'similarity' ? 350 :
        90
      )
      .strength((l: any) =>
        l.type === 'parent'     ? 0.6 :
        l.type === 'similarity' ? 0.25 :    // restored — pulls related clusters together
        0.1
      )
    fg.d3ReheatSimulation()
  }, [])

  // Apply forces once graph data + ref are ready
  useEffect(() => {
    if (graphData.nodes.length === 0) return
    const t = setTimeout(applyForces, 50)
    return () => clearTimeout(t)
  }, [graphData, applyForces])

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const color = node.color || '#6366f1'
    const isHub = node.is_hub
    const isHov = node.id === hoveredId
    const size  = isHub ? Math.max(10, Math.min(26, node.size || 12)) : (isHov ? 5 : 3)

    if (isHub) {
      ;([3.2, 2.2, 1.5] as number[]).forEach((mult, i) => {
        ctx.beginPath()
        ctx.arc(node.x, node.y, size * mult, 0, 2 * Math.PI)
        ctx.fillStyle = color + ['0d','18','28'][i]
        ctx.fill()
      })
    }

    if (isHov) {
      ctx.beginPath()
      ctx.arc(node.x, node.y, size + 3, 0, 2 * Math.PI)
      ctx.strokeStyle = color + 'cc'
      ctx.lineWidth = 1.5
      ctx.stroke()
    }

    ctx.beginPath()
    ctx.arc(node.x, node.y, size, 0, 2 * Math.PI)
    ctx.fillStyle = isHub ? color : color + '70'
    ctx.fill()

    const showHub   = isHub && globalScale > 0.35
    const showChunk = !isHub && (isHov || globalScale > 2.2)

    if ((showHub || showChunk) && node.name) {
      const fs  = isHub
        ? Math.max(9, Math.min(14, 12 / globalScale))
        : Math.max(7, 9 / globalScale)
      ctx.font  = `${isHub ? '500' : '400'} ${fs}px system-ui`
      const raw = isHub
        ? node.name.slice(0, 32)
        : node.name.split(' ').slice(0, 6).join(' ') + '…'
      const tw  = ctx.measureText(raw).width
      const tx  = node.x
      const ty  = node.y + size + 4
      ctx.fillStyle = 'rgba(6,6,12,0.85)'
      ctx.fillRect(tx - tw / 2 - 4, ty, tw + 8, fs + 5)
      ctx.fillStyle = isHub ? 'rgba(255,255,255,0.95)' : 'rgba(200,200,220,0.7)'
      ctx.textAlign = 'center'
      ctx.fillText(raw, tx, ty + fs + 1)
    }
  }, [hoveredId])

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const s = link.source as any
    const t = link.target as any
    if (s?.x == null || s?.y == null || t?.x == null || t?.y == null) return

    ctx.beginPath()
    ctx.moveTo(s.x, s.y)
    ctx.lineTo(t.x, t.y)

    if (link.type === 'parent') {
      ctx.strokeStyle = (s.color || t.color || '#6366f1') + '28'
      ctx.lineWidth   = 0.6
      ctx.setLineDash([])
    } else if (link.type === 'similarity') {
      const g = ctx.createLinearGradient(s.x, s.y, t.x, t.y)
      g.addColorStop(0, (s.color || '#6366f1') + 'aa')
      g.addColorStop(1, (t.color || '#6366f1') + 'aa')
      ctx.strokeStyle = g
      ctx.lineWidth   = Math.max(1.2, (link.weight || 0.5) * 3.5)
      ctx.setLineDash([])
    } else {
      ctx.strokeStyle = 'rgba(255,255,255,0.18)'
      ctx.lineWidth   = 0.8
      ctx.setLineDash([3, 5])
    }
    ctx.stroke()
    ctx.setLineDash([])
  }, [])

  const paintBg = useCallback((ctx: CanvasRenderingContext2D) => {
    if (!starsRef.current.length) {
      starsRef.current = Array.from({ length: 180 }, () => ({
        x: (Math.random() - 0.5) * 5000,
        y: (Math.random() - 0.5) * 5000,
        r: Math.random() * 0.9 + 0.15,
        a: Math.random() * 0.35 + 0.05,
      }))
    }
    starsRef.current.forEach((s: any) => {
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, 2 * Math.PI)
      ctx.fillStyle = `rgba(255,255,255,${s.a})`
      ctx.fill()
    })
  }, [])

  const handleNodeHover = useCallback((node: any) => {
    setHoveredId(node ? String(node.id) : null)
    if (node) {
      setTooltip({
        name:        node.name,
        type:        node.type,
        preview:     node.preview || node.excerpt || '',
        doc_title:   node.doc_title || '',
        document_id: node.document_id,
      })
    } else {
      setTooltip(null)
    }
    document.body.style.cursor = node ? 'pointer' : 'default'
  }, [])

  const handleNodeClick = useCallback((node: any) => {
    setSelected(node)
  }, [])

  const rebuild = async () => {
    setBuilding(true)
    try {
      await authFetch('/concepts/build-edges-from-chunks', { method: 'POST' })
      await load()
    } finally {
      setBuilding(false)
    }
  }

  if (dims.w === 0) return null

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: '#060610', overflow: 'hidden' }}
      onMouseMove={e => setMousePos({ x: e.clientX, y: e.clientY })}
    >
      {/* Graph */}
      {!loading && (
        <ForceGraph2D
          ref={fgRef}
          width={dims.w}
          height={dims.h}
          graphData={graphData}
          backgroundColor="#060610"
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          linkCanvasObject={paintLink}
          linkCanvasObjectMode={() => 'replace'}
          onRenderFramePre={paintBg}
          onNodeHover={handleNodeHover}
          onNodeClick={handleNodeClick}
          onEngineStop={handleEngineStop}
          d3AlphaDecay={0.012}
          d3VelocityDecay={0.28}
          cooldownTicks={400}
          warmupTicks={80}
          enableNodeDrag={true}
          enableZoomInteraction={true}
        />
      )}

      {/* Loading overlay */}
      {loading && (
        <div style={{ position: 'fixed', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 16 }}>
          <div style={{ width: 32, height: 32, border: '2px solid #1a1a2e', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
          <p style={{ color: '#555', fontSize: 14, fontFamily: 'system-ui' }}>Building your knowledge galaxy...</p>
          <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        </div>
      )}

      {/* Controls — top left */}
      <div style={{
        position: 'fixed', top: 20, left: 20, zIndex: 100,
        background: 'rgba(6,6,16,0.88)', backdropFilter: 'blur(14px)',
        border: '1px solid rgba(255,255,255,0.07)',
        borderRadius: 14, padding: '14px 18px', minWidth: 210,
        fontFamily: 'system-ui',
      }}>
        <Link href="/" style={{ fontSize: 12, color: '#555', textDecoration: 'none', display: 'block', marginBottom: 10 }}>← Home</Link>
        <p style={{ color: '#f0f0f0', fontSize: 16, fontWeight: 600, margin: '0 0 4px', letterSpacing: '-0.3px' }}>Knowledge Graph</p>
        <p style={{ color: '#444', fontSize: 12, margin: '0 0 12px' }}>
          {stats.documents || 0} docs · {stats.chunks || 0} chunks · {stats.doc_connections || 0} connections
        </p>
        <button
          onClick={rebuild}
          disabled={building}
          style={{
            width: '100%', padding: '8px 14px',
            background: building ? '#1a1a2e' : '#6366f1',
            border: 'none', borderRadius: 8,
            color: 'white', fontSize: 13, fontWeight: 500,
            cursor: building ? 'not-allowed' : 'pointer',
            fontFamily: 'inherit', opacity: building ? 0.6 : 1,
          }}
        >
          {building ? 'Rebuilding…' : 'Rebuild Connections'}
        </button>

        {/* Legend */}
        <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 5 }}>
          {[
            { dot: true,  dotSize: 10, color: '#6366f1', glow: true,  label: 'Document hub' },
            { dot: true,  dotSize: 6,  color: '#6366f155', glow: false, label: 'Chunk satellite' },
          ].map(({ dotSize, color, glow, label }) => (
            <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <div style={{ width: dotSize, height: dotSize, borderRadius: '50%', background: color, flexShrink: 0, ...(glow ? { boxShadow: `0 0 6px ${color}88` } : {}) }} />
              <span style={{ fontSize: 11, color: '#555' }}>{label}</span>
            </div>
          ))}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 16, height: 1.5, background: 'linear-gradient(90deg, #6366f1, #22d3ee)', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#555' }}>Doc connection</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{ width: 16, height: 0, borderTop: '1px dashed rgba(255,255,255,0.3)', flexShrink: 0 }} />
            <span style={{ fontSize: 11, color: '#555' }}>Cross-chunk link</span>
          </div>
        </div>
      </div>

      {/* Hover tooltip */}
      {tooltip && (
        <div style={{
          position: 'fixed',
          left: mousePos.x + 16,
          top: mousePos.y - 10,
          zIndex: 200,
          background: 'rgba(6,6,16,0.95)',
          backdropFilter: 'blur(12px)',
          border: '1px solid rgba(255,255,255,0.1)',
          borderRadius: 10, padding: '10px 14px',
          maxWidth: 260, pointerEvents: 'none',
          fontFamily: 'system-ui',
        }}>
          <p style={{ fontSize: 12, fontWeight: 600, color: '#e0e0f0', margin: '0 0 4px' }}>
            {tooltip.type === 'document' ? tooltip.name : tooltip.doc_title}
          </p>
          {tooltip.type === 'chunk' && (
            <p style={{ fontSize: 11, color: '#888', margin: '0 0 4px' }}>chunk content:</p>
          )}
          <p style={{ fontSize: 11, color: '#666', margin: 0, lineHeight: 1.5 }}>
            {(tooltip.preview || tooltip.name || '').slice(0, 120)}…
          </p>
        </div>
      )}

      {/* Side panel */}
      <div style={{
        position: 'fixed', top: 0, right: 0,
        height: '100vh', width: 300,
        background: 'rgba(6,6,16,0.96)',
        backdropFilter: 'blur(18px)',
        borderLeft: '1px solid rgba(255,255,255,0.07)',
        padding: '28px 22px',
        overflowY: 'auto',
        fontFamily: 'system-ui',
        transform: selected ? 'translateX(0)' : 'translateX(100%)',
        transition: 'transform 0.22s ease',
        zIndex: 150,
      }}>
        {selected && (
          <>
            <button
              onClick={() => setSelected(null)}
              style={{ position: 'absolute', top: 18, right: 18, background: 'none', border: 'none', color: '#555', fontSize: 20, cursor: 'pointer', lineHeight: 1 }}
            >×</button>

            <div style={{ width: 10, height: 10, borderRadius: '50%', background: selected.color || '#6366f1', boxShadow: `0 0 10px ${selected.color || '#6366f1'}88`, marginBottom: 12 }} />

            <p style={{ fontSize: 15, fontWeight: 600, color: '#e0e0f0', margin: '0 0 6px', lineHeight: 1.3 }}>
              {selected.type === 'document' ? selected.name : selected.doc_title}
            </p>

            {selected.type === 'document' && (
              <>
                <p style={{ fontSize: 11, color: '#444', margin: '0 0 12px' }}>
                  {selected.domain} · {selected.chunk_count} chunks
                </p>
                {selected.excerpt && (
                  <p style={{ fontSize: 13, color: '#666', lineHeight: 1.6, margin: '0 0 16px' }}>
                    {selected.excerpt}
                  </p>
                )}
                <Link
                  href={`/document/${selected.document_id}`}
                  style={{ display: 'block', padding: '8px 14px', background: '#6366f1', borderRadius: 8, color: 'white', fontSize: 13, textAlign: 'center', textDecoration: 'none' }}
                >
                  Open document →
                </Link>
              </>
            )}

            {selected.type === 'chunk' && (
              <>
                <p style={{ fontSize: 11, color: '#444', margin: '0 0 10px' }}>chunk {selected.chunk_index + 1}</p>
                <p style={{ fontSize: 13, color: '#888', lineHeight: 1.7, margin: '0 0 16px' }}>
                  {selected.preview}
                </p>
                <Link
                  href={`/document/${selected.document_id}`}
                  style={{ display: 'block', padding: '8px 14px', background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)', borderRadius: 8, color: '#818cf8', fontSize: 13, textAlign: 'center', textDecoration: 'none' }}
                >
                  View in document →
                </Link>
              </>
            )}
          </>
        )}
      </div>
    </div>
  )
}
