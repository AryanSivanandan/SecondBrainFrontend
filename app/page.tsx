"use client";

import { useEffect, useState, useRef } from "react";
import { supabase } from "@/lib/supabase";
import Link from "next/link";

type Result = {
  chunk: string;
  document_id: number;
  chunk_id?: number;
  score: number;
};

type Document = {
  id: number;
  title: string;
  url: string;
  excerpt: string;
  captured_at: string;
  word_count: number;
  user_note?: string;
};

type Reminder = {
  document_id: number;
  title: string;
  url: string;
  reason: string;
  captured_at: string;
};

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
  const normalized = dateStr.endsWith('Z') || dateStr.includes('+') ? dateStr : dateStr + 'Z';
  const diff = Date.now() - new Date(normalized).getTime();
  const mins = Math.floor(diff / 60000);
  const hours = Math.floor(diff / 3600000);
  const days = Math.floor(diff / 86400000);
  if (mins < 60) return `${mins}m ago`;
  if (hours < 24) return `${hours}h ago`;
  if (days < 30) return `${days}d ago`;
  return new Date(normalized).toLocaleDateString();
}

function hostname(url: string) {
  try { return new URL(url).hostname.replace("www.", ""); }
  catch { return ""; }
}

export default function Home() {
  const [session, setSession] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
      setLoading(false);
    });
    const { data: listener } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => listener.subscription.unsubscribe();
  }, []);

  if (loading) return (
    <div style={{ minHeight: "100vh", background: "#0a0a0f", display: "flex", alignItems: "center", justifyContent: "center" }}>
      <div style={{ width: "20px", height: "20px", border: "2px solid #333", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  );

  if (!session) return <LoginPage />;
  return <Dashboard session={session} />;
}

function LoginPage() {
  return (
    <main style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      gap: "32px",
      fontFamily: "'DM Sans', system-ui, sans-serif",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
      `}</style>

      <div style={{ textAlign: "center" }}>
        <div style={{ fontSize: "13px", letterSpacing: "0.15em", color: "#6366f1", marginBottom: "16px", textTransform: "uppercase", fontWeight: 500 }}>
          Second Brain
        </div>
        <h1 style={{ fontSize: "48px", fontWeight: 300, color: "#f0f0f0", margin: "0 0 12px", letterSpacing: "-1.5px", lineHeight: 1 }}>
          Everything you read,<br />remembered.
        </h1>
        <p style={{ fontSize: "16px", color: "#555", margin: 0, fontWeight: 400 }}>
          Capture anything. Ask anything. Find anything.
        </p>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "10px", width: "280px" }}>
        <button
          onClick={() => supabase.auth.signInWithOAuth({ provider: "github", options: { redirectTo: `${window.location.origin}/auth/callback` } })}
          style={{
            padding: "12px 20px",
            background: "#f0f0f0",
            color: "#0a0a0f",
            border: "none",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontFamily: "inherit",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
            <path d="M12 0C5.37 0 0 5.37 0 12c0 5.31 3.435 9.795 8.205 11.385.6.105.825-.255.825-.57 0-.285-.015-1.23-.015-2.235-3.015.555-3.795-.735-4.035-1.41-.135-.345-.72-1.41-1.23-1.695-.42-.225-1.02-.78-.015-.795.945-.015 1.62.87 1.845 1.23 1.08 1.815 2.805 1.305 3.495.99.105-.78.42-1.305.765-1.605-2.67-.3-5.46-1.335-5.46-5.925 0-1.305.465-2.385 1.23-3.225-.12-.3-.54-1.53.12-3.18 0 0 1.005-.315 3.3 1.23.96-.27 1.98-.405 3-.405s2.04.135 3 .405c2.295-1.56 3.3-1.23 3.3-1.23.66 1.65.24 2.88.12 3.18.765.84 1.23 1.905 1.23 3.225 0 4.605-2.805 5.625-5.475 5.925.435.375.81 1.095.81 2.22 0 1.605-.015 2.895-.015 3.3 0 .315.225.69.825.57A12.02 12.02 0 0 0 24 12c0-6.63-5.37-12-12-12z"/>
          </svg>
          Continue with GitHub
        </button>

        <button
          onClick={() => supabase.auth.signInWithOAuth({ provider: "google", options: { redirectTo: `${window.location.origin}/auth/callback` } })}
          style={{
            padding: "12px 20px",
            background: "transparent",
            color: "#f0f0f0",
            border: "1px solid #222",
            borderRadius: "10px",
            fontSize: "14px",
            fontWeight: 500,
            cursor: "pointer",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gap: "8px",
            fontFamily: "inherit",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 48 48">
            <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
            <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
            <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
            <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
          </svg>
          Continue with Google
        </button>
      </div>
    </main>
  );
}

function Dashboard({ session }: { session: any }) {
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [documents, setDocuments] = useState<Document[]>([]);
  const [reminders, setReminders] = useState<Reminder[]>([]);
  const [loading, setLoading] = useState(false);
  const [feedLoading, setFeedLoading] = useState(true);
  const [mode, setMode] = useState<"feed" | "search">("feed");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
  Promise.all([
    authFetch(`${BACKEND}/documents?limit=20`).then(async r => {
      const text = await r.text();
      console.log("documents response:", r.status, text);
      try { return JSON.parse(text); } catch { return []; }
    }),
    authFetch(`${BACKEND}/reminders`).then(async r => {
      const text = await r.text();
      console.log("reminders response:", r.status, text);
      try { return JSON.parse(text); } catch { return []; }
    }),
  ]).then(([docs, rems]) => {
    setDocuments(Array.isArray(docs) ? docs : []);
    setReminders(Array.isArray(rems) ? rems : []);
  }).catch(console.error).finally(() => setFeedLoading(false));
}, []);

  const handleSearch = async () => {
    if (!query.trim()) return;
    setLoading(true);
    setMode("search");
    setAnswer("");
    setResults([]);

    try {
      const res = await authFetch(`${BACKEND}/answer`, {
        method: "POST",
        body: JSON.stringify({ query }),
      });
      const data = await res.json();
      setAnswer(data.answer || "");
      setResults(data.sources || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  };

  const clearSearch = () => {
    setQuery("");
    setMode("feed");
    setAnswer("");
    setResults([]);
    inputRef.current?.focus();
  };

  return (
    <main style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: "#f0f0f0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&family=DM+Mono:wght@400;500&display=swap');
        * { box-sizing: border-box; }
        ::placeholder { color: #444; }
        a { color: inherit; text-decoration: none; }
        .doc-card:hover { border-color: #2a2a3a !important; background: #111118 !important; }
        .source-card:hover { border-color: #6366f1 !important; }
      `}</style>

      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "32px 20px" }}>

        {/* Header */}
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "28px" }}>
          <div
            onClick={clearSearch}
            style={{ fontSize: "15px", fontWeight: 600, letterSpacing: "0.05em", color: "#6366f1", cursor: "pointer", textTransform: "uppercase" }}
          >
            Second Brain
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: "16px" }}>
            <span style={{ fontSize: "12px", color: "#444" }}>{session?.user?.email}</span>
            <button
              onClick={() => supabase.auth.signOut()}
              style={{ fontSize: "12px", color: "#555", background: "none", border: "none", cursor: "pointer", padding: 0, fontFamily: "inherit" }}
            >
              Sign out
            </button>
          </div>
        </div>

        {/* Search bar */}
        <div style={{ position: "relative", marginBottom: "32px" }}>
          <input
            ref={inputRef}
            value={query}
            onChange={e => setQuery(e.target.value)}
            onKeyDown={e => e.key === "Enter" && handleSearch()}
            placeholder="Ask your second brain..."
            style={{
              width: "100%",
              padding: "14px 100px 14px 18px",
              background: "#111118",
              border: "1px solid #1e1e2e",
              borderRadius: "12px",
              fontSize: "15px",
              color: "#f0f0f0",
              outline: "none",
              fontFamily: "inherit",
              transition: "border-color 0.15s",
            }}
            onFocus={e => e.target.style.borderColor = "#6366f1"}
            onBlur={e => e.target.style.borderColor = "#1e1e2e"}
          />
          <div style={{ position: "absolute", right: "8px", top: "50%", transform: "translateY(-50%)", display: "flex", gap: "6px" }}>
            {mode === "search" && (
              <button
                onClick={clearSearch}
                style={{ padding: "6px 10px", background: "transparent", border: "none", color: "#555", cursor: "pointer", fontSize: "18px", lineHeight: 1, fontFamily: "inherit" }}
              >
                ×
              </button>
            )}
            <button
              onClick={handleSearch}
              style={{
                padding: "7px 14px",
                background: "#6366f1",
                border: "none",
                borderRadius: "8px",
                color: "white",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
              }}
            >
              {loading ? "..." : "Ask"}
            </button>
          </div>
        </div>

        {/* SEARCH MODE */}
        {mode === "search" && (
          <div>
            {loading && (
              <div style={{ display: "flex", alignItems: "center", gap: "10px", color: "#555", fontSize: "14px", marginBottom: "24px" }}>
                <div style={{ width: "14px", height: "14px", border: "1.5px solid #333", borderTopColor: "#6366f1", borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
                Thinking...
              </div>
            )}

            {/* LLM Answer */}
            {answer && (
              <div style={{
                padding: "20px",
                background: "#0d0d18",
                border: "1px solid #1e1e3a",
                borderRadius: "12px",
                marginBottom: "24px",
              }}>
                <div style={{ fontSize: "11px", color: "#6366f1", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.1em", fontWeight: 500 }}>
                  Answer
                </div>
                <p style={{ fontSize: "15px", lineHeight: 1.7, color: "#d0d0e0", margin: 0 }}>
                  {answer}
                </p>
              </div>
            )}

            {/* Source chunks */}
            {results.length > 0 && (
              <div>
                <div style={{ fontSize: "11px", color: "#444", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                  Sources ({results.length})
                </div>
                <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                  {results.map((r, i) => (
                    <Link key={i} href={`/document/${r.document_id}`}>
                      <div
                        className="source-card"
                        style={{
                          padding: "14px 16px",
                          background: "#111118",
                          border: "1px solid #1a1a28",
                          borderRadius: "10px",
                          cursor: "pointer",
                          transition: "border-color 0.15s",
                        }}
                      >
                        <p style={{ fontSize: "13px", color: "#b0b0c0", lineHeight: 1.6, margin: "0 0 8px" }}>
                          {r.chunk.slice(0, 200)}{r.chunk.length > 200 ? "..." : ""}
                        </p>
                        <div style={{ display: "flex", justifyContent: "space-between" }}>
                          <span style={{ fontSize: "11px", color: "#444" }}>Doc {r.document_id}</span>
                          <span style={{ fontSize: "11px", color: "#444" }}>{r.score?.toFixed(3)}</span>
                        </div>
                      </div>
                    </Link>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {/* FEED MODE */}
        {mode === "feed" && (
          <div>
            {feedLoading ? (
              <div style={{ color: "#444", fontSize: "14px" }}>Loading your captures...</div>
            ) : (
              <>
                {/* Reminders */}
                {reminders.length > 0 && (
                  <div style={{ marginBottom: "32px" }}>
                    <div style={{ fontSize: "11px", color: "#444", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                      Resurface
                    </div>
                    {reminders.map((r) => (
                      <Link key={r.document_id} href={`/document/${r.document_id}`}>
                        <div style={{
                          padding: "12px 16px",
                          background: "#0f0f0a",
                          border: "1px solid #2a2a1a",
                          borderRadius: "10px",
                          marginBottom: "8px",
                          cursor: "pointer",
                        }}>
                          <p style={{ fontSize: "13px", fontWeight: 500, margin: "0 0 3px", color: "#d4c87a" }}>
                            {r.title}
                          </p>
                          <p style={{ fontSize: "12px", color: "#666", margin: 0 }}>{r.reason}</p>
                        </div>
                      </Link>
                    ))}
                  </div>
                )}

                {/* Recent captures */}
                <div>
                  <div style={{ fontSize: "11px", color: "#444", marginBottom: "12px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
                    Recent — {documents.length} captures
                  </div>

                  {documents.length === 0 ? (
                    <div style={{
                      padding: "40px",
                      textAlign: "center",
                      border: "1px dashed #1e1e2e",
                      borderRadius: "12px",
                      color: "#444",
                      fontSize: "14px",
                      lineHeight: 1.6,
                    }}>
                      Nothing captured yet.<br />
                      <span style={{ fontSize: "12px", color: "#333" }}>
                        Use Ctrl+Shift+9 in the browser extension to capture a page.
                      </span>
                    </div>
                  ) : (
                    <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
                      {documents.map((doc) => (
                        <Link key={doc.id} href={`/document/${doc.id}`}>
                          <div
                            className="doc-card"
                            style={{
                              padding: "14px 16px",
                              background: "#0d0d14",
                              border: "1px solid #16161f",
                              borderRadius: "10px",
                              cursor: "pointer",
                              transition: "border-color 0.15s, background 0.15s",
                            }}
                          >
                            <div style={{ display: "flex", justifyContent: "space-between", marginBottom: "6px" }}>
                              <p style={{ fontSize: "14px", fontWeight: 500, margin: 0, color: "#e0e0f0", flex: 1, marginRight: "12px" }}>
                                {doc.title || "Untitled"}
                              </p>
                              <span style={{ fontSize: "11px", color: "#444", whiteSpace: "nowrap" }}>
                                {timeAgo(doc.captured_at)}
                              </span>
                            </div>
                            {doc.excerpt && (
                              <p style={{ fontSize: "13px", color: "#555", margin: "0 0 8px", lineHeight: 1.5 }}>
                                {doc.excerpt.slice(0, 120)}...
                              </p>
                            )}
                            <div style={{ display: "flex", gap: "12px" }}>
                              {doc.url && (
                                <span style={{ fontSize: "11px", color: "#383848" }}>
                                  {hostname(doc.url)}
                                </span>
                              )}
                              {doc.user_note && (
                                <span style={{ fontSize: "11px", color: "#6366f1" }}>
                                  has note
                                </span>
                              )}
                            </div>
                          </div>
                        </Link>
                      ))}
                    </div>
                  )}
                </div>
              </>
            )}
          </div>
        )}
      </div>
    </main>
  );
}