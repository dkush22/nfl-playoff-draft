"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "../../../lib/supabase";

export default function AuthCallbackPage() {
  const router = useRouter();

  useEffect(() => {
    supabase.auth.getSession().then(() => {
      router.replace("/");
    });
  }, [router]);

  return <main style={{ padding: 40, fontFamily: "system-ui" }}>Signing you in…</main>;
}