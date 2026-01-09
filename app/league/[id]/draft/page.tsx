"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { getOrCreateUserId, getDisplayName } from "../../../../lib/localUser";

type Member = { user_id: string; display_name: string };
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; nfl_team: string };
type PickRow = { id: string; pick_number: number; user_id: string; player_id: string; created_at: string };

export default function DraftPage() {
  const params = useParams<{ id: string }>();
  const leagueId = params?.id;

  const userId = useMemo(() => getOrCreateUserId(), []);
  const myName = useMemo(() => getDisplayName(), []);

  const [league, setLeague] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [order, setOrder] = useState<{ slot: number; user_id: string }[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // initial loads
  useEffect(() => {
    if (!leagueId) return;

    supabase.from("leagues").select("*").eq("id", leagueId).single().then(({ data, error }) => {
      if (error) setError(error.message);
      else setLeague(data);
    });

    supabase
      .from("league_members")
      .select("user_id, display_name, created_at")
      .eq("league_id", leagueId)
      .order("created_at", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setMembers((data || []) as any);
      });

    supabase
      .from("draft_order")
      .select("slot, user_id")
      .eq("league_id", leagueId)
      .order("slot", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setOrder((data || []) as any);
      });

    supabase
      .from("players")
      .select("id, name, pos, nfl_team")
      .order("pos", { ascending: true })
      .order("name", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setPlayers((data || []) as any);
      });

    supabase
      .from("draft_picks")
      .select("id, league_id, pick_number, user_id, player_id, created_at")
      .eq("league_id", leagueId)
      .order("pick_number", { ascending: true })
      .then(({ data, error }) => {
        if (error) setError(error.message);
        else setPicks((data || []) as any);
      });
  }, [leagueId]);

  // realtime picks
  useEffect(() => {
    if (!leagueId) return;

    const channel = supabase
      .channel(`draft-picks-${leagueId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "draft_picks", filter: `league_id=eq.${leagueId}` },
        (payload) => {
          const newPick = payload.new as any as PickRow;
          setPicks((prev) => {
            if (prev.some((p) => p.id === newPick.id)) return prev;
            return [...prev, newPick].sort((a, b) => a.pick_number - b.pick_number);
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

  const draftedPlayerIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);
  const availablePlayers = useMemo(() => players.filter((pl) => !draftedPlayerIds.has(pl.id)), [players, draftedPlayerIds]);

  const nextPickNumber = picks.length + 1;

  function pickOwnerForSnake(pickNumber: number) {
    if (!league?.num_teams) return null;
    const n = league.num_teams as number;
    const round = Math.floor((pickNumber - 1) / n) + 1;
    const idx = ((pickNumber - 1) % n) + 1;
    const slot = round % 2 === 1 ? idx : n - idx + 1;
    const entry = order.find((o) => o.slot === slot);
    return entry?.user_id || null;
  }

  const currentTurnUserId = pickOwnerForSnake(nextPickNumber);
  const myTurn = currentTurnUserId === userId;

  async function setOrderFromJoinOrder() {
    if (!leagueId) return;
  
    const n = members.length;
  
    if (n < 2) {
      alert("Need at least 2 members to set draft order.");
      return;
    }
    if (n > 12) {
      alert("Too many members for this MVP. Keep it to 12 max.");
      return;
    }
  
    setBusy(true);
  
    // clear existing order
    await supabase.from("draft_order").delete().eq("league_id", leagueId);
  
    // set league num_teams to current member count
    const { error: leagueErr } = await supabase
      .from("leagues")
      .update({ num_teams: n })
      .eq("id", leagueId);
  
    if (leagueErr) {
      setBusy(false);
      alert(leagueErr.message);
      return;
    }
  
    const inserts = members.map((m, i) => ({
      league_id: leagueId,
      slot: i + 1,
      user_id: m.user_id,
    }));
  
    const { error } = await supabase.from("draft_order").insert(inserts);
    setBusy(false);
  
    if (error) {
      alert(error.message);
      return;
    }
  
    const { data } = await supabase
      .from("draft_order")
      .select("slot, user_id")
      .eq("league_id", leagueId)
      .order("slot", { ascending: true });
  
    setOrder((data || []) as any);
    setLeague((prev: any) => ({ ...prev, num_teams: n }));
  }
  

  async function startDraft() {
    if (!leagueId) return;
  
    const n = league?.num_teams ?? order.length;
  
    if (!n || n < 2) {
      alert("Need at least 2 teams to start.");
      return;
    }
    if (order.length !== n) {
      alert(`Draft order not set. Expected ${n} slots, found ${order.length}.`);
      return;
    }
  
    setBusy(true);
    const { error } = await supabase
      .from("leagues")
      .update({ draft_status: "draft" })
      .eq("id", leagueId);
    setBusy(false);
  
    if (error) {
      alert(error.message);
      return;
    }
  
    setLeague({ ...league, draft_status: "draft" });
  }
  

  async function draftPlayer(playerId: string) {
    if (!leagueId) return;
    if (!myTurn) {
      alert("Not your turn");
      return;
    }

    setBusy(true);
    const { data, error } = await supabase.rpc("make_pick", {
      p_league_id: leagueId,
      p_user_id: userId,
      p_player_id: playerId,
    });
    setBusy(false);

    if (error) {
      alert(error.message);
      return;
    }

    // the realtime subscription will update picks, but this helps local immediacy
    if (data?.id) {
      // no-op
    }
  }

  async function resetDraft() {
    if (!leagueId) return;
    if (!confirm("Reset draft? This deletes all picks for this league.")) return;
  
    setBusy(true);
    const { error } = await supabase.rpc("reset_draft", { p_league_id: leagueId });
    setBusy(false);
  
    if (error) {
      alert(error.message);
      return;
    }
  
    setPicks([]);
    setLeague((prev: any) => ({ ...prev, draft_status: "lobby" }));
  }
  

  if (!leagueId) return <main style={{ padding: 40 }}>Loading...</main>;
  if (error) return <main style={{ padding: 40 }}>Error: {error}</main>;
  if (!league) return <main style={{ padding: 40 }}>Loading league...</main>;

  const nameByUserId = new Map(members.map((m) => [m.user_id, m.display_name]));

  return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 1100 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{league.name} Draft</h1>
      <p style={{ marginTop: 6, opacity: 0.8 }}>
        You are: <b>{myName || "Player"}</b>
      </p>
      <p style={{ marginTop: 6 }}>
        Draft status: <b>{league.draft_status}</b>
      </p>

      <div style={{ marginTop: 18, display: "flex", gap: 12 }}>
        <button onClick={setOrderFromJoinOrder} disabled={busy}>
          Set order from join order
        </button>
        <button onClick={startDraft} disabled={busy || league.draft_status === "draft"}>
          Start draft
        </button>
        <button onClick={resetDraft} disabled={busy}>
          Reset draft
        </button>
      </div>

      <hr style={{ margin: "20px 0" }} />

      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Draft order</h2>
      <ol style={{ paddingLeft: 18 }}>
        {order.map((o) => (
          <li key={o.slot}>
            Slot {o.slot}: {nameByUserId.get(o.user_id) || o.user_id}{" "}
            {o.user_id === userId ? <span style={{ opacity: 0.6 }}>(you)</span> : null}
          </li>
        ))}
      </ol>

      <p style={{ marginTop: 12 }}>
        Current pick: <b>{nextPickNumber}</b>{" "}
        {currentTurnUserId ? (
          <>
            | On the clock: <b>{nameByUserId.get(currentTurnUserId) || currentTurnUserId}</b>{" "}
            {myTurn ? <span>(you)</span> : null}
          </>
        ) : null}
      </p>

      <hr style={{ margin: "20px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Picks</h2>
          <ol style={{ paddingLeft: 18 }}>
            {picks.map((p) => {
              const pl = players.find((x) => x.id === p.player_id);
              return (
                <li key={p.id}>
                  #{p.pick_number}: <b>{nameByUserId.get(p.user_id) || p.user_id}</b> picked{" "}
                  <b>{pl ? `${pl.name} (${pl.pos}, ${pl.nfl_team})` : p.player_id}</b>
                </li>
              );
            })}
          </ol>
        </div>

        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Available players</h2>
          <p style={{ opacity: 0.7, marginTop: 6 }}>
            You can only draft when it’s your turn. Rules enforced by the database.
          </p>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 10 }}>
            {availablePlayers.map((pl) => (
              <li key={pl.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span>
                  {pl.name} <span style={{ opacity: 0.7 }}>({pl.pos}, {pl.nfl_team})</span>
                </span>
                <button onClick={() => draftPlayer(pl.id)} disabled={!myTurn || busy || league.draft_status !== "draft"}>
                  Draft
                </button>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </main>
  );
}