"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";
import {
  getOrCreateUserId,
  getDisplayName,
  setDisplayName,
} from "../../../lib/localUser";

type Member = {
  user_id: string;
  display_name: string;
};

export default function LeaguePage() {
  const params = useParams<{ id: string }>();
  const leagueId = params?.id;

  const [league, setLeague] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState("");
  const [joining, setJoining] = useState(false);

  const userId = useMemo(() => getOrCreateUserId(), []);
  const savedName = useMemo(() => getDisplayName(), []);

  // Load league + members
  useEffect(() => {
    if (!leagueId) return;

    supabase
      .from("leagues")
      .select("*")
      .eq("id", leagueId)
      .single()
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setLeague(data);
      });

    supabase
      .from("league_members")
      .select("user_id, display_name")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setMembers((data || []) as Member[]);
      });
  }, [leagueId]);

  useEffect(() => {
    if (!leagueId) return;
  
    const channel = supabase
      .channel(`league-members-${leagueId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "league_members",
          filter: `league_id=eq.${leagueId}`,
        },
        (payload) => {
          const newMember = payload.new as Member;
  
          setMembers((prev) => {
            // Prevent duplicates
            if (prev.some((m) => m.user_id === newMember.user_id)) {
              return prev;
            }
            return [...prev, newMember];
          });
        }
      )
      .subscribe();
  
    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);
  

  const isJoined = members.some((m) => m.user_id === userId);

  async function joinLeague() {
    if (!leagueId) return;

    const displayName = (nameInput || savedName).trim();
    if (!displayName) {
      alert("Enter your name");
      return;
    }

    setJoining(true);
    setDisplayName(displayName);

    const { error } = await supabase.from("league_members").insert({
      league_id: leagueId,
      user_id: userId,
      display_name: displayName,
    });

    setJoining(false);

    if (error) {
      // If you already joined, this unique constraint might trigger.
      // We can treat that as success.
      if (error.message.toLowerCase().includes("duplicate")) {
        return;
      }
      alert(error.message);
      return;
    }

    // Refresh members
    const { data } = await supabase
      .from("league_members")
      .select("user_id, display_name")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true });

    setMembers((data || []) as Member[]);
  }

  if (!leagueId) return <main style={{ padding: 40 }}>Loading...</main>;
  if (error) return <main style={{ padding: 40 }}>Error: {error}</main>;
  if (!league) return <main style={{ padding: 40 }}>Loading league...</main>;

  return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 720 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{league.name}</h1>
      <p style={{ marginTop: 8 }}>Status: {league.status}</p>
      <p style={{ marginTop: 8, opacity: 0.7 }}>League ID: {league.id}</p>

      <hr style={{ margin: "24px 0" }} />

      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Members</h2>
        <br />
      <b><a href={`/league/${leagueId}/draft`}>Go to Draft Room</a></b>


      {!isJoined && (
        <div style={{ marginTop: 12, display: "flex", gap: 12 }}>
          <input
            style={{ padding: 10, width: 280 }}
            placeholder="Your name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button
            style={{ padding: "10px 14px" }}
            onClick={joinLeague}
            disabled={joining}
          >
            {joining ? "Joining..." : "Join League"}
          </button>
          {savedName ? (
            <div style={{ alignSelf: "center", opacity: 0.7 }}>
              saved: {savedName}
            </div>
          ) : null}
        </div>
      )}

      {isJoined && (
        <p style={{ marginTop: 12, opacity: 0.7 }}>
          You’ve joined as <b>{savedName || "Player"}</b>.
        </p>
      )}

      <ol style={{ marginTop: 12, paddingLeft: 18 }}>
        {members.map((m) => (
          <li key={m.user_id}>
            {m.display_name}{" "}
            {m.user_id === userId ? <span style={{ opacity: 0.6 }}>(you)</span> : null}
          </li>
        ))}
      </ol>

      <p style={{ marginTop: 20, opacity: 0.7 }}>
        Send this link to friends to join:{" "}
        <code>{typeof window !== "undefined" ? window.location.href : ""}</code>
      </p>
    </main>
  );
}