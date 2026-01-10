"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

type Member = { user_id: string; display_name: string; created_at?: string };
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; nfl_team: string };
type PickRow = { id: string; pick_number: number; user_id: string; player_id: string; created_at: string };

type Standing = { user_id: string; display_name: string; total_points: number };

export default function LeaguePage() {
  const params = useParams<{ id: string }>();
  const leagueId = params?.id;

  const [user, setUser] = useState<{ id: string; email?: string | null } | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [league, setLeague] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [playersById, setPlayersById] = useState<Map<string, Player>>(new Map());
  const [picks, setPicks] = useState<PickRow[]>([]);

  const [standings, setStandings] = useState<Standing[]>([]);
  const [error, setError] = useState<string | null>(null);

  const [nameInput, setNameInput] = useState("");
  const [joining, setJoining] = useState(false);

  const userId = user?.id ?? null;

  const isJoined = useMemo(() => members.some((m) => m.user_id === userId), [members, userId]);
  const myMember = useMemo(() => members.find((m) => m.user_id === userId), [members, userId]);

  const nameByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.display_name])), [members]);

  const leagueStatus = (league?.status as "pre_draft" | "draft" | "post_draft") ?? "pre_draft";
  const leagueFull = useMemo(() => {
    const cap = Number(league?.num_teams ?? 0);
    return cap > 0 && members.length >= cap;
  }, [league?.num_teams, members.length]);

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data, error }) => {
      if (error || !data.user) setUser(null);
      else setUser({ id: data.user.id, email: data.user.email });
      setAuthLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      const u = session?.user;
      setUser(u ? { id: u.id, email: u.email } : null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Load league, members, players map, and picks
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
        else setMembers((data || []) as Member[]);
      });

    supabase
      .from("players")
      .select("id,name,pos,nfl_team")
      .then(({ data, error }) => {
        if (error) {
          console.error(error);
          return;
        }
        const m = new Map<string, Player>();
        for (const p of data || []) m.set(p.id, p as any);
        setPlayersById(m);
      });

    supabase
      .from("draft_picks")
      .select("id, league_id, pick_number, user_id, player_id, created_at")
      .eq("league_id", leagueId)
      .order("pick_number", { ascending: true })
      .then(({ data, error }) => {
        if (error) console.error(error);
        else setPicks((data || []) as any);
      });
  }, [leagueId]);

  // Standings refresh
  async function refreshStandings() {
    if (!leagueId) return;

    const { data, error } = await supabase
      .from("league_team_event_points")
      .select("user_id, fantasy_points")
      .eq("league_id", leagueId);

    if (error) {
      console.error(error);
      return;
    }

    const totals = new Map<string, number>();
    for (const row of data || []) {
      totals.set(row.user_id, (totals.get(row.user_id) || 0) + Number(row.fantasy_points));
    }

    const rows: Standing[] = Array.from(totals.entries()).map(([uid, total_points]) => ({
      user_id: uid,
      display_name: nameByUserId.get(uid) || "Unknown",
      total_points,
    }));

    rows.sort((a, b) => b.total_points - a.total_points);
    setStandings(rows);
  }

  useEffect(() => {
    if (!leagueId) return;
    refreshStandings();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, nameByUserId]);

  // Realtime: league, members, picks, scoring
  useEffect(() => {
    if (!leagueId) return;

    let standingsTimer: any = null;
    const scheduleStandingsRefresh = () => {
      if (standingsTimer) clearTimeout(standingsTimer);
      standingsTimer = setTimeout(() => refreshStandings(), 150);
    };

    const channel = supabase
      .channel(`league-home-live-${leagueId}`)

      // League state changes
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leagues", filter: `id=eq.${leagueId}` },
        (payload) => {
          const updated = payload.new as any;
          setLeague((prev: any) => ({ ...(prev || {}), ...(updated || {}) }));
        }
      )

      // Member joins
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "league_members", filter: `league_id=eq.${leagueId}` },
        (payload) => {
          const newMember = payload.new as any as Member;
          setMembers((prev) => {
            if (prev.some((m) => m.user_id === newMember.user_id)) return prev;
            return [...prev, newMember];
          });
        }
      )

      // Picks update rosters live
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

      // Scoring updates standings live
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "league_team_event_points", filter: `league_id=eq.${leagueId}` },
        () => scheduleStandingsRefresh()
      )
      .subscribe();

    return () => {
      if (standingsTimer) clearTimeout(standingsTimer);
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [leagueId, nameByUserId]);

  async function joinLeague() {
    if (!leagueId || !userId) return;

    const displayName = nameInput.trim();
    if (!displayName) {
      alert("Enter your name");
      return;
    }

    setJoining(true);

    const { error } = await supabase.from("league_members").insert({
      league_id: leagueId,
      user_id: userId,
      display_name: displayName,
    });

    setJoining(false);

    if (error) {
      if (String(error.message).toLowerCase().includes("duplicate")) return;
      alert(error.message);
      return;
    }
  }

  const rosterByUserId = useMemo(() => {
    const map = new Map<string, PickRow[]>();
    for (const p of picks) {
      const arr = map.get(p.user_id) ?? [];
      arr.push(p);
      map.set(p.user_id, arr);
    }
    // already ordered by pick_number, but keep safe
    for (const [uid, arr] of map.entries()) {
      arr.sort((a, b) => a.pick_number - b.pick_number);
      map.set(uid, arr);
    }
    return map;
  }, [picks]);

  if (!leagueId) return <main style={{ padding: 40 }}>Loading...</main>;
  if (error) return <main style={{ padding: 40 }}>Error: {error}</main>;
  if (!league) return <main style={{ padding: 40 }}>Loading league...</main>;
  if (authLoading) return <div style={{ padding: 40 }}>Loading…</div>;

  if (!user) {
    return (
      <main style={{ padding: 40 }}>
        <p>You need to sign in to view this league.</p>
        <a href="/login">Go to login</a>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 980 }}>
      <h1 style={{ fontSize: 28, fontWeight: 700 }}>{league.name}</h1>
      <p style={{ marginTop: 8 }}>
        Status: <b>{leagueStatus}</b> • Teams: <b>{members.length}/{league.num_teams}</b>
      </p>

      <div style={{ marginTop: 10 }}>
        <b>
          <a href={`/league/${leagueId}/draft`}>
            {leagueStatus === "draft" ? "Go to Draft Room" : "View Draft Results"}
          </a>
        </b>
      </div>

      <hr style={{ margin: "24px 0" }} />

      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Standings</h2>
      {standings.length === 0 ? (
        <p style={{ opacity: 0.7 }}>No points yet.</p>
      ) : (
        <ol style={{ marginTop: 10, paddingLeft: 18 }}>
          {standings.map((s) => (
            <li key={s.user_id}>
              <b>{s.display_name}</b>: {s.total_points.toFixed(2)}
            </li>
          ))}
        </ol>
      )}

      <hr style={{ margin: "24px 0" }} />

      <h2 style={{ fontSize: 18, fontWeight: 700 }}>Rosters</h2>

      {!isJoined ? (
        <div style={{ marginTop: 12, display: "flex", gap: 12, flexWrap: "wrap" }}>
          <input
            style={{ padding: 10, width: 280 }}
            placeholder="Your display name"
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
          />
          <button style={{ padding: "10px 14px" }} onClick={joinLeague} disabled={joining || leagueFull}>
            {leagueFull ? "League full" : joining ? "Joining..." : "Join League"}
          </button>
        </div>
      ) : (
        <p style={{ marginTop: 12, opacity: 0.7 }}>
          You’ve joined as <b>{myMember?.display_name || "Player"}</b>.
        </p>
      )}

      <div style={{ marginTop: 12, display: "grid", gridTemplateColumns: "1fr 1fr", gap: 18 }}>
        {members.map((m) => {
          const roster = rosterByUserId.get(m.user_id) || [];
          return (
            <div key={m.user_id} style={{ border: "1px solid #eee", borderRadius: 12, padding: 14 }}>
              <div style={{ display: "flex", justifyContent: "space-between", gap: 10 }}>
                <div style={{ fontWeight: 700 }}>
                  {m.display_name} {m.user_id === userId ? <span style={{ opacity: 0.6 }}>(you)</span> : null}
                </div>
                <div style={{ opacity: 0.7 }}>{roster.length} players</div>
              </div>

              {roster.length === 0 ? (
                <p style={{ marginTop: 10, opacity: 0.7 }}>No picks yet.</p>
              ) : (
                <ol style={{ marginTop: 10, paddingLeft: 18 }}>
                  {roster.map((p) => {
                    const pl = playersById.get(p.player_id);
                    return (
                      <li key={p.id}>
                        {pl ? (
                          <>
                            {pl.name} <span style={{ opacity: 0.7 }}>({pl.pos}, {pl.nfl_team})</span>
                          </>
                        ) : (
                          <span>{p.player_id}</span>
                        )}
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
          );
        })}
      </div>

      {!leagueFull ? (
        <p style={{ marginTop: 22, opacity: 0.7 }}>
          Send this link to friends to join:{" "}
          <code>{typeof window !== "undefined" ? window.location.href : ""}</code>
        </p>
      ) : (
        <p style={{ marginTop: 22, opacity: 0.7 }}>League is full.</p>
      )}
    </main>
  );
}
