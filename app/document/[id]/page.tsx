"use client";

import { useEffect, useState } from "react";
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
  const diff = Date.now() - new Date(dateStr).getTime();
  const days = Math.floor(diff / 86400000);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return new Date(dateStr).toLocaleDateString();
}

export default function DocumentPage() {
  const params = useParams();
  const router = useRouter();
  const id = params?.id as string;

  const [doc, setDoc] = useState<any>(null);
  const [note, setNote] = useState("");
  const [savingNote, setSavingNote] = useState(false);
  const [noteSaved, setNoteSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    if (!id) return;
    authFetch(`${BACKEND}/documents/${id}`)
      .then(r => {
        if (r.status === 404) { router.push("/"); return null; }
        return r.json();
      })
      .then(data => {
        if (!data) return;
        setDoc(data);
        setNote(data.user_note || "");
      })
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [id]);

  const saveNote = async () => {
    setSavingNote(true);
    try {
      await authFetch(`${BACKEND}/documents/${id}/note`, {
        method: "POST",
        body: JSON.stringify({ note }),
      });
      setNoteSaved(true);
      setTimeout(() => setNoteSaved(false), 2000);
    } catch (e) {
      console.error(e);
    } finally {
      setSavingNote(false);
    }
  };

  const deleteDoc = async () => {
    if (!confirm("Delete this capture? This cannot be undone.")) return;
    setDeleting(true);
    try {
      await authFetch(`${BACKEND}/documents/${id}`, { method: "DELETE" });
      router.push("/");
    } catch (e) {
      console.error(e);
      setDeleting(false);
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
    <main style={{
      minHeight: "100vh",
      background: "#0a0a0f",
      fontFamily: "'DM Sans', system-ui, sans-serif",
      color: "#f0f0f0",
    }}>
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=DM+Sans:wght@300;400;500;600&display=swap');
        * { box-sizing: border-box; }
        textarea:focus { outline: none; border-color: #6366f1 !important; }
      `}</style>

      <div style={{ maxWidth: "680px", margin: "0 auto", padding: "32px 20px" }}>

        {/* Back */}
        <Link href="/">
          <div style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontSize: "13px", color: "#555", marginBottom: "28px", cursor: "pointer" }}>
            <span>←</span> Back
          </div>
        </Link>

        {/* Title + meta */}
        <h1 style={{ fontSize: "22px", fontWeight: 600, color: "#e0e0f0", margin: "0 0 10px", lineHeight: 1.3 }}>
          {doc.title || "Untitled"}
        </h1>

        <div style={{ display: "flex", gap: "16px", alignItems: "center", marginBottom: "28px" }}>
          {doc.url && (
            <a
              href={doc.url}
              target="_blank"
              rel="noopener noreferrer"
              style={{ fontSize: "12px", color: "#6366f1" }}
            >
              {(() => { try { return new URL(doc.url).hostname; } catch { return doc.url; } })()}
            </a>
          )}
          <span style={{ fontSize: "12px", color: "#444" }}>
            {timeAgo(doc.captured_at)}
          </span>
          {doc.word_count && (
            <span style={{ fontSize: "12px", color: "#444" }}>
              {doc.word_count.toLocaleString()} words
            </span>
          )}
        </div>

        {/* Excerpt */}
        {doc.excerpt && (
          <div style={{
            padding: "16px",
            background: "#111118",
            border: "1px solid #1a1a28",
            borderRadius: "10px",
            marginBottom: "24px",
          }}>
            <p style={{ fontSize: "14px", color: "#888", lineHeight: 1.7, margin: 0, fontStyle: "italic" }}>
              {doc.excerpt}
            </p>
          </div>
        )}

        {/* Note */}
        <div style={{ marginBottom: "24px" }}>
          <div style={{ fontSize: "11px", color: "#444", marginBottom: "10px", textTransform: "uppercase", letterSpacing: "0.1em" }}>
            Your note
          </div>
          <textarea
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder="Why did you save this? What's important about it?"
            style={{
              width: "100%",
              minHeight: "100px",
              padding: "12px 14px",
              background: "#111118",
              border: "1px solid #1a1a28",
              borderRadius: "10px",
              fontSize: "14px",
              color: "#d0d0e0",
              lineHeight: 1.6,
              resize: "vertical",
              fontFamily: "inherit",
              transition: "border-color 0.15s",
            }}
          />
          <div style={{ display: "flex", justifyContent: "flex-end", marginTop: "8px" }}>
            <button
              onClick={saveNote}
              disabled={savingNote}
              style={{
                padding: "7px 16px",
                background: noteSaved ? "#1a2e1a" : "#6366f1",
                border: "none",
                borderRadius: "8px",
                color: noteSaved ? "#4ade80" : "white",
                fontSize: "13px",
                fontWeight: 500,
                cursor: "pointer",
                fontFamily: "inherit",
                transition: "background 0.2s",
              }}
            >
              {noteSaved ? "Saved" : savingNote ? "Saving..." : "Save note"}
            </button>
          </div>
        </div>

        {/* Delete */}
        <div style={{ borderTop: "1px solid #111", paddingTop: "24px" }}>
          <button
            onClick={deleteDoc}
            disabled={deleting}
            style={{
              padding: "7px 14px",
              background: "transparent",
              border: "1px solid #2a1a1a",
              borderRadius: "8px",
              color: "#633",
              fontSize: "12px",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            {deleting ? "Deleting..." : "Delete capture"}
          </button>
        </div>

      </div>
    </main>
  );
}