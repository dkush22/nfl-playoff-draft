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
    <div>
      {user ? (
        <button
          onClick={signOut}
          className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors"
        >
          Sign out
        </button>
      ) : (
        <a
          href="/login"
          className="px-4 py-2 text-sm font-medium rounded-md border border-border hover:bg-muted transition-colors inline-block"
        >
          Sign in
        </a>
      )}
    </div>
  );
}