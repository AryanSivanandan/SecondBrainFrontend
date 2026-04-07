"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

// ── Types ──────────────────────────────────────────────────── //
type Result = { chunk: string; document_id: number; chunk_id?: number; score: number; document_title?: string; document_url?: string; captured_at?: string; source_type?: string; };
type Doc    = { id: number; title: string; url: string; excerpt: string; captured_at: string; word_count: number; user_note?: string; };
type Reminder      = { document_id: number; title: string; url: string; reason: string; captured_at: string; };
type Recommendation = { topic: string; reason: string; };
type Gap = { topic_a: string; topic_b: string; similarity: number; suggestion: string; };

const BACKEND = "/api";

async function authFetch(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, ...options.headers },
  });
}

function timeAgo(dateStr: string) {
  const d   = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const diff = Date.now() - d.getTime();
  const m    = Math.floor(diff / 60000);
  const h    = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (m  < 1)  return "just now";
  if (m  < 60) return `${m}m ago`;
  if (h  < 24) return `${h}h ago`;
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString("en", { month: "short", day: "numeric" });
}

function hostname(url: string) {
  try { return new URL(url).hostname.replace("www.", ""); } catch { return ""; }
}

/**
 * Trims a stored chunk to the last complete sentence so that
 * mid-word / mid-sentence artifacts from the old chunking pipeline
 * are never shown to the user.
 *
 * - If the chunk already ends with sentence punctuation → return as-is.
 * - Otherwise find the last .  !  ? and cut there.
 * - If no boundary is found (e.g. a single run-on fragment) → return as-is
 *   so we never silently discard all content.
 */
function cleanChunk(text: string): string {
  const t = text.trim();
  if (!t) return t;
  // Already ends cleanly
  if (/[.!?]['"]?$/.test(t)) return t;
  // Find the last sentence-ending punctuation followed by a space or end
  const lastBoundary = Math.max(
    t.lastIndexOf(". "),
    t.lastIndexOf("! "),
    t.lastIndexOf("? "),
    t.lastIndexOf(".\n"),
    t.lastIndexOf("!\n"),
    t.lastIndexOf("?\n"),
  );
  // Only cut if the boundary is past the first 30% of the text
  // (avoids returning a tiny sliver when the only period is near the start)
  if (lastBoundary > t.length * 0.3) {
    return t.slice(0, lastBoundary + 1);
  }
  return t;
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

const IconUpload = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
    <polyline points="17 8 12 3 7 8"/>
    <line x1="12" y1="3" x2="12" y2="15"/>
  </svg>
);

const IconHome = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>
    <polyline points="9 22 9 12 15 12 15 22"/>
  </svg>
);

const IconDigest = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/>
    <line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>
    <line x1="8" y1="14" x2="16" y2="14"/><line x1="8" y1="18" x2="13" y2="18"/>
  </svg>
);

const IconGraph = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/>
    <line x1="8.59" y1="13.51" x2="15.42" y2="17.49"/>
    <line x1="15.41" y1="6.51" x2="8.59" y2="10.49"/>
  </svg>
);

const IconSearch = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <circle cx="11" cy="11" r="8"/>
    <line x1="21" y1="21" x2="16.65" y2="16.65"/>
  </svg>
);

// ── Entry point ────────────────────────────────────────────── //
export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false); });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );

  if (!session) return <LoginPage />;
  return <Dashboard session={session} />;
}

