"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";
import ReactMarkdown from "react-markdown";

const BACKEND = "/api";

async function authFetch(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return fetch(url, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${session.access_token}`, ...options.headers },
  });
}

function formatDate(dateStr: string) {
  const d = new Date(dateStr.endsWith("Z") ? dateStr : dateStr + "Z");
  const diff = Date.now() - d.getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 14) return `${days} days ago`;
  return d.toLocaleDateString("en", { month: "long", day: "numeric", year: "numeric" });
}

type Message = { role: "user" | "assistant"; content: string };

// ── Icons ──────────────────────────────────────────────────── //
const IconArrow = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="15 18 9 12 15 6"/>
  </svg>
);

const IconBrain = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M12 5a3 3 0 1 0-5.997.125 4 4 0 0 0-2.526 5.77 4 4 0 0 0 .556 6.588A4 4 0 1 0 12 18Z"/>
    <path d="M12 5a3 3 0 1 1 5.997.125 4 4 0 0 1 2.526 5.77 4 4 0 0 1-.556 6.588A4 4 0 1 1 12 18Z"/>
    <path d="M15 13a4.5 4.5 0 0 1-3-4 4.5 4.5 0 0 1-3 4"/>
  </svg>
);

const IconChat = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
  </svg>
);

const IconTrash = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="3 6 5 6 21 6"/>
    <path d="M19 6l-1 14H6L5 6"/>
    <path d="M10 11v6M14 11v6"/>
    <path d="M9 6V4h6v2"/>
  </svg>
);

const IconExternal = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
    <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/>
    <polyline points="15 3 21 3 21 9"/>
    <line x1="10" y1="14" x2="21" y2="3"/>
  </svg>
);

const IconCopy = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <rect x="9" y="9" width="13" height="13" rx="2" ry="2"/>
    <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>
  </svg>
);

const IconCompress = () => (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
    <polyline points="4 14 10 14 10 20"/><polyline points="20 10 14 10 14 4"/>
    <line x1="10" y1="14" x2="3" y2="21"/><line x1="21" y1="3" x2="14" y2="10"/>
  </svg>
);

// ── Document page ──────────────────────────────────────────── //
export default function DocumentPage() {
  const params = useParams();
  const router = useRouter();
  const id     = params?.id as string;

  const [doc, setDoc]                   = useState<any>(null);
  const [related, setRelated]           = useState<any[]>([]);
  const [summary, setSummary]           = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [note, setNote]                 = useState("");
  const [savingNote, setSavingNote]     = useState(false);
  const [noteSaved, setNoteSaved]       = useState(false);
  const [loading, setLoading]           = useState(true);
  const [showContent, setShowContent]   = useState(false);
  const [fullContent, setFullContent]   = useState<string | null>(null);
  const [contentLoading, setContentLoading] = useState(false);
  const [insights, setInsights]         = useState<any[]>([]);
  const [copied, setCopied]             = useState(false);
  const [chatMode, setChatMode]         = useState(false);
  const [messages, setMessages]         = useState<Message[]>([]);
  const [chatInput, setChatInput]       = useState("");
  const [chatLoading, setChatLoading]   = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [compressed, setCompressed]     = useState<string | null>(null);
  const [compressMeta, setCompressMeta] = useState<{chunk_count: number; source_breakdown: Record<string, number>} | null>(null);
  const [compressLoading, setCompressLoading] = useState(false);
  const [showCompressed, setShowCompressed]   = useState(false);
  const [compressCopied, setCompressCopied]   = useState(false);
  const [savedInsights, setSavedInsights]     = useState<Set<number>>(new Set());
  const [extSuggestions, setExtSuggestions]   = useState<any[]>([]);
  const [suggestionsLoading, setSuggestionsLoading] = useState(false);
  const [suggestionsLoaded, setSuggestionsLoaded]   = useState(false);

  // Load document + related on mount
  useEffect(() => {
    if (!id) return;
    Promise.all([
      authFetch(`${BACKEND}/documents/${id}`).then(r => {
        if (r.status === 404) { router.push("/"); return null; }
        return r.json();
      }),
      authFetch(`${BACKEND}/documents/${id}/related`).then(r => r.json()).catch(() => []),
      authFetch(`${BACKEND}/documents/${id}/insights`).then(r => r.json()).catch(() => []),
    ]).then(([docData, relatedData, insightsData]) => {
      if (!docData) return;
      setDoc(docData);
      setNote(docData.user_note || "");
      setRelated(Array.isArray(relatedData) ? relatedData : []);
      setInsights(Array.isArray(insightsData) ? insightsData : []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  // Auto-scroll chat to newest message
  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  // Generate AI summary once the document is loaded
  const loadSummary = async () => {
    if (summary) return;
    setSummaryLoading(true);
    try {
      const res  = await authFetch(`${BACKEND}/documents/${id}/summarise`, { method: "POST" });
      const data = await res.json();
      setSummary(data.summary || "");
    } catch { setSummary("Could not generate summary."); }
    finally { setSummaryLoading(false); }
  };
  useEffect(() => { if (doc) loadSummary(); }, [doc]);

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await authFetch(`${BACKEND}/documents/${id}/note`, { method: "POST", body: JSON.stringify({ note }) });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } finally { setSavingNote(false); }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: Message    = { role: "user", content: chatInput };
    const newMessages         = [...messages, userMsg];
    setMessages(newMessages);
    setChatInput("");
    setChatLoading(true);
    try {
      const res  = await authFetch(`${BACKEND}/chat`, { method: "POST", body: JSON.stringify({ messages: newMessages, document_id: parseInt(id) }) });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally { setChatLoading(false); }
  };

  const saveInsight = async (msgIndex: number, text: string) => {
    try {
      const res = await authFetch(`${BACKEND}/insights/save`, {
        method: "POST",
        body: JSON.stringify({ text, document_id: parseInt(id) }),
      });
      await res.json();
      setSavedInsights(prev => new Set(prev).add(msgIndex));
    } catch {
      // silently fail — user can retry
    }
  };

  const handleCompress = async () => {
    if (compressed) { setShowCompressed(true); return; }
    setCompressLoading(true);
    setShowCompressed(true);
    try {
      const res  = await authFetch(`${BACKEND}/documents/${id}/export`, { method: "POST" });
      const data = await res.json();
      setCompressed(data.briefing || "");
      setCompressMeta({ chunk_count: data.chunk_count, source_breakdown: data.source_breakdown || {} });
      navigator.clipboard.writeText(data.briefing || "").catch(() => {});
      setCompressCopied(true);
      setTimeout(() => setCompressCopied(false), 2000);
    } catch {
      setCompressed("Failed to compress. Check your Groq API key.");
    } finally {
      setCompressLoading(false);
    }
  };

  const handleShowContent = async () => {
    setShowContent(true);
    if (fullContent) return;
    setContentLoading(true);
    try {
      const res = await authFetch(`${BACKEND}/documents/${id}/full`);
      const data = await res.json();
      setFullContent(data.content);
    } finally {
      setContentLoading(false);
    }
  };

  const loadSuggestions = async () => {
    setSuggestionsLoading(true);
    try {
      const res = await authFetch(`${BACKEND}/documents/${id}/external-suggestions`);
      const data = await res.json();
      setExtSuggestions(Array.isArray(data) ? data : []);
      setSuggestionsLoaded(true);
    } catch (e) {
      console.error(e);
    } finally {
      setSuggestionsLoading(false);
    }
  };

  const captureUrl = async (url: string, index: number) => {
    setExtSuggestions(prev => prev.map((s, i) => i === index ? { ...s, capturing: true } : s));
    try {
      await authFetch(`${BACKEND}/capture-url`, {
        method: "POST",
        body: JSON.stringify({ url }),
      });
      setExtSuggestions(prev => prev.map((s, i) => i === index ? { ...s, capturing: false, captured: true } : s));
    } catch {
      setExtSuggestions(prev => prev.map((s, i) => i === index ? { ...s, capturing: false } : s));
    }
  };

  // ── Loading / not found states ──────────────────────────── //
  if (loading) return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div className="spinner" />
    </div>
  );
  if (!doc) return null;

  const srcHost = (() => { try { return new URL(doc.url).hostname.replace("www.", ""); } catch { return doc.url; } })();

  return (
    <div style={{ minHeight: "100vh", background: "var(--bg)", color: "var(--text-1)" }}>

      {/* ── Sticky top nav ──────────────────────────── */}
      <nav style={{
        position: "sticky", top: 0, zIndex: 20,
        height: "52px",
        background: "rgba(7,7,14,0.88)",
        backdropFilter: "blur(14px)",
        WebkitBackdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--border)",
        padding: "0 28px",
        display: "flex", alignItems: "center", justifyContent: "space-between",
      }}>
        {/* Back link */}
        <Link href="/">
          <div
            style={{ display: "flex", alignItems: "center", gap: "5px", color: "var(--text-2)", fontSize: "13px", transition: "color var(--t)", cursor: "pointer" }}
            onMouseOver={e => e.currentTarget.style.color = "var(--text-1)"}
            onMouseOut={e => e.currentTarget.style.color = "var(--text-2)"}
          >
            <IconArrow /><span>Back</span>
          </div>
        </Link>

        {/* Actions */}
        <div style={{ display: "flex", gap: "8px" }}>
          <button
            className="btn btn-ghost"
            onClick={() => setChatMode(!chatMode)}
            style={{
              padding: "6px 12px", fontSize: "12.5px", gap: "6px",
              background: chatMode ? "var(--accent-dim)" : undefined,
              borderColor: chatMode ? "var(--accent-border)" : undefined,
              color: chatMode ? "var(--accent)" : undefined,
            }}
          >
            <IconChat />Chat
          </button>
          <button
            className="btn btn-danger"
            onClick={async () => {
              if (!confirm("Delete this capture? This cannot be undone.")) return;
              await authFetch(`${BACKEND}/documents/${id}`, { method: "DELETE" });
              router.push("/");
            }}
            style={{ padding: "6px 12px", fontSize: "12.5px", gap: "6px" }}
          >
            <IconTrash />Delete
          </button>
        </div>
      </nav>

      {/* ── Page content ────────────────────────────── */}
      <style>{`
        @keyframes pulse { 0%,100%{opacity:0.3} 50%{opacity:0.7} }
        @media (min-width: 1024px) { .doc-layout { grid-template-columns: 260px 1fr 280px !important; } }
      `}</style>
      <div
        className="doc-layout"
        style={{ display: "grid", gridTemplateColumns: "1fr", gap: 24, maxWidth: 1300, margin: "0 auto", padding: "32px 20px 96px" }}
      >

        {/* ── LEFT COLUMN — Chat Insights ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          {insights.length > 0 ? (
            <div style={{ background: "#0d0d14", border: "1px solid #1a1a2e", borderRadius: 12, padding: "18px 20px" }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 14 }}>
                <span style={{ fontSize: 16 }}>💡</span>
                <h3 style={{ fontSize: 14, fontWeight: 600, color: "#e0e0f0", margin: 0 }}>Chat Insights</h3>
                <span style={{ marginLeft: "auto", fontSize: 11, color: "#444", background: "#1a1a2e", padding: "2px 8px", borderRadius: 10 }}>
                  {insights.length}
                </span>
              </div>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {insights.map(insight => (
                  <div key={insight.id} style={{
                    padding: "12px 14px",
                    background: insight.source_type === "insight" ? "rgba(99,102,241,0.06)" : "rgba(6,255,165,0.04)",
                    border: `1px solid ${insight.source_type === "insight" ? "rgba(99,102,241,0.15)" : "rgba(6,255,165,0.1)"}`,
                    borderRadius: 8,
                  }}>
                    <p style={{ fontSize: 13, color: "#888", lineHeight: 1.65, margin: "0 0 6px" }}>{insight.content}</p>
                    <span style={{ fontSize: 11, color: insight.source_type === "insight" ? "#6366f1" : "#06ffa5" }}>
                      {insight.source_type === "insight" ? "✦ saved insight" : "◈ from chat"}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <div style={{ background: "#0d0d14", border: "1px solid #1a1a2e", borderRadius: 12, padding: "18px 20px" }}>
              <p style={{ fontSize: 11, color: "#333", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 10px" }}>Chat Insights</p>
              <p style={{ fontSize: 12, color: "#2a2a3a", margin: 0, lineHeight: 1.6 }}>
                Chat about this document to generate insights that will appear here.
              </p>
            </div>
          )}
        </div>

        {/* ── CENTER COLUMN — Main content ── */}
        <div>

        {/* Document header */}
        <div style={{ marginBottom: "36px" }} className="fade-up">
          <h1 style={{ fontSize: "27px", fontWeight: 500, color: "var(--text-1)", margin: "0 0 16px", lineHeight: 1.3, letterSpacing: "-0.4px" }}>
            {doc.title || "Untitled"}
          </h1>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px", alignItems: "center" }}>
            {doc.url && (
              <a href={doc.url} target="_blank" rel="noopener noreferrer"
                style={{ display: "flex", alignItems: "center", gap: "4px", fontSize: "12.5px", color: "var(--accent)", transition: "opacity var(--t)" }}
                onMouseOver={e => e.currentTarget.style.opacity = "0.75"}
                onMouseOut={e => e.currentTarget.style.opacity = "1"}>
                {srcHost}<IconExternal />
              </a>
            )}
            {doc.byline && <span style={{ fontSize: "12.5px", color: "var(--text-2)" }}>{doc.byline}</span>}
            <span style={{ fontSize: "12.5px", color: "var(--text-3)" }}>{formatDate(doc.captured_at)}</span>
            {doc.word_count && <span style={{ fontSize: "12.5px", color: "var(--text-3)" }}>{doc.word_count.toLocaleString()} words</span>}
          </div>
        </div>

        {/* AI Summary card */}
        <div className="card fade-up" style={{ padding: "20px 24px", marginBottom: "20px", background: "linear-gradient(135deg, rgba(124,106,247,0.05) 0%, var(--surface) 60%)", borderColor: "var(--accent-border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "13px" }}>
            <div style={{ width: "22px", height: "22px", background: "var(--accent-dim)", border: "1px solid var(--accent-border)", borderRadius: "7px", display: "flex", alignItems: "center", justifyContent: "center", color: "var(--accent)" }}>
              <IconBrain />
            </div>
            <span style={{ fontSize: "10.5px", fontWeight: 700, color: "var(--accent)", letterSpacing: "0.09em", textTransform: "uppercase" }}>AI Summary</span>
          </div>
          {summaryLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "9px", color: "var(--text-2)", fontSize: "13.5px" }}>
              <div className="spinner spinner-sm" /><span>Summarising...</span>
            </div>
          ) : (
            <div className="md" style={{ fontSize: "14.5px", color: "var(--text-2)", lineHeight: 1.8 }}>
              <ReactMarkdown>{summary}</ReactMarkdown>
            </div>
          )}
          {!summaryLoading && summary && !chatMode && (
            <button
              onClick={() => setChatMode(true)}
              style={{
                marginTop: "14px", display: "inline-flex", alignItems: "center", gap: "6px",
                background: "none", border: "none", padding: "0", cursor: "pointer",
                color: "var(--accent)", fontSize: "13px", fontWeight: 500,
              }}
            >
              <IconChat />Continue in chat →
            </button>
          )}
        </div>

        {/* Chat panel */}
        {chatMode && (
          <div className="card fade-up" style={{ marginBottom: "20px", overflow: "hidden" }}>
            <div style={{ padding: "12px 18px", borderBottom: "1px solid var(--border)", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <div style={{ display: "flex", alignItems: "center", gap: "7px" }}>
                <IconChat />
                <span style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--accent)" }}>Chat about this capture</span>
              </div>
              <button onClick={() => setChatMode(false)} style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: "22px", lineHeight: 1, cursor: "pointer", padding: "0 2px" }}>×</button>
            </div>

            {/* Messages */}
            <div style={{ minHeight: "100px", maxHeight: "400px", overflowY: "auto", padding: "18px", display: "flex", flexDirection: "column", gap: "10px" }}>
              {messages.length === 0 && (
                <p style={{ fontSize: "13px", color: "var(--text-3)", margin: 0, textAlign: "center", padding: "20px 0" }}>Ask anything about this capture...</p>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={{ display: "flex", flexDirection: "column", gap: "4px" }}>
                  <div className={msg.role === "user" ? "chat-bubble-user" : "chat-bubble-ai"}>
                    {msg.role === "assistant"
                      ? <div className="md"><ReactMarkdown>{msg.content}</ReactMarkdown></div>
                      : msg.content}
                  </div>
                  {msg.role === "assistant" && (
                    <button
                      onClick={() => saveInsight(i, msg.content)}
                      disabled={savedInsights.has(i)}
                      style={{
                        alignSelf: "flex-start",
                        background: "none",
                        border: "none",
                        padding: "2px 4px",
                        fontSize: "11px",
                        color: savedInsights.has(i) ? "var(--text-3)" : "var(--accent)",
                        cursor: savedInsights.has(i) ? "default" : "pointer",
                        opacity: savedInsights.has(i) ? 0.7 : 1,
                      }}
                    >
                      {savedInsights.has(i) ? "Saved to your brain ✓" : "Save insight →"}
                    </button>
                  )}
                </div>
              ))}
              {chatLoading && (
                <div className="chat-bubble-ai" style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <div className="spinner spinner-sm" /><span style={{ color: "var(--text-2)", fontSize: "13px" }}>Thinking...</span>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Chat input */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid var(--border)", display: "flex", gap: "8px" }}>
              <input
                className="input"
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
                placeholder="Ask something..."
                style={{ flex: 1, padding: "8px 12px" }}
              />
              <button className="btn btn-primary" onClick={sendChat} disabled={chatLoading} style={{ padding: "8px 16px" }}>
                {chatLoading ? <div className="spinner spinner-sm spinner-white" /> : "Send"}
              </button>
            </div>
          </div>
        )}

        {/* Full content toggle */}
        <div style={{ marginBottom: "28px" }}>
          <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
            <button
              className="btn btn-ghost"
              onClick={() => showContent ? setShowContent(false) : handleShowContent()}
              style={{ padding: "6px 14px", fontSize: "12.5px" }}
            >
              {showContent ? "↑ Hide content" : "↓ Show full content"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={() => {
                navigator.clipboard.writeText(window.location.href);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              }}
              style={{ padding: "6px 12px", fontSize: "12.5px", gap: "5px", color: copied ? "var(--green)" : undefined }}
            >
              <IconCopy />{copied ? "Copied!" : "Copy URL"}
            </button>
            <button
              className="btn btn-ghost"
              onClick={handleCompress}
              disabled={compressLoading}
              style={{ padding: "6px 12px", fontSize: "12.5px", gap: "5px", color: compressLoading ? "var(--text-3)" : "var(--accent)" }}
            >
              {compressLoading
                ? <><div className="spinner spinner-sm" style={{ width: 10, height: 10 }} />Compressing…</>
                : <><IconCompress />Compress</>}
            </button>
          </div>

          {/* Compress overlay */}
          {showCompressed && (
            <div
              style={{
                position: "fixed", inset: 0, zIndex: 50,
                background: "rgba(0,0,0,0.6)",
                display: "flex", alignItems: "center", justifyContent: "center",
                padding: "20px",
              }}
              onClick={() => setShowCompressed(false)}
            >
              <div
                style={{
                  background: "rgba(10,10,15,0.97)",
                  backdropFilter: "blur(20px)",
                  border: "1px solid rgba(255,255,255,0.1)",
                  borderRadius: "16px",
                  width: "100%", maxWidth: "560px",
                  padding: "24px",
                  display: "flex", flexDirection: "column", gap: "14px",
                }}
                onClick={e => e.stopPropagation()}
              >
                {/* Header */}
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                    <IconCompress />
                    <span style={{ fontSize: "11px", fontWeight: 700, color: "var(--accent)", letterSpacing: "0.1em", textTransform: "uppercase" }}>
                      Compressed Context
                    </span>
                  </div>
                  <button
                    onClick={() => setShowCompressed(false)}
                    style={{ background: "none", border: "none", color: "var(--text-3)", fontSize: "22px", lineHeight: 1, cursor: "pointer", padding: "0 2px" }}
                  >×</button>
                </div>

                {/* Content */}
                {compressLoading ? (
                  <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "var(--text-2)", fontSize: "13px", padding: "20px 0" }}>
                    <div className="spinner spinner-sm" />Compressing with AI…
                  </div>
                ) : (
                  <textarea
                    readOnly
                    value={compressed || ""}
                    style={{
                      background: "#0d0d14",
                      border: "1px solid rgba(255,255,255,0.07)",
                      borderRadius: "10px",
                      padding: "16px",
                      color: "rgba(224,224,240,0.85)",
                      fontFamily: '"DM Mono", "Fira Code", monospace',
                      fontSize: "12.5px",
                      lineHeight: 1.75,
                      resize: "none",
                      minHeight: "200px",
                      maxHeight: "340px",
                      width: "100%",
                      outline: "none",
                    }}
                  />
                )}

                {/* Footer */}
                {!compressLoading && compressMeta && (
                  <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                    <span style={{ fontSize: "11px", color: "var(--text-3)" }}>
                      {compressMeta.chunk_count} chunks · {compressMeta.source_breakdown.capture ?? 0} capture
                      {(compressMeta.source_breakdown.chat ?? 0) > 0 ? `, ${compressMeta.source_breakdown.chat} chat` : ""}
                      {(compressMeta.source_breakdown.note ?? 0) > 0 ? `, ${compressMeta.source_breakdown.note} note` : ""}
                    </span>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(compressed || "").catch(() => {});
                        setCompressCopied(true);
                        setTimeout(() => setCompressCopied(false), 2000);
                      }}
                      style={{
                        padding: "6px 14px",
                        background: compressCopied ? "rgba(74,222,128,0.1)" : "rgba(99,102,241,0.12)",
                        border: `1px solid ${compressCopied ? "rgba(74,222,128,0.25)" : "rgba(99,102,241,0.3)"}`,
                        borderRadius: "8px",
                        color: compressCopied ? "var(--green)" : "var(--accent)",
                        fontSize: "12px", fontWeight: 500,
                        cursor: "pointer",
                      }}
                    >
                      {compressCopied ? "✓ Copied" : "Copy"}
                    </button>
                  </div>
                )}
              </div>
            </div>
          )}
          {showContent && (
            <div style={{
              maxHeight: "60vh", overflowY: "auto",
              padding: "20px 24px",
              background: "#0d0d14",
              borderRadius: 10,
              border: "1px solid #1a1a2e",
              lineHeight: 1.8,
              fontSize: 15,
              color: "#c0c0d0",
              marginTop: 12,
            }}>
              {contentLoading ? (
                <p style={{ color: "#444" }}>Loading full content...</p>
              ) : (
                <div className="md"><ReactMarkdown>{fullContent || ""}</ReactMarkdown></div>
              )}
            </div>
          )}
        </div>

        <div className="divider" />

        {/* Your note */}
        <div style={{ marginBottom: "30px" }}>
          <div className="section-label" style={{ marginBottom: "10px" }}>Your note</div>
          <textarea
            className="textarea"
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why did you save this? What's important about it?"
            style={{ minHeight: "90px" }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
            <button
              className="btn btn-primary"
              onClick={saveNote}
              disabled={savingNote}
              style={{
                padding: "7px 18px",
                background: noteSaved ? "rgba(74,222,128,0.12)" : undefined,
                color: noteSaved ? "var(--green)" : undefined,
                border: noteSaved ? "1px solid rgba(74,222,128,0.25)" : undefined,
              }}
            >
              {noteSaved ? "Saved ✓" : savingNote ? "Saving..." : "Save note"}
            </button>
          </div>
        </div>

        </div>{/* end center column */}

        {/* ── RIGHT COLUMN — Related reading ── */}
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ background: "#0d0d14", border: "1px solid #1a1a2e", borderRadius: 12, padding: "16px 18px" }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
              <p style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", margin: 0 }}>
                Related reading
              </p>
              {!suggestionsLoaded && (
                <button
                  onClick={loadSuggestions}
                  disabled={suggestionsLoading}
                  style={{
                    padding: "4px 10px",
                    background: "rgba(99,102,241,0.12)",
                    border: "1px solid rgba(99,102,241,0.25)",
                    borderRadius: 6, color: "#818cf8",
                    fontSize: 11, cursor: suggestionsLoading ? "not-allowed" : "pointer",
                    fontFamily: "inherit",
                  }}
                >
                  {suggestionsLoading ? "Finding…" : "Find →"}
                </button>
              )}
            </div>

            {!suggestionsLoaded && !suggestionsLoading && (
              <p style={{ fontSize: 12, color: "#2a2a3a", textAlign: "center", padding: "20px 0", margin: 0 }}>
                Click Find to discover related articles
              </p>
            )}

            {suggestionsLoading && [1, 2, 3].map(i => (
              <div key={i} style={{
                height: 72, borderRadius: 8, background: "#111118",
                marginBottom: 8, animation: "pulse 1.5s ease-in-out infinite",
              }} />
            ))}

            {suggestionsLoaded && extSuggestions.map((s, i) => (
              <div key={i} style={{
                padding: "12px 14px", background: "#111118",
                borderRadius: 8, border: "1px solid #1a1a2e", marginBottom: 8,
              }}>
                <p style={{ fontSize: 11, color: "#6366f1", margin: "0 0 3px" }}>{s.domain}</p>
                <p style={{ fontSize: 13, fontWeight: 500, color: "#e0e0f0", margin: "0 0 4px", lineHeight: 1.4 }}>{s.title}</p>
                <p style={{ fontSize: 11, color: "#555", margin: "0 0 8px", lineHeight: 1.5 }}>{s.snippet}</p>
                <div style={{ display: "flex", gap: 8 }}>
                  <a href={s.url} target="_blank" rel="noopener noreferrer"
                    style={{ fontSize: 11, color: "#555", textDecoration: "none", padding: "3px 8px", border: "1px solid #1a1a2e", borderRadius: 5 }}>
                    Read →
                  </a>
                  <button
                    onClick={() => captureUrl(s.url, i)}
                    disabled={s.capturing || s.captured}
                    style={{
                      fontSize: 11,
                      color: s.captured ? "#06ffa5" : "#818cf8",
                      background: s.captured ? "rgba(6,255,165,0.08)" : "rgba(99,102,241,0.1)",
                      border: `1px solid ${s.captured ? "rgba(6,255,165,0.2)" : "rgba(99,102,241,0.2)"}`,
                      borderRadius: 5, padding: "3px 8px",
                      cursor: s.capturing || s.captured ? "default" : "pointer",
                      fontFamily: "inherit",
                    }}
                  >
                    {s.captured ? "✓ Saved" : s.capturing ? "Saving…" : "+ Add to brain"}
                  </button>
                </div>
              </div>
            ))}

            {suggestionsLoaded && extSuggestions.length === 0 && (
              <p style={{ fontSize: 12, color: "#333", textAlign: "center", padding: "8px 0", margin: 0 }}>
                No suggestions found.
              </p>
            )}
          </div>

          {/* In your brain — related captures */}
          {related.length > 0 && (
            <div style={{ background: "#0d0d14", border: "1px solid #1a1a2e", borderRadius: 12, padding: "16px 18px" }}>
              <p style={{ fontSize: 11, color: "#555", textTransform: "uppercase", letterSpacing: "0.1em", margin: "0 0 12px" }}>In your brain</p>
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {related.map(r => (
                  <Link key={r.id} href={`/document/${r.id}`}>
                    <div className="card card-link" style={{ padding: "11px 14px" }}>
                      <p style={{ fontSize: "13px", fontWeight: 500, margin: "0 0 2px", color: "var(--text-1)" }}>{r.title}</p>
                      {r.excerpt && (
                        <p style={{ fontSize: "12px", color: "var(--text-2)", margin: 0, lineHeight: 1.5 }}>
                          {r.excerpt.slice(0, 80)}{r.excerpt.length > 80 ? "…" : ""}
                        </p>
                      )}
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>{/* end right column */}

      </div>{/* end doc-layout grid */}
    </div>
  );
}
