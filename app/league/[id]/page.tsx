"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../lib/supabase";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";

type Member = { user_id: string; display_name: string; created_at?: string };
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; nfl_team: string; espn_athlete_id?: string };
type PickRow = { id: string; pick_number: number; user_id: string; player_id: string; created_at: string };
type Standing = { user_id: string; display_name: string; total_points: number };
type PlayerPoints = { player_id: string; player_name: string; pos: string; nfl_team: string; total_points: number };

function statusLabel(status: string) {
  if (status === "draft") return "Draft Live";
  if (status === "post_draft") return "Season Live";
  return "Lobby";
}

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

  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set());
  const [playerPointsByUserId, setPlayerPointsByUserId] = useState<Map<string, PlayerPoints[]>>(new Map());

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

  const shareUrl = useMemo(() => {
    if (typeof window === "undefined") return "";
    return window.location.href;
  }, []);

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

  // Fetch player-level points for a specific user
  async function fetchPlayerPoints(targetUserId: string) {
    if (!leagueId) return;

    // Get all draft picks for this user in this league
    const { data: userPicks, error: picksError } = await supabase
      .from("draft_picks")
      .select("player_id")
      .eq("league_id", leagueId)
      .eq("user_id", targetUserId);

    if (picksError || !userPicks || userPicks.length === 0) {
      console.error(picksError);
      setPlayerPointsByUserId((prev) => new Map(prev).set(targetUserId, []));
      return;
    }

    const playerIds = userPicks.map((p) => p.player_id);

    // Get player info including espn_athlete_id
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, name, pos, nfl_team, espn_athlete_id")
      .in("id", playerIds);

    if (playersError || !players) {
      console.error(playersError);
      return;
    }

    // Build map of espn_athlete_id to player info
    const playerInfoMap = new Map(
      players.map((p) => [p.espn_athlete_id, { id: p.id, name: p.name, pos: p.pos, nfl_team: p.nfl_team }])
    );

    const athleteIds = players.map((p) => p.espn_athlete_id).filter(Boolean);

    if (athleteIds.length === 0) {
      setPlayerPointsByUserId((prev) => new Map(prev).set(targetUserId, []));
      return;
    }

    // Get all event points for these players
    const { data: eventPoints, error: pointsError } = await supabase
      .from("player_event_points")
      .select("espn_athlete_id, fantasy_points")
      .in("espn_athlete_id", athleteIds);

    if (pointsError) {
      console.error(pointsError);
      return;
    }

    // Aggregate points by player
    const pointsByAthleteId = new Map<string, number>();
    for (const row of eventPoints || []) {
      const current = pointsByAthleteId.get(row.espn_athlete_id) || 0;
      pointsByAthleteId.set(row.espn_athlete_id, current + Number(row.fantasy_points));
    }

    // Build final array
    const playerPointsArray: PlayerPoints[] = [];
    for (const [athleteId, totalPoints] of pointsByAthleteId.entries()) {
      const info = playerInfoMap.get(athleteId);
      if (info) {
        playerPointsArray.push({
          player_id: info.id,
          player_name: info.name,
          pos: info.pos,
          nfl_team: info.nfl_team,
          total_points: totalPoints,
        });
      }
    }

    // Sort by points descending
    playerPointsArray.sort((a, b) => b.total_points - a.total_points);

    setPlayerPointsByUserId((prev) => new Map(prev).set(targetUserId, playerPointsArray));
  }

  useEffect(() => {
    if (!leagueId) return;
    refreshStandings();
  }, [leagueId]);

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
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "leagues", filter: `id=eq.${leagueId}` },
        (payload) => {
          const updated = payload.new as any;
          setLeague((prev: any) => ({ ...(prev || {}), ...(updated || {}) }));
        }
      )
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
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "league_team_event_points", filter: `league_id=eq.${leagueId}` },
        () => scheduleStandingsRefresh()
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "player_event_points" },
        () => {
          // Refresh player points for all expanded teams
          expandedTeams.forEach((userId) => {
            fetchPlayerPoints(userId);
          });
        }
      )
      .subscribe();

    return () => {
      if (standingsTimer) clearTimeout(standingsTimer);
      supabase.removeChannel(channel);
    };
  }, [leagueId]);

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
    for (const [uid, arr] of map.entries()) {
      arr.sort((a, b) => a.pick_number - b.pick_number);
      map.set(uid, arr);
    }
    return map;
  }, [picks]);

  const rosterCountForUser = (uid: string) => (rosterByUserId.get(uid) || []).length;

  if (!leagueId) return <div className="p-10">Loading...</div>;
  if (error) return <div className="p-10">Error: {error}</div>;
  if (!league) return <div className="p-10">Loading league...</div>;
  if (authLoading) return <div className="p-10">Loading…</div>;

  if (!user) {
    return (
      <div className="p-10">
        <Card className="max-w-lg">
          <CardHeader>
            <CardTitle>Sign in required</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-muted-foreground">You need to sign in to view this league.</p>
            <Button asChild>
              <Link href="/login">Go to login</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Header */}
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-2xl">{league.name}</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant="secondary">{statusLabel(leagueStatus)}</Badge>
                  <span className="text-sm text-muted-foreground">
                    Teams: <span className="font-medium text-foreground">{members.length}</span>/
                    <span className="font-medium text-foreground">{league.num_teams}</span>
                  </span>
                  {leagueFull ? <Badge variant="outline">Full</Badge> : <Badge variant="outline">Open</Badge>}
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button asChild>
                  <Link href={`/league/${leagueId}/draft`}>
                    {leagueStatus === "draft" ? "Go to Draft Room" : "View Draft Results"}
                  </Link>
                </Button>

                {!leagueFull && (
                  <Button
                    variant="secondary"
                    onClick={async () => {
                      try {
                        await navigator.clipboard.writeText(shareUrl);
                        alert("Invite link copied");
                      } catch {
                        alert("Couldn’t copy. You can copy the URL from the address bar.");
                      }
                    }}
                  >
                    Copy invite link
                  </Button>
                )}
              </div>
            </div>
          </CardHeader>

          {!leagueFull && (
            <CardContent>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <p className="text-sm text-muted-foreground">
                  Invite friends before the league fills. Once full, invites disappear.
                </p>
                <p className="text-xs text-muted-foreground">
                  League ID: <span className="font-mono">{league.id}</span>
                </p>
              </div>
            </CardContent>
          )}
        </Card>

        {/* Two-column: Standings + Join */}
        <div className="grid gap-6 md:grid-cols-3">
          <Card className="md:col-span-2">
            <CardHeader>
              <CardTitle className="text-lg">Standings</CardTitle>
            </CardHeader>
            <CardContent>
              {standings.length === 0 ? (
                <div className="text-sm text-muted-foreground">No points yet.</div>
              ) : (
                <div className="space-y-3">
                  {standings.map((s, idx) => {
                    const isExpanded = expandedTeams.has(s.user_id);
                    const playerPoints = playerPointsByUserId.get(s.user_id) || [];

                    return (
                      <div key={s.user_id} className="rounded-lg border">
                        <button
                          className="w-full flex items-center justify-between p-3 hover:bg-muted/50 transition-colors"
                          onClick={() => {
                            const newExpanded = new Set(expandedTeams);
                            if (isExpanded) {
                              newExpanded.delete(s.user_id);
                            } else {
                              newExpanded.add(s.user_id);
                              // Fetch player points if not already loaded
                              if (!playerPointsByUserId.has(s.user_id)) {
                                fetchPlayerPoints(s.user_id);
                              }
                            }
                            setExpandedTeams(newExpanded);
                          }}
                        >
                          <div className="flex items-center gap-3">
                            <div className="flex h-8 w-8 items-center justify-center rounded-full border text-sm font-semibold">
                              {idx + 1}
                            </div>
                            <div className="leading-tight text-left">
                              <div className="font-medium">
                                {s.display_name}{" "}
                                {s.user_id === userId ? (
                                  <span className="text-xs text-muted-foreground">(you)</span>
                                ) : null}
                              </div>
                              <div className="text-xs text-muted-foreground">
                                Roster: {rosterCountForUser(s.user_id)} players
                              </div>
                            </div>
                          </div>

                          <div className="flex items-center gap-3">
                            <div className="text-right">
                              <div className="text-lg font-semibold tabular-nums">{s.total_points.toFixed(2)}</div>
                              <div className="text-xs text-muted-foreground">points</div>
                            </div>
                            <svg
                              className={`w-5 h-5 transition-transform ${isExpanded ? "rotate-180" : ""}`}
                              fill="none"
                              stroke="currentColor"
                              viewBox="0 0 24 24"
                            >
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                            </svg>
                          </div>
                        </button>

                        {isExpanded && (
                          <div className="border-t px-3 py-2 bg-muted/20">
                            {playerPoints.length === 0 ? (
                              <div className="text-sm text-muted-foreground py-2">No player points yet.</div>
                            ) : (
                              <div className="space-y-1">
                                {playerPoints.map((pp) => (
                                  <div
                                    key={pp.player_id}
                                    className="flex items-center justify-between py-2 px-2 rounded hover:bg-muted/50"
                                  >
                                    <div className="flex items-center gap-2 min-w-0">
                                      <Badge variant="outline" className="text-xs shrink-0">
                                        {pp.pos}
                                      </Badge>
                                      <div className="min-w-0">
                                        <div className="text-sm font-medium truncate">{pp.player_name}</div>
                                        <div className="text-xs text-muted-foreground">{pp.nfl_team}</div>
                                      </div>
                                    </div>
                                    <div className="text-sm font-semibold tabular-nums ml-2">
                                      {pp.total_points.toFixed(2)}
                                    </div>
                                  </div>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-lg">{isJoined ? "You’re in" : "Join this league"}</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {isJoined ? (
                <div className="space-y-2">
                  <p className="text-sm text-muted-foreground">
                    Joined as <span className="font-medium text-foreground">{myMember?.display_name || "Player"}</span>.
                  </p>
                  <Separator />
                  <p className="text-xs text-muted-foreground">
                    Tip: open the Draft Room to see live picks and draft order.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-sm text-muted-foreground">
                    Pick a display name. You can change it later (we’ll add that).
                  </p>
                  <div className="space-y-2">
                    <Input
                      placeholder="Your display name"
                      value={nameInput}
                      onChange={(e) => setNameInput(e.target.value)}
                      disabled={joining || leagueFull}
                    />
                    <Button className="w-full" onClick={joinLeague} disabled={joining || leagueFull}>
                      {leagueFull ? "League full" : joining ? "Joining..." : "Join League"}
                    </Button>
                  </div>
                </>
              )}

              {leagueFull && !isJoined ? (
                <p className="text-xs text-muted-foreground">This league is full. Ask the commissioner to open spots.</p>
              ) : null}
            </CardContent>
          </Card>
        </div>

        {/* Rosters */}
        <Card>
          <CardHeader className="space-y-1">
            <CardTitle className="text-lg">Rosters</CardTitle>
            <p className="text-sm text-muted-foreground">
              Each team’s drafted players. Updates live as picks come in.
            </p>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {members.map((m) => {
                const roster = rosterByUserId.get(m.user_id) || [];
                const isMe = m.user_id === userId;

                return (
                  <Card key={m.user_id} className="overflow-hidden">
                    <CardHeader className="pb-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="font-semibold leading-tight">
                            {m.display_name}{" "}
                            {isMe ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {roster.length} player{roster.length === 1 ? "" : "s"}
                          </div>
                        </div>
                        <Badge variant="secondary">{roster.length}</Badge>
                      </div>
                    </CardHeader>

                    <CardContent className="pt-0">
                      {roster.length === 0 ? (
                        <div className="text-sm text-muted-foreground">No picks yet.</div>
                      ) : (
                        <div className="space-y-2">
                          {roster.map((p) => {
                            const pl = playersById.get(p.player_id);
                            const label = pl ? `${pl.name}` : p.player_id;
                            const meta = pl ? `${pl.pos} • ${pl.nfl_team}` : "";

                            return (
                              <div key={p.id} className="flex items-center justify-between rounded-md border px-3 py-2">
                                <div className="min-w-0">
                                  <div className="truncate text-sm font-medium">{label}</div>
                                  {meta ? <div className="text-xs text-muted-foreground">{meta}</div> : null}
                                </div>
                                <div className="ml-3 text-xs text-muted-foreground tabular-nums">#{p.pick_number}</div>
                              </div>
                            );
                          })}
                        </div>
                      )}
                    </CardContent>
                  </Card>
                );
              })}
            </div>

            {/* Invite link (hidden once full) */}
            {!leagueFull ? (
              <div className="mt-6 rounded-lg border p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="text-sm">
                    <div className="font-medium">Invite link</div>
                    <div className="text-xs text-muted-foreground">Share this until the league is full.</div>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                    <code className="max-w-[520px] truncate rounded-md bg-muted px-3 py-2 text-xs">{shareUrl}</code>
                    <Button
                      variant="secondary"
                      onClick={async () => {
                        try {
                          await navigator.clipboard.writeText(shareUrl);
                          alert("Invite link copied");
                        } catch {
                          alert("Couldn’t copy. You can copy the URL from the address bar.");
                        }
                      }}
                    >
                      Copy
                    </Button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="mt-6 rounded-lg border p-4 text-sm text-muted-foreground">League is full.</div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
