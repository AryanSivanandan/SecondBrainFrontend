'use client'

import { useEffect, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { supabase } from '@/lib/supabase'

// ─── Types ────────────────────────────────────────────────────────────────────

interface DigestResurface {
  id: number
  title: string
  url?: string
  excerpt?: string
  captured_at?: string
}

interface DigestGap {
  query: string
  search_count: number
}

interface DigestConnection {
  concept_a: string
  concept_b: string
  similarity: number
  suggestion: string
}

interface Digest {
  resurface:  DigestResurface | null
  gap:        DigestGap       | null
  connection: DigestConnection | null
}

// ─── Auth helper ──────────────────────────────────────────────────────────────

async function authFetch(path: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession()
  if (!session) throw new Error('Not authenticated')
  const res = await fetch(`/api${path}`, {
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

// ─── Card components ──────────────────────────────────────────────────────────

function DigestCard({
  accent, label, children,
}: {
  accent: string
  label: string
  children: React.ReactNode
}) {
  return (
    <div style={{
      padding: '20px 22px',
      background: '#111118',
      borderRadius: 12,
      borderLeft: `3px solid ${accent}`,
      display: 'flex', flexDirection: 'column', gap: 10,
      transition: 'transform 0.15s',
    }}
      onMouseOver={e => (e.currentTarget.style.transform = 'translateX(3px)')}
      onMouseOut={e  => (e.currentTarget.style.transform = 'translateX(0)')}
    >
      <span style={{
        color: accent, fontSize: 10, fontWeight: 700,
        letterSpacing: '0.1em', textTransform: 'uppercase',
      }}>{label}</span>
      {children}
    </div>
  )
}

function EmptyCard({ accent, label }: { accent: string; label: string }) {
  return (
    <div style={{
      padding: '20px 22px',
      background: 'rgba(255,255,255,0.02)',
      borderRadius: 12,
      borderLeft: `3px solid ${accent}33`,
      opacity: 0.4,
    }}>
      <span style={{ color: accent, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>{label}</span>
      <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: '8px 0 0' }}>Nothing to show yet — keep capturing.</p>
    </div>
  )
}

// ─── Main page ────────────────────────────────────────────────────────────────

export default function DigestPage() {
  const router = useRouter()

  const [digest,       setDigest]       = useState<Digest | null>(null)
  const [loading,      setLoading]      = useState(true)
  const [error,        setError]        = useState<string | null>(null)
  const [sending,      setSending]      = useState(false)
  const [sendStatus,   setSendStatus]   = useState<'idle' | 'sent' | 'nothing' | 'error'>('idle')

  useEffect(() => {
    authFetch('/digest')
      .then(setDigest)
      .catch(e => setError(e.message))
      .finally(() => setLoading(false))
  }, [])

  const handleSendEmail = async () => {
    setSending(true)
    setSendStatus('idle')
    try {
      const res = await authFetch('/digest/send', { method: 'POST' })
      setSendStatus(res.status === 'sent' ? 'sent' : res.status === 'not_configured' ? 'idle' : 'nothing')
    } catch {
      setSendStatus('error')
    } finally {
      setSending(false)
    }
  }

  return (
    <div style={{
      minHeight: '100vh',
      background: '#0a0a0f',
      color: '#e0e0f0',
      fontFamily: 'system-ui, sans-serif',
      padding: '40px 20px',
    }}>
      <style>{`
        @keyframes spin { to { transform: rotate(360deg) } }
        @keyframes fadeUp { from { opacity:0; transform:translateY(12px) } to { opacity:1; transform:translateY(0) } }
      `}</style>

      <div style={{ maxWidth: 560, margin: '0 auto', animation: 'fadeUp 0.4s ease' }}>

        {/* Header */}
        <div style={{ marginBottom: 36 }}>
          <Link href="/" style={{ color: 'rgba(255,255,255,0.25)', fontSize: 12, textDecoration: 'none', display: 'inline-block', marginBottom: 20 }}>
            ← Back
          </Link>
          <p style={{ color: '#6366f1', fontSize: 11, letterSpacing: '0.15em', textTransform: 'uppercase', margin: '0 0 8px' }}>
            Second Brain
          </p>
          <h1 style={{ color: '#f0f0f0', fontSize: 26, fontWeight: 300, margin: '0 0 6px', letterSpacing: '-0.5px' }}>
            Your daily digest
          </h1>
          <p style={{ color: 'rgba(255,255,255,0.3)', fontSize: 13, margin: 0 }}>
            {new Date().toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })}
          </p>
        </div>

        {/* Loading */}
        {loading && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, color: 'rgba(255,255,255,0.3)', fontSize: 14 }}>
            <div style={{ width: 16, height: 16, border: '2px solid rgba(99,102,241,0.3)', borderTopColor: '#6366f1', borderRadius: '50%', animation: 'spin 0.8s linear infinite' }} />
            Loading digest…
          </div>
        )}

        {/* Error */}
        {error && !loading && (
          <div style={{ color: '#f87171', fontSize: 14 }}>{error}</div>
        )}

        {/* Cards */}
        {digest && !loading && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>

            {/* 1. Resurface */}
            {digest.resurface ? (
              <Link href={`/document/${digest.resurface.id}`} style={{ textDecoration: 'none' }}>
                <DigestCard accent="#d4c87a" label="Resurface">
                  <p style={{ color: '#e0e0f0', fontSize: 15, fontWeight: 500, margin: 0, lineHeight: 1.4 }}>
                    {digest.resurface.title}
                  </p>
                  {digest.resurface.excerpt && (
                    <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                      {digest.resurface.excerpt.slice(0, 160)}…
                    </p>
                  )}
                  <span style={{ color: '#6366f1', fontSize: 12 }}>Review this capture →</span>
                </DigestCard>
              </Link>
            ) : (
              <EmptyCard accent="#d4c87a" label="Resurface" />
            )}

            {/* 2. Knowledge Gap */}
            {digest.gap ? (
              <div
                style={{ cursor: 'pointer', textDecoration: 'none' }}
                onClick={() => router.push(`/?q=${encodeURIComponent(digest.gap!.query)}`)}
              >
                <DigestCard accent="#6366f1" label="Knowledge Gap">
                  <p style={{ color: '#e0e0f0', fontSize: 15, fontWeight: 500, margin: 0, lineHeight: 1.4 }}>
                    You've searched "{digest.gap.query}" {digest.gap.search_count} times
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0 }}>
                    You don't have much captured on this yet. Worth saving something?
                  </p>
                  <span style={{ color: '#6366f1', fontSize: 12 }}>Search now →</span>
                </DigestCard>
              </div>
            ) : (
              <EmptyCard accent="#6366f1" label="Knowledge Gap" />
            )}

            {/* 3. Missed Connection */}
            {digest.connection ? (
              <Link href="/topics" style={{ textDecoration: 'none' }}>
                <DigestCard accent="#06ffa5" label="Missed Connection">
                  <p style={{ color: '#e0e0f0', fontSize: 15, fontWeight: 500, margin: 0 }}>
                    {digest.connection.concept_a} ↔ {digest.connection.concept_b}
                  </p>
                  <p style={{ color: 'rgba(255,255,255,0.4)', fontSize: 13, margin: 0, lineHeight: 1.6 }}>
                    {digest.connection.suggestion}
                  </p>
                  <span style={{ color: '#06ffa5', fontSize: 12 }}>Explore in graph →</span>
                </DigestCard>
              </Link>
            ) : (
              <EmptyCard accent="#06ffa5" label="Missed Connection" />
            )}

            {/* Send email button */}
            <div style={{ marginTop: 8, display: 'flex', alignItems: 'center', gap: 14 }}>
              <button
                onClick={handleSendEmail}
                disabled={sending}
                style={{
                  padding: '10px 20px',
                  background: sending ? 'rgba(99,102,241,0.1)' : 'rgba(99,102,241,0.15)',
                  border: '1px solid rgba(99,102,241,0.35)',
                  borderRadius: 9,
                  color: sending ? 'rgba(150,152,255,0.4)' : '#a5b4fc',
                  fontSize: 13, fontWeight: 500,
                  cursor: sending ? 'not-allowed' : 'pointer',
                  display: 'flex', alignItems: 'center', gap: 8,
                  transition: 'all 0.15s',
                }}
              >
                {sending && (
                  <div style={{ width: 12, height: 12, border: '2px solid rgba(165,180,252,0.3)', borderTopColor: '#a5b4fc', borderRadius: '50%', animation: 'spin 0.7s linear infinite' }} />
                )}
                {sending ? 'Sending…' : '✉ Send to email'}
              </button>

              {sendStatus === 'sent'    && <span style={{ color: '#34d399',              fontSize: 12 }}>✓ Sent to your inbox</span>}
              {sendStatus === 'nothing' && <span style={{ color: 'rgba(255,255,255,0.3)', fontSize: 12 }}>Nothing to send today</span>}
              {sendStatus === 'error'   && <span style={{ color: '#f87171',              fontSize: 12 }}>Failed — check Resend config</span>}
              {sendStatus === 'idle'    && <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: 11 }}>Email not configured yet</span>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
