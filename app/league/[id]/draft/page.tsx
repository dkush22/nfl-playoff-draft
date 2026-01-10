"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { getDisplayName } from "../../../../lib/localUser";

type Member = { user_id: string; display_name: string };
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; nfl_team: string };
type PickRow = { id: string; pick_number: number; user_id: string; player_id: string; created_at: string };

export default function DraftPage() {
  const params = useParams<{ id: string }>();
  const leagueId = params?.id;

  // Use Supabase auth as the real identity for commissioner + turn logic
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const myName = useMemo(() => getDisplayName(), []); // purely UI for now

  const [league, setLeague] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [order, setOrder] = useState<{ slot: number; user_id: string }[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);


  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error) console.error(error);
      setAuthUserId(data.user?.id ?? null);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setAuthUserId(session?.user?.id ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // initial loads
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


  // realtime: league + draft order + picks
    useEffect(() => {
    if (!leagueId) return;
  
    const channel = supabase
      .channel(`draft-live-${leagueId}`)
  
      // A) Draft status + league updates (start draft, num_teams changes, etc.)
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leagues", filter: `id=eq.${leagueId}` },
        (payload) => {
          const updated = payload.new as any;
          setLeague((prev: any) => ({ ...(prev || {}), ...(updated || {}) }));
        }
      )
  
      // B) Draft order changes (set order deletes + inserts)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "draft_order", filter: `league_id=eq.${leagueId}` },
        async () => {
          // simplest + robust: re-fetch full order
          const { data, error } = await supabase
            .from("draft_order")
            .select("slot, user_id")
            .eq("league_id", leagueId)
            .order("slot", { ascending: true });
  
          if (!error) setOrder((data || []) as any);
        }
      )
  
      // C) Picks inserts (same as before)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "draft_picks", filter: `league_id=eq.${leagueId}` },
        (payload) => {
          const newPick = payload.new as any;
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
  

  const isCommissioner = useMemo(() => {
    if (!authUserId || !league?.commissioner_user_id) return false;
    return String(league.commissioner_user_id) === String(authUserId);
  }, [authUserId, league]);

  const draftedPlayerIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);
  const availablePlayers = useMemo(
    () => players.filter((pl) => !draftedPlayerIds.has(pl.id)),
    [players, draftedPlayerIds]
  );

  type LeagueStatus = "pre_draft" | "draft" | "post_draft";
  const leagueStatus = (league?.status as LeagueStatus) ?? "pre_draft";
  const preDraft = leagueStatus === "pre_draft";
  const draftStarted = leagueStatus === "draft";
  const postDraft = leagueStatus === "post_draft";
  const nextPickNumber = picks.length + 1;

  function pickOwnerForSnake(pickNumber: number) {
    if (!league?.num_teams) return null;
    const n = league.num_teams as number;
    if (!n || n < 1) return null;

    const round = Math.floor((pickNumber - 1) / n) + 1;
    const idx = ((pickNumber - 1) % n) + 1;
    const slot = round % 2 === 1 ? idx : n - idx + 1;
    const entry = order.find((o) => o.slot === slot);
    return entry?.user_id || null;
  }

  const currentTurnUserId = draftStarted ? pickOwnerForSnake(nextPickNumber) : null;
  const myTurn = !!authUserId && !!currentTurnUserId && currentTurnUserId === authUserId;

  async function setOrderFromJoinOrder() {
    if (!leagueId) return;
    if (!isCommissioner) {
      alert("Only the commissioner can set draft order.");
      return;
    }

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

    await supabase.from("draft_order").delete().eq("league_id", leagueId);

    const { error: leagueErr } = await supabase.from("leagues").update({ num_teams: n }).eq("id", leagueId);

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

    if (error) {
      setBusy(false);
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
    setBusy(false);
  }

  async function startDraft() {
    if (!leagueId) return;
    if (!isCommissioner) {
      alert("Only the commissioner can start the draft.");
      return;
    }

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
    const { error } = await supabase.from("leagues").update({ status: "draft" }).eq("id", leagueId);
    setBusy(false);

    if (error) {
      alert(error.message);
      return;
    }

    setLeague({ ...league, status: "draft" });
  }

  async function draftPlayer(playerId: string) {
    if (!leagueId) return;
    if (!draftStarted) {
      alert("Draft hasn't started yet.");
      return;
    }
    if (!authUserId) {
      alert("You must be signed in.");
      return;
    }
    if (!myTurn) {
      alert("Not your turn");
      return;
    }

    setBusy(true);
    const { error } = await supabase.rpc("make_pick", {
      p_league_id: leagueId,
      p_user_id: authUserId,
      p_player_id: playerId,
    });
    setBusy(false);

    if (error) {
      alert(error.message);
    }
  }

  async function resetDraft() {
    if (!leagueId) return;
    if (!isCommissioner) {
      alert("Only the commissioner can reset the draft.");
      return;
    }
    if (!confirm("Reset draft? This deletes all picks for this league.")) return;

    setBusy(true);
    const { error } = await supabase.rpc("reset_draft", { p_league_id: leagueId });
    setBusy(false);

    if (error) {
      alert(error.message);
      return;
    }

    setPicks([]);
    setLeague((prev: any) => ({ ...prev, status: "pre_draft" }));
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
        League status: <b>{leagueStatus}</b>{" "}
        {isCommissioner ? <span style={{ opacity: 0.7 }}>(commissioner)</span> : null}
      </p>

      {!draftStarted ? (
        <p style={{ marginTop: 10, padding: 12, border: "1px solid #eee", borderRadius: 10, opacity: 0.9 }}>
          The draft hasn’t started yet. Once the commissioner sets the draft order and starts the draft, picks will
          appear here.
        </p>
      ) : null}
      {postDraft ? (
        <p style={{ marginTop: 10, padding: 12, border: "1px solid #eee", borderRadius: 10, opacity: 0.9 }}>
            The draft is complete. This page is now read-only draft results.
            </p>
        ) : null}

      {/* Commissioner controls */}
      <div style={{ marginTop: 18, display: "flex", gap: 12, flexWrap: "wrap" }}>
        {isCommissioner ? (
          <>
            <button onClick={setOrderFromJoinOrder} disabled={busy || draftStarted || postDraft}>
              Set order from join order
            </button>
            <button onClick={startDraft} disabled={busy || draftStarted || postDraft}>
              Start draft
            </button>
            <button onClick={resetDraft} disabled={busy}>
              Reset draft
            </button>
          </>
        ) : (
          <div style={{ opacity: 0.75 }}>Only the commissioner can set the order, start, or reset the draft.</div>
        )}
      </div>

      <hr style={{ margin: "20px 0" }} />

      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Draft order</h2>
      {order.length === 0 ? (
        <p style={{ opacity: 0.7 }}>Draft order not set yet.</p>
      ) : (
        <ol style={{ paddingLeft: 18 }}>
          {order.map((o) => (
            <li key={o.slot}>
              Slot {o.slot}: {nameByUserId.get(o.user_id) || o.user_id}{" "}
              {authUserId && o.user_id === authUserId ? <span style={{ opacity: 0.6 }}>(you)</span> : null}
            </li>
          ))}
        </ol>
      )}

      {draftStarted ? (
        <p style={{ marginTop: 12 }}>
          Current pick: <b>{nextPickNumber}</b>{" "}
          {currentTurnUserId ? (
            <>
              | On the clock: <b>{nameByUserId.get(currentTurnUserId) || currentTurnUserId}</b>{" "}
              {myTurn ? <span>(you)</span> : null}
            </>
          ) : null}
        </p>
      ) : null}

      <hr style={{ margin: "20px 0" }} />

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 24 }}>
        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Picks</h2>
          {picks.length === 0 ? (
            <p style={{ opacity: 0.7 }}>No picks yet.</p>
          ) : (
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
          )}
        </div>

        <div>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Available players</h2>
          <p style={{ opacity: 0.7, marginTop: 6 }}>
            {draftStarted
              ? "You can only draft when it’s your turn."
              : "The draft hasn’t started yet. You’ll be able to draft once the commissioner starts it."}
          </p>

          <ul style={{ listStyle: "none", padding: 0, marginTop: 10 }}>
            {availablePlayers.map((pl) => (
              <li key={pl.id} style={{ display: "flex", justifyContent: "space-between", padding: "6px 0" }}>
                <span>
                  {pl.name} <span style={{ opacity: 0.7 }}>({pl.pos}, {pl.nfl_team})</span>
                </span>
                <button onClick={() => draftPlayer(pl.id)} disabled={!draftStarted || postDraft || !myTurn || busy}>
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