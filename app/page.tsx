"use client";

import { useEffect, useState } from "react";
import { supabase } from "@/lib/supabase";

type Result = {
  chunk: string;
  document_id: number;
  score: number;
};

export default function Home() {
  const [session, setSession] = useState<any>(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session);
    });

    const { data: listener } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session);
      }
    );

    return () => {
      listener.subscription.unsubscribe();
    };
  }, []);

  if (!session) {
    return (
      <main className="min-h-screen flex flex-col items-center justify-center gap-4">
        <h1 className="text-3xl font-bold">Second Brain</h1>

        <button
          onClick={() =>
            supabase.auth.signInWithOAuth({ provider: "github" })
          }
          className="px-4 py-2 bg-black text-white rounded-lg"
        >
          Login with GitHub
        </button>

        <button
          onClick={() =>
            supabase.auth.signInWithOAuth({ provider: "google" })
          }
          className="px-4 py-2 bg-blue-500 text-white rounded-lg"
        >
          Login with Google
        </button>
      </main>
    );
  }

  return <Dashboard />;
}

function Dashboard() {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Result[]>([]);
  const [loading, setLoading] = useState(false);

  const handleSearch = async () => {
    if (!query.trim()) return;

    setLoading(true);

    const {
      data: { session },
    } = await supabase.auth.getSession();

    const res = await fetch(
      `${process.env.NEXT_PUBLIC_BACKEND_URL}/query`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ query }),
      }
    );

    const data = await res.json();
    setResults(data);
    setLoading(false);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") handleSearch();
  };

  const truncate = (text: string, maxLength = 250) => {
    return text.length > maxLength
      ? text.slice(0, maxLength) + "..."
      : text;
  };

 return (
  <main className="min-h-screen bg-[#0f172a] flex justify-center p-6">
    <div className="w-full max-w-3xl">

      {/* Header */}
      <div className="flex justify-between items-center mb-8">
        <h1 className="text-3xl font-semibold text-white">
          Second Brain
        </h1>

        <button
          onClick={() => supabase.auth.signOut()}
          className="text-sm text-red-400 hover:text-red-300"
        >
          Logout
        </button>
      </div>

      {/* Search */}
      <div className="flex gap-3 mb-8">
        <input
          className="flex-1 p-4 rounded-xl bg-[#1e293b] text-white border border-[#334155] 
                     placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
          placeholder="Ask anything..."
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={handleKeyDown}
        />

        <button
          onClick={handleSearch}
          className="px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-xl font-medium"
        >
          Search
        </button>
      </div>

      {/* Loading */}
      {loading && (
        <p className="text-gray-400">Searching...</p>
      )}

      {/* Results */}
      <div className="space-y-4">
        {results.slice(0, 5).map((r, i) => (
          <div
            key={i}
            className="p-5 rounded-xl bg-[#1e293b] border border-[#334155] hover:border-blue-500 transition"
          >
            <p className="text-xs text-gray-400 mb-2">
              Result {i + 1}
            </p>

            <p className="text-gray-100 leading-relaxed mb-3">
              {truncate(r.chunk)}
            </p>

            <div className="flex justify-between text-xs text-gray-400">
              <span>Score: {r.score?.toFixed(3)}</span>
              <span>Doc {r.document_id}</span>
            </div>
          </div>
        ))}
      </div>
    </div>
  </main>
);
}