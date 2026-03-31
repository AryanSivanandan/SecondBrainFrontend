'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
)

export default function ExtensionCallback() {
  const [status, setStatus] = useState("Signing you in...")
  const [error, setError] = useState(null)

  useEffect(() => {
    async function handleAuth() {
      try {
        // Wait for Supabase to process the URL hash tokens
        // onAuthStateChange fires when session is ready
        const { data: { subscription } } = supabase.auth.onAuthStateChange(
          async (event, session) => {
            if (event === 'SIGNED_IN' && session) {
              subscription.unsubscribe()
              setStatus("Logged in! Connecting to extension...")

              window.postMessage({
                type: "SUPABASE_SESSION",
                token: session.access_token,
                refresh_token: session.refresh_token,
                email: session.user.email
              }, "*")

              setStatus("Connected! This tab will close automatically.")
              setTimeout(() => window.close(), 2000)
            }
          }
        )

        // Also check if session already exists (page reload case)
        const { data: { session } } = await supabase.auth.getSession()
        if (session) {
          subscription.unsubscribe()
          setStatus("Logged in! Connecting to extension...")

          window.postMessage({
            type: "SUPABASE_SESSION",
            token: session.access_token,
            refresh_token: session.refresh_token,
            email: session.user.email
          }, "*")

          setStatus("Connected! This tab will close automatically.")
          setTimeout(() => window.close(), 2000)
          return
        }

        // Timeout fallback — if nothing happens in 10 seconds
        setTimeout(() => {
          setError("Login timed out. Please close this tab and try again.")
          setStatus("")
        }, 10000)

      } catch (err) {
        console.error("Auth callback error:", err)
        setError("Something went wrong. Please try again.")
        setStatus("")
      }
    }

    handleAuth()
  }, [])

  return (
    <div style={{
      minHeight: "100vh",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "system-ui, sans-serif",
      background: "#0f0f0f",
      color: "#f0f0f0",
      padding: "20px",
      textAlign: "center"
    }}>
      <div style={{ fontSize: "24px", fontWeight: 600, marginBottom: "12px" }}>
        Second Brain
      </div>
      {status && <p style={{ color: "#aaa", fontSize: "14px" }}>{status}</p>}
      {error && <p style={{ color: "#ef4444", fontSize: "14px" }}>{error}</p>}
    </div>
  )
}