'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import dynamic from 'next/dynamic'
import Link from 'next/link'
import { supabase } from '@/lib/supabase'

// react-force-graph-2d requires canvas — SSR must be disabled
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

// ─── Types ────────────────────────────────────────────────────────────────────

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

interface ChunkLink {
  source: string
  target: string
  weight: number
}

interface GraphData {
  nodes: ChunkNode[]
  links: ChunkLink[]
}

interface GraphStats {
  total_chunks: number
  visible_nodes: number
  hub_count: number
  edge_count: number
}

// ─── Constants ────────────────────────────────────────────────────────────────

const BACKEND = '/api'

const DOC_COLORS = [
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
  '#60a5fa', // blue
  '#e879f9', // fuchsia
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

// ─── Component ────────────────────────────────────────────────────────────────

export default function TopicsPage() {
  const graphRef = useRef<any>(null)
  const hasZoomed = useRef(false)
  const starsRef = useRef<{ x: number; y: number; r: number; a: number }[]>([])

  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], links: [] })
  const [stats, setStats] = useState<GraphStats | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedChunk, setSelectedChunk] = useState<ChunkNode | null>(null)
  const [building, setBuilding] = useState(false)
  const [buildMsg, setBuildMsg] = useState<string | null>(null)

  // Stars — generated once
  useEffect(() => {
    starsRef.current = Array.from({ length: 300 }, () => ({
      x: (Math.random() - 0.5) * 4000,
      y: (Math.random() - 0.5) * 4000,
      r: Math.random() * 1.2 + 0.3,
      a: Math.random() * 0.6 + 0.2,
    }))
  }, [])

  const loadGraph = useCallback(async () => {
    setLoading(true)
    setError(null)
    hasZoomed.current = false
    try {
      const data = await authFetch('/chunks/graph')

      // Build doc → color map
      const docIds: number[] = Array.from(new Set(
        (data.nodes as any[]).map((n: any) => n.document_id)
      ))
      const docColorMap = new Map<number, string>()
      docIds.forEach((id, i) => {
        docColorMap.set(id, DOC_COLORS[i % DOC_COLORS.length])
      })

      const nodes: ChunkNode[] = (data.nodes as any[]).map((n: any) => ({
        id: String(n.id),
        numId: n.id,
        label: n.label ?? '',
        preview: n.preview ?? '',
        document_id: n.document_id,
        document_title: n.document_title ?? '',
        chunk_index: n.chunk_index ?? 0,
        edge_count: n.edge_count ?? 0,
        tier: n.tier ?? 'isolated',
        size: n.size ?? 4,
        concept_id: n.concept_id ?? null,
        source_type: n.source_type ?? 'capture',
        color: docColorMap.get(n.document_id) ?? '#94a3b8',
      }))

      const links: ChunkLink[] = (data.edges as any[]).map((e: any) => ({
        source: String(e.source),
        target: String(e.target),
        weight: e.weight ?? 0.5,
      }))

      setGraphData({ nodes, links })
      setStats(data.stats ?? null)
    } catch (e: any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => { loadGraph() }, [loadGraph])

  const handleRebuild = async () => {
    setBuilding(true)
    setBuildMsg(null)
    try {
      const result = await authFetch('/concepts/build-edges-from-chunks', { method: 'POST' })
      setBuildMsg(
        `${result.edges_created ?? 0} edges · ${result.chunks_reassigned ?? 0} chunks reassigned`
      )
      await loadGraph()
    } catch (e: any) {
      setBuildMsg(`Error: ${e.message}`)
    } finally {
      setBuilding(false)
    }
  }

  // ── Node painter ──────────────────────────────────────────────────────────

  const paintNode = useCallback((node: any, ctx: CanvasRenderingContext2D, globalScale: number) => {
    const chunk = node as ChunkNode
    const x = node.x as number
    const y = node.y as number

    const tierRadius: Record<string, number> = {
      hub: 9,
      connected: 6,
      satellite: 4,
      isolated: 3,
    }
    const r = tierRadius[chunk.tier] ?? 4

    // Glow for hubs
    if (chunk.tier === 'hub') {
      const grd = ctx.createRadialGradient(x, y, r * 0.5, x, y, r * 2.5)
      grd.addColorStop(0, chunk.color + 'aa')
      grd.addColorStop(1, chunk.color + '00')
      ctx.beginPath()
      ctx.arc(x, y, r * 2.5, 0, Math.PI * 2)
      ctx.fillStyle = grd
      ctx.fill()
    }

    // Node circle
    ctx.beginPath()
    ctx.arc(x, y, r, 0, Math.PI * 2)
    ctx.fillStyle = chunk.color
    ctx.shadowColor = chunk.color
    ctx.shadowBlur = chunk.tier === 'hub' ? 12 : chunk.tier === 'connected' ? 6 : 0
    ctx.fill()
    ctx.shadowBlur = 0

    // Label — only show at sufficient zoom
    if (globalScale > 1.2 && chunk.tier !== 'isolated') {
      const label = chunk.label.length > 30 ? chunk.label.slice(0, 28) + '…' : chunk.label
      const fontSize = Math.max(8, 11 / globalScale)
      ctx.font = `${fontSize}px Inter, sans-serif`
      const tw = ctx.measureText(label).width
      const pad = 3

      ctx.fillStyle = 'rgba(10,10,20,0.75)'
      ctx.fillRect(x + r + 2, y - fontSize / 2 - pad, tw + pad * 2, fontSize + pad * 2)

      ctx.fillStyle = '#e2e8f0'
      ctx.fillText(label, x + r + 2 + pad, y + fontSize / 2 - 1)
    }
  }, [])

  // ── Link painter ──────────────────────────────────────────────────────────

  const paintLink = useCallback((link: any, ctx: CanvasRenderingContext2D) => {
    const w = link.weight as number
    const src = link.source as ChunkNode
    const tgt = link.target as ChunkNode
    if (src.x == null || src.y == null || tgt.x == null || tgt.y == null) return
    const sx = src.x, sy = src.y, tx = tgt.x, ty = tgt.y

    const grd = ctx.createLinearGradient(sx, sy, tx, ty)
    grd.addColorStop(0, src.color + 'cc')
    grd.addColorStop(1, tgt.color + 'cc')

    ctx.beginPath()
    ctx.moveTo(sx, sy)
    ctx.lineTo(tx, ty)
    ctx.strokeStyle = grd

    if (w >= 0.9) {
      ctx.lineWidth = 2.2
      ctx.setLineDash([])
      ctx.globalAlpha = 0.85
    } else if (w >= 0.8) {
      ctx.lineWidth = 1.3
      ctx.setLineDash([])
      ctx.globalAlpha = 0.55
    } else {
      ctx.lineWidth = 1.0
      ctx.setLineDash([3, 5])
      ctx.globalAlpha = 0.35
    }

    ctx.stroke()
    ctx.setLineDash([])
    ctx.globalAlpha = 1
  }, [])

  // ── Star background ───────────────────────────────────────────────────────

  const paintBackground = useCallback((ctx: CanvasRenderingContext2D) => {
    for (const s of starsRef.current) {
      ctx.beginPath()
      ctx.arc(s.x, s.y, s.r, 0, Math.PI * 2)
      ctx.fillStyle = `rgba(255,255,255,${s.a})`
      ctx.fill()
    }
  }, [])

  // ── Zoom to fit once ──────────────────────────────────────────────────────

  const handleEngineStop = useCallback(() => {
    if (!hasZoomed.current && graphRef.current) {
      graphRef.current.zoomToFit(600, 60)
      hasZoomed.current = true
    }
  }, [])

  // ── D3 force config ───────────────────────────────────────────────────────

  const handleGraphReady = useCallback(() => {
    if (!graphRef.current) return
    const fg = graphRef.current

    fg.d3Force('charge', null)

    // Simpler: just use d3's forceManyBody with a moderate value
    // then override per-node in nodeCanvasObject size — the charge above won't work
    // directly as an object. Use proper d3 approach:
    if (typeof window !== 'undefined') {
      import('d3').then((d3) => {
        fg.d3Force('charge', d3.forceManyBody().strength((node: any) => {
          const t = (node as ChunkNode).tier
          if (t === 'hub') return -180
          if (t === 'connected') return -80
          if (t === 'satellite') return -30
          return -15
        }))
        fg.d3Force('link', d3.forceLink().id((n: any) => n.id).distance((link: any) => {
          return 120 - (link.weight ?? 0.5) * 70
        }).strength((link: any) => {
          return (link.weight ?? 0.5) * 0.9
        }))
        fg.d3Force('center', d3.forceCenter(0, 0).strength(0.05))
        fg.d3Force('collision', d3.forceCollide((node: any) => {
          const t = (node as ChunkNode).tier
          return t === 'hub' ? 22 : t === 'connected' ? 14 : 9
        }))
        fg.d3ReheatSimulation()
      })
    }
  }, [])

  // ─── Render ────────────────────────────────────────────────────────────────

  return (
    <div className="fixed inset-0 bg-[#080b14] overflow-hidden">

      {/* Controls panel */}
      <div className="absolute top-4 left-4 z-20 flex flex-col gap-2">
        <Link
          href="/"
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          ← Home
        </Link>

        <div className="bg-slate-900/80 backdrop-blur border border-slate-700/50 rounded-xl px-4 py-3 flex flex-col gap-2 min-w-[200px]">
          <h1 className="text-sm font-semibold text-white tracking-wide">Knowledge Graph</h1>

          {stats && (
            <div className="text-[11px] text-slate-400 space-y-0.5">
              <div>{stats.visible_nodes} chunks · {stats.edge_count} edges</div>
              <div>{stats.hub_count} hubs · {stats.total_chunks} total</div>
            </div>
          )}

          <button
            onClick={handleRebuild}
            disabled={building || loading}
            className="mt-1 text-xs bg-indigo-600 hover:bg-indigo-500 disabled:opacity-40 text-white rounded-lg px-3 py-1.5 transition-colors flex items-center gap-1.5"
          >
            {building ? (
              <>
                <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" />
                Rebuilding…
              </>
            ) : 'Rebuild Connections'}
          </button>

          {buildMsg && (
            <div className="text-[10px] text-slate-400">{buildMsg}</div>
          )}
        </div>
      </div>

      {/* Loading / error overlay */}
      {loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="flex flex-col items-center gap-3">
            <div className="w-8 h-8 border-2 border-indigo-500/40 border-t-indigo-400 rounded-full animate-spin" />
            <span className="text-slate-400 text-sm">Loading graph…</span>
          </div>
        </div>
      )}

      {error && !loading && (
        <div className="absolute inset-0 z-30 flex items-center justify-center">
          <div className="bg-slate-900 border border-red-800/50 rounded-xl p-6 max-w-sm text-center space-y-3">
            <div className="text-red-400 text-sm">{error}</div>
            <button
              onClick={loadGraph}
              className="text-xs bg-slate-700 hover:bg-slate-600 text-white rounded-lg px-4 py-2"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Graph */}
      {!loading && !error && (
        <ForceGraph2D
          ref={graphRef}
          graphData={graphData}
          backgroundColor="#080b14"
          nodeCanvasObject={paintNode}
          nodeCanvasObjectMode={() => 'replace'}
          linkCanvasObject={paintLink}
          linkCanvasObjectMode={() => 'replace'}
          onRenderFramePre={paintBackground}
          onEngineStop={handleEngineStop}
          onNodeClick={(node) => setSelectedChunk(node as ChunkNode)}
          onBackgroundClick={() => setSelectedChunk(null)}
          nodeLabel={() => ''}
          cooldownTicks={200}
          onNodeDragEnd={(node) => {
            // pin on drag
            ;(node as any).fx = node.x
            ;(node as any).fy = node.y
          }}
        />
      )}

      {/* Force config — fires after graph mounts */}
      {!loading && !error && graphData.nodes.length > 0 && (
        <ForceConfigRunner onReady={handleGraphReady} graphRef={graphRef} deps={graphData} />
      )}

      {/* Side panel */}
      <div
        className="absolute top-0 right-0 h-full w-80 z-20 flex flex-col"
        style={{
          transform: selectedChunk ? 'translateX(0)' : 'translateX(100%)',
          transition: 'transform 0.25s cubic-bezier(0.4,0,0.2,1)',
        }}
      >
        <div className="flex-1 bg-slate-900/90 backdrop-blur border-l border-slate-700/50 overflow-y-auto p-5 flex flex-col gap-4">
          {selectedChunk && (
            <>
              <div className="flex items-start justify-between gap-2">
                <h2 className="text-sm font-semibold text-white leading-snug line-clamp-2">
                  {selectedChunk.label}
                </h2>
                <button
                  onClick={() => setSelectedChunk(null)}
                  className="text-slate-500 hover:text-white shrink-0 mt-0.5"
                >
                  ✕
                </button>
              </div>

              {/* Tier badge */}
              <div className="flex items-center gap-2">
                <span
                  className="text-[10px] px-2 py-0.5 rounded-full font-medium uppercase tracking-wider"
                  style={{
                    background: selectedChunk.color + '33',
                    color: selectedChunk.color,
                    border: `1px solid ${selectedChunk.color}55`,
                  }}
                >
                  {selectedChunk.tier}
                </span>
                <span className="text-[11px] text-slate-500">{selectedChunk.edge_count} connections</span>
              </div>

              {/* Preview */}
              <p className="text-[12px] text-slate-300 leading-relaxed">
                {selectedChunk.preview.slice(0, 300)}
                {selectedChunk.preview.length > 300 ? '…' : ''}
              </p>

              {/* Source document */}
              <div className="border-t border-slate-700/50 pt-3">
                <div className="text-[10px] text-slate-500 uppercase tracking-wider mb-1">Source</div>
                <Link
                  href={`/document/${selectedChunk.document_id}`}
                  className="text-[12px] text-indigo-400 hover:text-indigo-300 transition-colors line-clamp-2"
                >
                  {selectedChunk.document_title}
                </Link>
              </div>

              {/* Find similar */}
              <Link
                href={`/?q=${encodeURIComponent(selectedChunk.label)}`}
                className="text-[11px] text-slate-400 hover:text-white transition-colors"
              >
                Find similar →
              </Link>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Force config runner ───────────────────────────────────────────────────────
// Tiny component that fires the force setup after graph mounts + data changes.

function ForceConfigRunner({
  onReady,
  graphRef,
  deps,
}: {
  onReady: () => void
  graphRef: React.RefObject<any>
  deps: any
}) {
  useEffect(() => {
    // Small delay to let react-force-graph wire up its own forces first
    const t = setTimeout(() => {
      if (graphRef.current) onReady()
    }, 50)
    return () => clearTimeout(t)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deps])
  return null
}
