"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import { useParams, useRouter } from "next/navigation";
import Link from "next/link";

const BACKEND = "/api";

async function authFetch(url: string, options: RequestInit = {}) {
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error("Not authenticated");
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.access_token}`,
      ...options.headers,
    },
  });
}

function timeAgo(dateStr: string) {
  const normalized = dateStr.endsWith("Z") ? dateStr : dateStr + "Z";
  const diff = Date.now() - new Date(normalized).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(normalized).toLocaleDateString();
}

type Message = { role: "user" | "assistant"; content: string };

export default function DocumentPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [doc, setDoc] = useState<any>(null);
  const [related, setRelated] = useState<any[]>([]);
  const [summary, setSummary] = useState("");
  const [summaryLoading, setSummaryLoading] = useState(false);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [showFullContent, setShowFullContent] = useState(false);
  const [chatMode, setChatMode] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!id) return;
    Promise.all([
      authFetch(`${BACKEND}/documents/${id}`).then(r => {
        if (r.status === 404) { router.push("/"); return null; }
        return r.json();
      }),
      authFetch(`${BACKEND}/documents/${id}/related`).then(r => r.json()).catch(() => []),
    ]).then(([docData, relatedData]) => {
      if (!docData) return;
      setDoc(docData);
      setNote(docData.user_note || "");
      setRelated(Array.isArray(relatedData) ? relatedData : []);
    }).catch(console.error).finally(() => setLoading(false));
  }, [id]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const loadSummary = async () => {
    if (summary) return;
    setSummaryLoading(true);
    try {
      const res = await authFetch(`${BACKEND}/documents/${id}/summarise`, { method: "POST" });
      const data = await res.json();
      setSummary(data.summary || "");
    } catch (e) {
      setSummary("Could not generate summary.");
    } finally {
      setSummaryLoading(false);
    }
  };

  useEffect(() => {
    if (doc) loadSummary();
  }, [doc]);

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await authFetch(`${BACKEND}/documents/${id}/note`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } finally {
      setSavingNote(false);
    }
  };

  const sendChat = async () => {
    if (!chatInput.trim() || chatLoading) return;
    const userMsg: Message = { role: "user", content: chatInput };
    const newMessages = [...messages, userMsg];
    setMessages(newMessages);
    setChatInput("");
    setChatLoading(true);

    try {
      const res = await authFetch(`${BACKEND}/chat`, {
        method: "POST",
        body: JSON.stringify({
          messages: newMessages,
          document_id: parseInt(id)
        }),
      });
      const data = await res.json();
      setMessages(prev => [...prev, { role: "assistant", content: data.reply }]);
    } catch (e) {
      setMessages(prev => [...prev, { role: "assistant", content: "Something went wrong. Please try again." }]);
    } finally {
      setChatLoading(false);
    }
  };

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "20px", height: "20px", border: "2px solid #333", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!doc) return null;

  return (
    <main style={{ minHeight: "100vh", background: "#0a0a0f", fontFamily: "'DM Sans', system-ui, sans-serif", color: "#f0f0f0" }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        textarea:focus, input:focus { outline: none; }
        a { color: inherit; text-decoration: none; }
      `}</style>

      <div style={{ maxWidth: "720px", margin: "0 auto", padding: "32px 20px" }}>

        {/* Back */}
        <Link href="/">
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#555", marginBottom: "28px", cursor: "pointer" }}>
            ← Back
          </div>
        </Link>

        {/* Title */}
        <h1 style={{ fontSize: "24px", fontWeight: 600, color: "#e0e0f0", margin: "0 0 10px", lineHeight: 1.3 }}>
          {doc.title || "Untitled"}
        </h1>

        {/* Meta */}
        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", marginBottom: "24px" }}>
          {doc.url && (
            <a href={doc.url} target="_blank" rel="noopener noreferrer"
              style={{ fontSize: "12px", color: "#6366f1" }}>
              {(() => { try { return new URL(doc.url).hostname; } catch { return doc.url; } })()}
            </a>
          )}
          {doc.byline && <span style={{ fontSize: "12px", color: "#555" }}>{doc.byline}</span>}
          <span style={{ fontSize: "12px", color: "#444" }}>{timeAgo(doc.captured_at)}</span>
          {doc.word_count && <span style={{ fontSize: "12px", color: "#444" }}>{doc.word_count.toLocaleString()} words</span>}
        </div>

        {/* AI Summary */}
        <div style={{ padding: "16px 20px", background: "#0d0d18", border: "1px solid #1e1e3a", borderRadius: "12px", marginBottom: "20px" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "10px" }}>
            <span style={{ fontSize: "11px", color: "#6366f1", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500 }}>
              AI Summary
            </span>
            {!chatMode && (
              <button
                onClick={() => setChatMode(true)}
                style={{ fontSize: "12px", color: "#6366f1", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit" }}
              >
                Continue in chat →
              </button>
            )}
          </div>
          {summaryLoading ? (
            <div style={{ display: "flex", alignItems: "center", gap: "8px", color: "#444", fontSize: "13px" }}>
              <div style={{ width: "12px", height: "12px", border: "1.5px solid #333", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
              Summarising...
            </div>
          ) : (
            <p style={{ fontSize: "14px", color: "#a0a0c0", lineHeight: 1.7, margin: 0 }}>{summary}</p>
          )}
        </div>

        {/* Chat mode */}
        {chatMode && (
          <div style={{ border: "1px solid #1a1a2e", borderRadius: "12px", marginBottom: "20px", overflow: "hidden" }}>
            <div style={{ padding: "12px 16px", borderBottom: "1px solid #1a1a2e", display: "flex", justifyContent: "space-between", alignItems: "center" }}>
              <span style={{ fontSize: "12px", color: "#6366f1", fontWeight: 500 }}>Chat about this capture</span>
              <button onClick={() => setChatMode(false)}
                style={{ fontSize: "18px", color: "#444", background: "none", border: "none", cursor: "pointer", lineHeight: 1 }}>×</button>
            </div>

            {/* Messages */}
            <div style={{ maxHeight: "360px", overflowY: "auto", padding: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
              {messages.length === 0 && (
                <p style={{ fontSize: "13px", color: "#444", margin: 0 }}>Ask anything about this capture...</p>
              )}
              {messages.map((msg, i) => (
                <div key={i} style={{
                  alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                  maxWidth: "85%",
                  padding: "10px 14px",
                  borderRadius: msg.role === "user" ? "12px 12px 4px 12px" : "12px 12px 12px 4px",
                  background: msg.role === "user" ? "#6366f1" : "#111118",
                  border: msg.role === "assistant" ? "1px solid #1a1a28" : "none",
                  fontSize: "14px",
                  lineHeight: 1.6,
                  color: msg.role === "user" ? "white" : "#c0c0d0",
                }}>
                  {msg.content}
                </div>
              ))}
              {chatLoading && (
                <div style={{ alignSelf: "flex-start", display: "flex", alignItems: "center", gap: "8px", color: "#444", fontSize: "13px" }}>
                  <div style={{ width: "12px", height: "12px", border: "1.5px solid #333", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                  Thinking...
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Input */}
            <div style={{ padding: "12px 16px", borderTop: "1px solid #1a1a2e", display: "flex", gap: "8px" }}>
              <input
                value={chatInput}
                onChange={e => setChatInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && !e.shiftKey && sendChat()}
                placeholder="Ask something..."
                style={{
                  flex: 1, padding: "8px 12px", background: "#111118",
                  border: "1px solid #1a1a28", borderRadius: "8px",
                  fontSize: "13px", color: "#f0f0f0", fontFamily: "inherit"
                }}
              />
              <button onClick={sendChat} disabled={chatLoading}
                style={{
                  padding: "8px 16px", background: "#6366f1", border: "none",
                  borderRadius: "8px", color: "white", fontSize: "13px",
                  cursor: "pointer", fontFamily: "inherit"
                }}>
                Send
              </button>
            </div>
          </div>
        )}

        {/* Full content toggle */}
        <div style={{ marginBottom: "20px" }}>
          <button
            onClick={() => setShowFullContent(!showFullContent)}
            style={{ fontSize: "13px", color: "#555", background: "none", border: "none", cursor: "pointer", fontFamily: "inherit", padding: 0 }}
          >
            {showFullContent ? "Hide full content ↑" : "Show full content ↓"}
          </button>
          {showFullContent && doc.content && (
            <div style={{
              marginTop: "12px", padding: "20px", background: "#0d0d14",
              border: "1px solid #16161f", borderRadius: "10px",
              fontSize: "14px", color: "#888", lineHeight: 1.8,
              maxHeight: "500px", overflowY: "auto",
              whiteSpace: "pre-wrap"
            }}>
              {doc.content}
            </div>
          )}
        </div>

        {/* Note */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", color: "#444", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>Your note</div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why did you save this? What's important about it?"
            style={{
              width: "100%", minHeight: "80px", padding: "12px 14px",
              background: "#111118", border: "1px solid #1a1a28",
              borderRadius: "10px", fontSize: "14px", color: "#d0d0e0",
              lineHeight: 1.6, resize: "vertical", fontFamily: "inherit",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
            <button onClick={saveNote} disabled={savingNote}
              style={{
                padding: "7px 16px",
                background: noteSaved ? "#1a2e1a" : "#6366f1",
                border: "none", borderRadius: "8px",
                color: noteSaved ? "#4ade80" : "white",
                fontSize: "13px", fontWeight: 500, cursor: "pointer", fontFamily: "inherit"
              }}>
              {noteSaved ? "Saved ✓" : savingNote ? "Saving..." : "Save note"}
            </button>
          </div>
        </div>

        {/* Related captures */}
        {related.length > 0 && (
          <div style={{ marginBottom: "24px" }}>
            <div style={{ fontSize: "11px", color: "#444", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
              Related captures
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {related.map(r => (
                <Link key={r.id} href={`/document/${r.id}`}>
                  <div style={{
                    padding: "12px 16px", background: "#0d0d14",
                    border: "1px solid #16161f", borderRadius: "10px", cursor: "pointer"
                  }}>
                    <p style={{ fontSize: "13px", fontWeight: 500, margin: "0 0 4px", color: "#c0c0d0" }}>{r.title}</p>
                    {r.excerpt && (
                      <p style={{ fontSize: "12px", color: "#555", margin: 0, lineHeight: 1.4 }}>
                        {r.excerpt.slice(0, 100)}...
                      </p>
                    )}
                  </div>
                </Link>
              ))}
            </div>
          </div>
        )}

        {/* Delete */}
        <div style={{ borderTop: "1px solid #111", paddingTop: "20px" }}>
          <button
            onClick={async () => {
              if (!confirm("Delete this capture?")) return;
              await authFetch(`${BACKEND}/documents/${id}`, { method: "DELETE" });
              router.push("/");
            }}
            style={{
              padding: "7px 14px", background: "transparent",
              border: "1px solid #2a1a1a", borderRadius: "8px",
              color: "#633", fontSize: "12px", cursor: "pointer", fontFamily: "inherit"
            }}>
            Delete capture
          </button>
        </div>

      </div>
    </main>
  );
}