// ── Login ──────────────────────────────────────────────────── //
function LoginPage() {
  return (
    <main style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center", position: "relative", overflow: "hidden" }}>
      {/* Ambient glow */}
      <div style={{ position: "absolute", width: "700px", height: "700px", borderRadius: "50%", background: "radial-gradient(circle, rgba(124,106,247,0.07) 0%, transparent 70%)", top: "50%", left: "50%", transform: "translate(-50%,-50%)", pointerEvents: "none" }} />

      <div className="fade-up" style={{ width: "320px", textAlign: "center", position: "relative" }}>
        {/* Logo mark */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "center", gap: "10px", marginBottom: "36px" }}>
          <div style={{ width: "38px", height: "38px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: "11px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>
            <IconBrain />
          </div>
          <span style={{ fontSize: "16px", fontWeight: 600, color: "var(--text-1)", letterSpacing: "-0.02em" }}>Second Brain</span>
        </div>

        {/* Headline */}
        <h1 style={{ fontSize: "38px", fontWeight: 300, color: "var(--text-1)", margin: "0 0 12px", letterSpacing: "-2px", lineHeight: 1.1 }}>
          Everything you read,<br />
          <span style={{ color: "var(--accent)" }}>remembered.</span>
        </h1>
        <p style={{ fontSize: "14.5px", color: "var(--text-2)", margin: "0 0 40px", lineHeight: 1.65 }}>
          Capture articles. Ask questions.<br />Surface what matters.
        </p>

        {/* Auth buttons */}
        <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
          <button
            onClick={() => supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/auth/callback` } })}
            style={{ padding: "12px 20px", background: "var(--text-1)", color: "#0a0a12", border: "none", borderRadius: "var(--radius-sm)", fontSize: "13.5px", fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", transition: "opacity 140ms ease" }}
            onMouseOver={e => (e.currentTarget.style.opacity = "0.88")}
            onMouseOut={e => (e.currentTarget.style.opacity = "1")}
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
              <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
            </svg>
            Continue with GitHub
          </button>
          <button
            onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } })}
            style={{ padding: "12px 20px", background: "transparent", color: "var(--text-1)", border: "1px solid var(--border-hover)", borderRadius: "var(--radius-sm)", fontSize: "13.5px", fontWeight: 500, display: "flex", alignItems: "center", justifyContent: "center", gap: "9px", transition: "border-color 140ms ease, background 140ms ease" }}
            onMouseOver={e => { e.currentTarget.style.borderColor = "rgba(255,255,255,0.15)"; e.currentTarget.style.background = "rgba(255,255,255,0.03)"; }}
            onMouseOut={e => { e.currentTarget.style.borderColor = "var(--border-hover)"; e.currentTarget.style.background = "transparent"; }}
          >
            <svg width="15" height="15" viewBox="0 0 48 48">
              <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
              <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
              <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
              <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
            </svg>
            Continue with Google
          </button>
        </div>
      </div>
    </main>
  );
}

// ── Dashboard ──────────────────────────────────────────────── //
function Dashboard({ session }: { session: any }) {
  const [query, setQuery]               = useState("");
  const [answer, setAnswer]             = useState("");
  const [results, setResults]           = useState<Result[]>([]);
  const [documents, setDocuments]       = useState<Doc[]>([]);
  const [reminders, setReminders]       = useState<Reminder[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendation[]>([]);
  const [gaps, setGaps]                 = useState<Gap[]>([]);
  const [loading, setLoading]           = useState(false);
  const [streaming, setStreaming]       = useState(false);
  const [feedLoading, setFeedLoading]   = useState(true);
  const [discoverLoading, setDiscoverLoading] = useState(false);
  const [mode, setMode]                 = useState<"feed" | "search">("feed");
  const [tab, setTab]                   = useState<"feed" | "discover">(() => {
    if (typeof window !== "undefined") {
      return (localStorage.getItem("sb_home_tab") as "feed" | "discover") ?? "feed";
    }
    return "feed";
  });
  const [pdfUploading, setPdfUploading] = useState(false);
  const [pdfStatus, setPdfStatus]       = useState<string | null>(null);
  const inputRef    = useRef<HTMLInputElement>(null);
  const pollRef     = useRef<NodeJS.Timeout | null>(null);
  const pdfInputRef = useRef<HTMLInputElement>(null);

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!pdfInputRef.current) return;
    pdfInputRef.current.value = "";           // reset so same file can be re-uploaded
    if (!file) return;

    setPdfUploading(true);
    setPdfStatus(null);

    const { data: { session } } = await supabase.auth.getSession();
    if (!session) { setPdfUploading(false); return; }

    const form = new FormData();
    form.append("file", file);

    try {
      const res  = await fetch(`${BACKEND}/upload/pdf`, {
        method: "POST",
        headers: { Authorization: `Bearer ${session.access_token}` },
        body: form,
      });
      const data = await res.json();
      if (data.status === "stored") {
        setPdfStatus(`✓ "${file.name}" saved (${data.chunks_created} chunks)`);
        loadFeed();
      } else if (data.status === "duplicate") {
        setPdfStatus("Already in your library.");
      } else {
        setPdfStatus(data.detail || "Upload failed.");
      }
    } catch {
      setPdfStatus("Upload failed. Please try again.");
    } finally {
      setPdfUploading(false);
      setTimeout(() => setPdfStatus(null), 4000);
    }
  };

  const loadFeed = useCallback(async () => {
    try {
      const docsRes = await authFetch(`${BACKEND}/documents?limit=20`).then(r => r.json());
      setDocuments(Array.isArray(docsRes) ? docsRes : []);
    } catch (e) { console.error(e); }
    finally { setFeedLoading(false); }
  }, []);

  const loadDiscover = useCallback(async () => {
    setDiscoverLoading(true);
    try {
      const [remsRes, recsRes, gapsRes] = await Promise.all([
        authFetch(`${BACKEND}/reminders`).then(r => r.json()).catch(() => []),
        authFetch(`${BACKEND}/recommendations`).then(r => r.json()).catch(() => []),
        authFetch(`${BACKEND}/topics/gaps`).then(r => r.json()).catch(() => []),
      ]);
      setReminders(Array.isArray(remsRes) ? remsRes : []);
      setRecommendations(Array.isArray(recsRes) ? recsRes : []);
      setGaps(Array.isArray(gapsRes) ? gapsRes : []);
    } catch (e) { console.error(e); }
    finally { setDiscoverLoading(false); }
  }, []);

  useEffect(() => { loadFeed(); }, [loadFeed]);

  // Lazy-load Discover data only when the tab is first visited
  const discoverLoadedRef = useRef(false);
  useEffect(() => {
    if (tab === "discover" && !discoverLoadedRef.current) {
      discoverLoadedRef.current = true;
      loadDiscover();
    }
    localStorage.setItem("sb_home_tab", tab);
  }, [tab, loadDiscover]);

  // Poll every 30 s in feed mode to surface new captures without a page refresh
  useEffect(() => {
    if (mode !== "feed") return;
    pollRef.current = setInterval(() => {
      authFetch(`${BACKEND}/documents?limit=20`).then(r => r.json()).then(docs => {
        if (!Array.isArray(docs)) return;
        setDocuments(prev => (docs.length !== prev.length || docs[0]?.id !== prev[0]?.id) ? docs : prev);
      }).catch(() => {});
    }, 30000);
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [mode]);

  const handleSearch = async (queryOverride?: string) => {
    const q = queryOverride ?? query;
    if (!q.trim()) return;
    setLoading(true);
    setStreaming(false);
    setMode("search");
    setAnswer("");
    setResults([]);

    try {
      const { data: { session } } = await supabase.auth.getSession();
      const response = await fetch(`${BACKEND}/answer/stream`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token ?? ""}`,
        },
        body: JSON.stringify({ query: q }),
      });

      if (!response.ok || !response.body) {
        throw new Error(`${response.status}`);
      }

      setLoading(false);   // spinner off — connection is open
      setStreaming(true);  // skeleton on until first token

      const reader  = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer    = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const parts = buffer.split("\n\n");
        buffer = parts.pop() ?? "";
        for (const part of parts) {
          if (!part.startsWith("data: ")) continue;
          try {
            const ev = JSON.parse(part.slice(6));
            if (ev.type === "sources") {
              setResults(ev.sources || []);
            } else if (ev.type === "token") {
              setStreaming(false);
              setAnswer(prev => prev + ev.token);
            } else if (ev.type === "done") {
              // ev.answer only present when there were no chunks
              if (ev.answer) setAnswer(ev.answer);
            }
          } catch { /* ignore malformed SSE line */ }
        }
      }
    } catch (e) { console.error(e); }
    finally { setLoading(false); setStreaming(false); }
  };

  // Handle ?q= param from Topics "Explore →" links
  useEffect(() => {
    const q = new URLSearchParams(window.location.search).get("q");
    if (q) { setQuery(q); handleSearch(q); }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const clearSearch = () => {
    setQuery(""); setMode("feed"); setAnswer(""); setResults([]);
    inputRef.current?.focus();
  };

  return (
    <div className="app-layout">

      {/* ── Sidebar ─────────────────────────────────── */}
      <aside className="sidebar">
        <div className="sidebar-logo" onClick={clearSearch}>
          <div className="sidebar-logo-icon"><IconBrain /></div>
          <span className="sidebar-logo-text">Second Brain</span>
        </div>

        <nav className="sidebar-nav">
          <div className={`sidebar-item ${mode === "feed" ? "active" : ""}`} onClick={clearSearch}>
            <IconHome /><span>Home</span>
          </div>
          <Link href="/digest" className="sidebar-item">
            <IconDigest /><span>Daily Digest</span>
          </Link>
          <Link href="/topics" className="sidebar-item">
            <IconGraph /><span>Topics</span>
          </Link>
        </nav>

        <div className="sidebar-footer">
          {/* Hidden file input — triggered by the Upload PDF button below */}
          <input
            ref={pdfInputRef}
            type="file"
            accept=".pdf"
            style={{ display: "none" }}
            onChange={handlePdfUpload}
          />
          <button
            className="sidebar-item"
            style={{ width: "100%", border: "none", background: pdfUploading ? "var(--accent-dim)" : undefined }}
            onClick={() => pdfInputRef.current?.click()}
            disabled={pdfUploading}
          >
            {pdfUploading
              ? <><div className="spinner spinner-sm" style={{ flexShrink: 0 }} /><span>Uploading...</span></>
              : <><IconUpload /><span>Upload PDF</span></>}
          </button>
          {pdfStatus && (
            <div style={{ fontSize: "11.5px", color: pdfStatus.startsWith("✓") ? "var(--green)" : "var(--text-2)", padding: "4px 10px", lineHeight: 1.4 }}>
              {pdfStatus}
            </div>
          )}
          <div className="sidebar-user-email">{session?.user?.email}</div>
          <button className="sidebar-signout" onClick={() => supabase.auth.signOut()}>Sign out</button>
        </div>
      </aside>

      {/* ── Mobile header ───────────────────────────── */}
      <div className="mobile-header">
        <div style={{ display: "flex", alignItems: "center", gap: "8px", cursor: "pointer" }} onClick={clearSearch}>
          <div className="sidebar-logo-icon"><IconBrain /></div>
          <span style={{ fontSize: "14px", fontWeight: 600 }}>Second Brain</span>
        </div>
        <button style={{ background: "none", border: "none", color: "var(--text-2)", fontSize: "13px" }} onClick={() => supabase.auth.signOut()}>Sign out</button>
      </div>

      {/* ── Main content ────────────────────────────── */}
      <main className="main-content">
        <div className="content-inner">

          {/* Search bar */}
          <div className="search-wrap">
            <div className="search-icon"><IconSearch /></div>
            <input
              ref={inputRef}
              className="search-input"
              value={query}
              onChange={e => setQuery(e.target.value)}
              onKeyDown={e => e.key === "Enter" && handleSearch()}
              placeholder="Ask your second brain anything..."
            />
            <div className="search-actions">
              {mode === "search" && (
                <button onClick={clearSearch} style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: "22px", lineHeight: 1, padding: "2px 6px", cursor: "pointer" }}>×</button>
              )}
              <button className="btn btn-primary" onClick={() => handleSearch()} disabled={loading} style={{ padding: "7px 16px" }}>
                {loading
                  ? <><div className="spinner spinner-sm spinner-white" />Asking</>
                  : "Ask"}
              </button>
            </div>
          </div>

          {/* ── Search results ──────────────────────── */}
          {mode === "search" && (
            <div className="fade-up">
              {loading && (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-2)", fontSize: "14px", marginBottom: "24px" }}>
                  <div className="spinner" />
                  <span>Searching your knowledge base...</span>
                </div>
              )}

              {/* Answer card — shows skeleton while streaming hasn't started, then streams in */}
              {(streaming || answer) && (
                <div className="card fade-up" style={{ padding: "22px 24px", marginBottom: "24px", background: "linear-gradient(135deg, rgba(124,106,247,0.06) 0%, var(--surface) 100%)", borderColor: "var(--accent-border)" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "14px" }}>
                    <div style={{ width: "22px", height: "22px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: "6px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>
                      <IconBrain />
                    </div>
                    <span style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--accent)", letterSpacing: "0.09em", textTransform: "uppercase" }}>Answer</span>
                  </div>

                  {/* Skeleton bars while waiting for first token */}
                  {streaming && !answer && (
                    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
                      {[85, 72, 55].map((w, i) => (
                        <div key={i} style={{ height: "13px", width: `${w}%`, borderRadius: "6px", background: "var(--surface-2, rgba(255,255,255,0.06))", animation: `skeletonPulse 1.4s ease ${i * 0.15}s infinite` }} />
                      ))}
                    </div>
                  )}

                  {answer && (
                    <div className="md" style={{ fontSize: "15px", lineHeight: 1.8, color: "var(--text-1)" }}>
                      <ReactMarkdown>{answer}</ReactMarkdown>
                    </div>
                  )}
                </div>
              )}

              {results.length > 0 && (
                <div className="fade-up">
                  <div className="section-label">Sources · {results.length}</div>
                  <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                    {results.map((r, i) => (
                      <Link key={i} href={`/document/${r.document_id}`}>
                        <div className="card card-link source-card">
                          <p style={{ fontSize: "13px", color: "#b0b0c0", lineHeight: 1.6, margin: "0 0 10px" }}>
                            {r.chunk.slice(0, 220)}{r.chunk.length > 220 ? "…" : ""}
                          </p>
                          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                            <div style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                              <span style={{ fontSize: "12px", color: "#6366f1", fontWeight: 500 }}>
                                {r.document_title || "Untitled"}
                              </span>
                              <span style={{ fontSize: "11px", color: "#383848" }}>
                                {r.document_url && (() => { try { return new URL(r.document_url).hostname } catch { return "" } })()}
                                {r.document_url && r.captured_at ? " · " : ""}
                                {r.captured_at ? timeAgo(r.captured_at) : ""}
                                {r.source_type === "chat" ? " · from chat" : ""}
                                {r.source_type === "auto_enriched" ? " · enriched" : ""}
                              </span>
                            </div>
                            <span style={{ fontSize: "11px", color: "#2a2a3a" }}>{r.score?.toFixed(2)}</span>
                          </div>
                        </div>
                      </Link>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* ── Tab bar ─────────────────────────────── */}
          {mode === "feed" && (
            <div style={{ display: "flex", gap: "4px", marginBottom: "28px", borderBottom: "1px solid var(--border)", paddingBottom: "0" }}>
              {(["feed", "discover"] as const).map(t => (
                <button
                  key={t}
                  onClick={() => setTab(t)}
                  style={{
                    background: "none", border: "none", padding: "8px 14px",
                    fontSize: "13.5px", fontWeight: 500, cursor: "pointer",
                    color: tab === t ? "var(--text-1)" : "var(--text-3)",
                    borderBottom: tab === t ? "2px solid var(--accent)" : "2px solid transparent",
                    marginBottom: "-1px", transition: "color var(--t), border-color var(--t)",
                  }}
                >
                  {t === "feed" ? "Feed" : "Discover"}
                </button>
              ))}
            </div>
          )}

          {/* ── Feed tab ─────────────────────────────── */}
          {mode === "feed" && tab === "feed" && (
            <div>
              {feedLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-2)", fontSize: "14px" }}>
                  <div className="spinner" /><span>Loading your library...</span>
                </div>
              ) : (
                <div className="section">
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "12px" }}>
                    <div className="section-label" style={{ margin: 0 }}>Library · {documents.length}</div>
                    <button onClick={loadFeed} title="Refresh" style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: "17px", lineHeight: 1, cursor: "pointer", padding: "2px 4px", transition: "color var(--t)" }}
                      onMouseOver={e => e.currentTarget.style.color = "var(--text-2)"}
                      onMouseOut={e => e.currentTarget.style.color = "var(--text-3)"}>↺</button>
                  </div>
                  {documents.length === 0 ? (
                    <div className="empty-state">
                      <p>Nothing captured yet.<br />
                        <span style={{ fontSize: "12px", color: "var(--text-3)" }}>Use Ctrl+Shift+9 in the extension to save a page.</span>
                      </p>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
                      {documents.map(doc => (
                        <Link key={doc.id} href={`/document/${doc.id}`}>
                          <div className="card card-link" style={{ padding: "14px 18px" }}>
                            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: "14px", marginBottom: doc.excerpt ? "6px" : 0 }}>
                              <p style={{ fontSize: "14px", fontWeight: 500, margin: 0, color: "var(--text-1)", lineHeight: 1.4, flex: 1 }}>{doc.title || "Untitled"}</p>
                              <span style={{ fontSize: "11px", color: "var(--text-3)", whiteSpace: "nowrap", flexShrink: 0, paddingTop: "2px" }}>{timeAgo(doc.captured_at)}</span>
                            </div>
                            {doc.excerpt && (
                              <p style={{ fontSize: "13px", color: "var(--text-2)", margin: "0 0 8px", lineHeight: 1.55 }}>
                                {doc.excerpt.slice(0, 200)}{doc.excerpt.length > 200 ? "…" : ""}
                              </p>
                            )}
                            <div style={{ display: "flex", gap: "10px", alignItems: "center" }}>
                              {doc.url && <span style={{ fontSize: "11px", color: "var(--text-3)" }}>{hostname(doc.url)}</span>}
                              {doc.user_note && <span className="badge badge-accent" style={{ fontSize: "10px", padding: "1px 7px" }}>note</span>}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
          )}

          {/* ── Discover tab ─────────────────────────── */}
          {mode === "feed" && tab === "discover" && (
            <div>
              {discoverLoading ? (
                <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-2)", fontSize: "14px" }}>
                  <div className="spinner" /><span>Loading discoveries...</span>
                </div>
              ) : (
                <>
                  {/* Section 1 — Knowledge Gaps */}
                  {gaps.length > 0 && (
                    <div className="section">
                      <div className="section-label">Knowledge Gaps</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                        {gaps.map((g, i) => (
                          <div key={i} className="card" style={{ padding: "16px 18px", borderLeft: "4px solid var(--accent)", background: "var(--surface)" }}>
                            <div style={{ display: "flex", gap: "12px", marginBottom: "10px" }}>
                              <div style={{ flex: 1, padding: "8px 12px", background: "var(--accent-dim)", borderRadius: "var(--radius-sm)", fontSize: "13px", fontWeight: 500, color: "var(--accent)", textAlign: "center" }}>{g.topic_a}</div>
                              <div style={{ display: "flex", alignItems: "center", color: "var(--text-3)", fontSize: "16px" }}>- - -</div>
                              <div style={{ flex: 1, padding: "8px 12px", background: "var(--accent-dim)", borderRadius: "var(--radius-sm)", fontSize: "13px", fontWeight: 500, color: "var(--accent)", textAlign: "center" }}>{g.topic_b}</div>
                            </div>
                            <p style={{ fontSize: "13px", color: "var(--text-2)", margin: 0, lineHeight: 1.55 }}>{g.suggestion}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 2 — Topics to Explore */}
                  {recommendations.length > 0 && (
                    <div className="section">
                      <div className="section-label">Topics to Explore</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                        {recommendations.map((r, i) => (
                          <div key={i} className="card" style={{ padding: "14px 18px", borderLeft: "4px solid #3b82f6", background: "var(--surface)", display: "flex", justifyContent: "space-between", alignItems: "center", gap: "16px" }}>
                            <div style={{ display: "flex", alignItems: "flex-start", gap: "10px", flex: 1 }}>
                              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: "2px" }}><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                              <div>
                                <p style={{ fontSize: "13.5px", fontWeight: 500, margin: "0 0 3px", color: "var(--text-1)" }}>{r.topic}</p>
                                <p style={{ fontSize: "12.5px", color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>{r.reason}</p>
                              </div>
                            </div>
                            <a href={`https://www.google.com/search?q=${encodeURIComponent(r.topic)}`} target="_blank" rel="noopener noreferrer" className="btn btn-ghost" style={{ flexShrink: 0, fontSize: "12px", padding: "5px 12px" }}>
                              Find pages →
                            </a>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Section 3 — Resurface */}
                  {reminders.length > 0 && (
                    <div className="section">
                      <div className="section-label">Resurface</div>
                      <div style={{ display: "flex", flexDirection: "column", gap: "7px" }}>
                        {reminders.map(r => (
                          <Link key={r.document_id} href={`/document/${r.document_id}`}>
                            <div className="card card-hover" style={{ padding: "14px 18px", borderLeft: "4px solid var(--amber)", background: "var(--surface)" }}>
                              <p style={{ fontSize: "13.5px", fontWeight: 500, margin: "0 0 4px", color: "var(--amber)" }}>{r.title}</p>
                              <p style={{ fontSize: "12.5px", color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>{r.reason}</p>
                            </div>
                          </Link>
                        ))}
                      </div>
                    </div>
                  )}

                  {gaps.length === 0 && recommendations.length === 0 && reminders.length === 0 && (
                    <div className="empty-state">
                      <p>Nothing to discover yet.<br />
                        <span style={{ fontSize: "12px", color: "var(--text-3)" }}>Capture more pages and ask questions to surface insights.</span>
                      </p>
                    </div>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
