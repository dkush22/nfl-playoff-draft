"use client";

import { useState } from "react";
import { supabase } from "../lib/supabase";
import AuthStatus from "./components/AuthStatus";

export default function Home() {
  const [name, setName] = useState("");
  const [loading, setLoading] = useState(false);

  async function createLeague() {
    setLoading(true);

    const { data, error } = await supabase
      .from("leagues")
      .insert({ name })
      .select()
      .single();

    setLoading(false);

    if (error) {
      alert(error.message);
      return;
    }

    window.location.href = `/league/${data.id}`;
  }

  return (
    <main style={{ padding: 40, fontFamily: "system-ui" }}>
      <AuthStatus />
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>NFL Playoff Draft</h1>

      <div style={{ marginTop: 20, display: "flex", gap: 12 }}>
        <input
          style={{ padding: 10, width: 320 }}
          placeholder="League name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <button
          style={{ padding: "10px 14px" }}
          onClick={createLeague}
          disabled={loading || !name.trim()}
        >
          {loading ? "Creating..." : "Create League"}
        </button>
      </div>
    </main>
  );
}