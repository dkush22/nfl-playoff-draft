"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../lib/supabase";

export default function LoginPage() {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const router = useRouter();

  async function sendLink(e: React.FormEvent) {
    e.preventDefault();
    setError(null);

    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${window.location.origin}/auth/callback`,
      },
    });

    if (error) setError(error.message);
    else setSent(true);
  }

  return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 520 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>Sign in</h1>

      {sent ? (
        <>
          <p>Check your email for a magic link.</p>
          <button onClick={() => router.push("/")} style={{ padding: 10 }}>
            Back to home
          </button>
        </>
      ) : (
        <form onSubmit={sendLink} style={{ marginTop: 16, display: "grid", gap: 10 }}>
          <input
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
            type="email"
            required
            style={{ padding: 10 }}
          />
          <button type="submit" style={{ padding: 10 }}>
            Send magic link
          </button>
          {error ? <p style={{ color: "crimson" }}>{error}</p> : null}
        </form>
      )}
    </main>
  );
}