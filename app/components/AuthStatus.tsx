"use client";

import { useEffect, useState } from "react";
import { supabase } from "../../lib/supabase";

type SessionUser = {
  id: string;
  email?: string | null;
};

export default function AuthStatus() {
  const [user, setUser] = useState<SessionUser | null>(null);

  useEffect(() => {
    let mounted = true;

    supabase.auth.getUser().then(({ data, error }) => {
      if (!mounted) return;
      if (error) {
        setUser(null);
        return;
      }
      const u = data?.user;
      setUser(u ? { id: u.id, email: u.email } : null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email } : null);
    });

    return () => {
      mounted = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    await supabase.auth.signOut();
  }

  return (
    <div style={{ padding: 12, border: "1px solid #ddd", borderRadius: 8, display: "inline-block" }}>
      {user ? (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>Signed in</div>
          <div style={{ fontSize: 12, opacity: 0.8 }}>{user.email || "No email"}</div>
          <div style={{ fontFamily: "monospace", fontSize: 12 }}>{user.id}</div>
          <button onClick={signOut} style={{ padding: 8 }}>Sign out</button>
        </div>
      ) : (
        <div style={{ display: "grid", gap: 6 }}>
          <div style={{ fontWeight: 600 }}>Not signed in</div>
          <a href="/login">Go to login</a>
        </div>
      )}
    </div>
  );
}