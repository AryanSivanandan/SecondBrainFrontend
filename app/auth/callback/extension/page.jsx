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
        await new Promise(resolve => setTimeout(resolve, 500))
        
        const { data: { session }, error } = await supabase.auth.getSession()

        if (error || !session) {
          setError("Login failed. Please close this tab and try again.")
          setStatus("")
          return
        }

        setStatus("Logged in! Connecting to extension...")

        // postMessage works in both Firefox and Chrome
        // The content script injected by the extension picks this up
        window.postMessage({
          type: "SUPABASE_SESSION",
          token: session.access_token,
          email: session.user.email
        }, "*")

        setStatus("Connected! This tab will close automatically.")
        setTimeout(() => window.close(), 2000)

      } catch (err) {
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