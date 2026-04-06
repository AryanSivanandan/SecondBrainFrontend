'use client'

import { useEffect, useRef, useState, useCallback } from 'react'
import * as d3 from 'd3'
import { supabase } from '@/lib/supabase'

interface GraphNode extends d3.SimulationNodeDatum {
  id: number
  name: string
  description: string
  chunk_count: number
  radius: number
}

interface GraphLink extends d3.SimulationLinkDatum<GraphNode> {
  similarity: number
}

const API = process.env.NEXT_PUBLIC_BACKEND_URL || ''

const COLORS = {
  bg: '#0a0a0f',
  surface: '#111118',
  border: '#1e1e2e',
  accent: '#7c6af7',
  text: '#e8e8f0',
  textMuted: '#6b6b8a',
  nodeMin: '#2d2d4a',
  nodeMax: '#7c6af7',
  link: '#2a2a3e',
}

async function getToken(): Promise<string> {
  const { data: { session } } = await supabase.auth.getSession()
  return session?.access_token ?? ''
}

async function apiFetch(path: string) {
  const token = await getToken()
  const res = await fetch(`${API}${path}`, {
    headers: { Authorization: `Bearer ${token}` },
  })
  if (!res.ok) throw new Error(await res.text())
  return res.json()
}

export default function ConceptGraph() {
  const svgRef = useRef<SVGSVGElement>(null)

  const [nodes, setNodes] = useState<GraphNode[]>([])
  const [links, setLinks] = useState<GraphLink[]>([])
  const [loading, setLoading] = useState(true)

  const loadGraph = useCallback(async () => {
    setLoading(true)
    try {
      const data = await apiFetch('/concepts/graph')

      const maxChunks = Math.max(...data.nodes.map((n: any) => n.chunk_count || 1), 1)

      const graphNodes = data.nodes.map((n: any) => ({
        id: n.id,
        name: n.name,
        description: n.description || '',
        chunk_count: n.chunk_count || 1,
        radius: 8 + (n.chunk_count / maxChunks) * 20,
      }))

      const graphLinks = data.edges.map((e: any) => ({
        source: e.source,
        target: e.target,
        similarity: e.weight,
      }))

      setNodes(graphNodes)
      setLinks(graphLinks)
    } catch (e) {
      console.error(e)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    loadGraph()
  }, [loadGraph])

  useEffect(() => {
    if (!svgRef.current || nodes.length === 0) return

    const svg = d3.select(svgRef.current)
    svg.selectAll('*').remove()

    const W = svgRef.current.clientWidth || 900
    const H = svgRef.current.clientHeight || 600

    const g = svg.append('g')

    svg.call(
      d3.zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.3, 3])
        .on('zoom', (e) => g.attr('transform', e.transform))
    )

    const sim = d3.forceSimulation(nodes)
      .force('link', d3.forceLink(links)
        .id((d: any) => d.id)
        .distance((d: any) => 80 + (1 - d.similarity) * 120)
        .strength(0.2)
      )
      .force('charge', d3.forceManyBody().strength(-70))
      .force('center', d3.forceCenter(W / 2, H / 2))
      .force('collision', d3.forceCollide().radius((d: any) => d.radius + 6))

    const link = g.append('g')
      .selectAll('line')
      .data(links)
      .join('line')
      .attr('stroke', COLORS.link)
      .attr('stroke-width', (d: any) => 1 + d.similarity * 2)
      .attr('stroke-opacity', 0.4)

    const node = g.append('g')
      .selectAll('g')
      .data(nodes)
      .join('g')
      .call(
        d3.drag<any, GraphNode>()
          .on('start', (e, d) => {
            if (!e.active) sim.alphaTarget(0.1).restart()
            d.fx = d.x
            d.fy = d.y
          })
          .on('drag', (e, d) => {
            d.fx = e.x
            d.fy = e.y
          })
          .on('end', (e, d) => {
            if (!e.active) sim.alphaTarget(0)
            d.fx = null
            d.fy = null
          })
      )

    node.append('circle')
      .attr('r', d => d.radius)
      .attr('fill', d => {
        const t = Math.min(d.chunk_count / 20, 1)
        return d3.interpolateRgb(COLORS.nodeMin, COLORS.nodeMax)(t)
      })

    node.append('text')
      .text(d => d.name.length > 18 ? d.name.slice(0, 16) + '…' : d.name)
      .attr('text-anchor', 'middle')
      .attr('dy', d => d.radius + 14)
      .attr('fill', COLORS.textMuted)
      .attr('font-size', 11)

    sim.on('tick', () => {
      link
        .attr('x1', d => (d.source as any).x)
        .attr('y1', d => (d.source as any).y)
        .attr('x2', d => (d.target as any).x)
        .attr('y2', d => (d.target as any).y)

      node.attr('transform', d => `translate(${d.x},${d.y})`)
    })

    return () => { sim.stop() }

  }, [nodes, links])

  return (
    <div style={{
      width: '100%',
      height: '100vh',
      background: COLORS.bg,
      color: COLORS.text,
    }}>
      {loading && (
        <div style={{
          position: 'absolute',
          inset: 0,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: COLORS.textMuted,
        }}>
          Loading graph...
        </div>
      )}

      <svg ref={svgRef} style={{ width: '100%', height: '100%' }} />
    </div>
  )
}