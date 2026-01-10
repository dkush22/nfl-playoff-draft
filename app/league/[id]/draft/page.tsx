"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";
import { getDisplayName } from "../../../../lib/localUser";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

type Member = { user_id: string; display_name: string };
type Player = { id: string; name: string; pos: "QB" | "RB" | "WR" | "TE"; nfl_team: string };
type PickRow = { id: string; pick_number: number; user_id: string; player_id: string; created_at: string };

type LeagueStatus = "pre_draft" | "draft" | "post_draft";

function statusLabel(status: LeagueStatus) {
  if (status === "draft") return "Draft Live";
  if (status === "post_draft") return "Complete";
  return "Pre-Draft";
}

function posBadge(pos: Player["pos"]) {
  if (pos === "QB") return "QB";
  if (pos === "RB") return "RB";
  if (pos === "WR") return "WR";
  return "TE";
}

export default function DraftPage() {
  const params = useParams<{ id: string }>();
  const leagueId = params?.id;

  // Supabase auth user is the real identity for commissioner + turn logic
  const [authUserId, setAuthUserId] = useState<string | null>(null);
  const myName = useMemo(() => getDisplayName(), []); // UI only for now

  const [league, setLeague] = useState<any>(null);
  const [members, setMembers] = useState<Member[]>([]);
  const [order, setOrder] = useState<{ slot: number; user_id: string }[]>([]);
  const [players, setPlayers] = useState<Player[]>([]);
  const [picks, setPicks] = useState<PickRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [search, setSearch] = useState("");
  const [posFilter, setPosFilter] = useState<"ALL" | Player["pos"]>("ALL");

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
        { event: "*", schema: "public", table: "draft_order", filter: `league_id=eq.${leagueId}` },
        async () => {
          const { data, error } = await supabase
            .from("draft_order")
            .select("slot, user_id")
            .eq("league_id", leagueId)
            .order("slot", { ascending: true });

          if (!error) setOrder((data || []) as any);
        }
      )
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

  const nameByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.display_name])), [members]);

  const leagueStatus = (league?.status as LeagueStatus) ?? "pre_draft";
  const preDraft = leagueStatus === "pre_draft";
  const draftStarted = leagueStatus === "draft";
  const postDraft = leagueStatus === "post_draft";

  const draftedPlayerIds = useMemo(() => new Set(picks.map((p) => p.player_id)), [picks]);

  const availablePlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    return players
      .filter((pl) => !draftedPlayerIds.has(pl.id))
      .filter((pl) => (posFilter === "ALL" ? true : pl.pos === posFilter))
      .filter((pl) => {
        if (!q) return true;
        return (
          pl.name.toLowerCase().includes(q) ||
          pl.nfl_team.toLowerCase().includes(q) ||
          pl.pos.toLowerCase().includes(q)
        );
      });
  }, [players, draftedPlayerIds, search, posFilter]);

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

  if (!leagueId) return <div className="p-10">Loading...</div>;
  if (error) return <div className="p-10">Error: {error}</div>;
  if (!league) return <div className="p-10">Loading league...</div>;

  // Helpful computed views
  const currentOnClockName = currentTurnUserId ? nameByUserId.get(currentTurnUserId) || "Unknown" : null;
  const pickTotal = (league?.num_teams ? Number(league.num_teams) : 0) * 6; // your roster is 6 in MVP
  const pickProgress = pickTotal > 0 ? Math.min(100, Math.round((picks.length / pickTotal) * 100)) : 0;

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-6 py-10 space-y-8">
        {/* Top header */}
        <Card>
          <CardHeader className="space-y-2">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="space-y-1">
                <CardTitle className="text-2xl">{league.name} Draft</CardTitle>
                <div className="flex flex-wrap items-center gap-2">
                  <Badge variant={draftStarted ? "default" : "secondary"}>{statusLabel(leagueStatus)}</Badge>
                  {isCommissioner ? <Badge variant="outline">Commissioner</Badge> : null}
                  <span className="text-sm text-muted-foreground">
                    You are <span className="font-medium text-foreground">{myName || "Player"}</span>
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap gap-2">
                <Button variant="secondary" asChild>
                  <Link href={`/league/${leagueId}`}>Back to League</Link>
                </Button>
              </div>
            </div>
          </CardHeader>

          <CardContent className="space-y-3">
            {preDraft ? (
              <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                Draft is not started. Commissioner must set draft order and start the draft.
              </div>
            ) : null}

            {postDraft ? (
              <div className="rounded-lg border p-3 text-sm text-muted-foreground">
                Draft is complete. This page is now read-only draft results.
              </div>
            ) : null}

            {/* On the clock */}
            {draftStarted ? (
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between rounded-lg border p-3">
                <div className="space-y-1">
                  <div className="text-sm text-muted-foreground">On the clock</div>
                  <div className="text-lg font-semibold">
                    {currentOnClockName ? currentOnClockName : "Waiting…"}{" "}
                    {myTurn ? <span className="text-sm text-muted-foreground">(you)</span> : null}
                  </div>
                </div>

                <div className="text-sm text-muted-foreground">
                  Pick <span className="font-medium text-foreground">#{nextPickNumber}</span>
                  {pickTotal > 0 ? (
                    <>
                      {" "}
                      • {picks.length}/{pickTotal} ({pickProgress}%)
                    </>
                  ) : null}
                </div>
              </div>
            ) : null}

            {/* Commissioner controls */}
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="text-sm text-muted-foreground">
                {isCommissioner
                  ? "Commissioner controls"
                  : "Only the commissioner can set order, start, or reset the draft."}
              </div>

              <div className="flex flex-wrap gap-2">
                {isCommissioner ? (
                  <>
                    <Button
                      variant="secondary"
                      onClick={setOrderFromJoinOrder}
                      disabled={busy || draftStarted || postDraft}
                    >
                      Set order from join order
                    </Button>

                    <Button onClick={startDraft} disabled={busy || draftStarted || postDraft || order.length === 0}>
                      Start draft
                    </Button>

                    <Button variant="destructive" onClick={resetDraft} disabled={busy}>
                      Reset
                    </Button>
                  </>
                ) : null}
              </div>
            </div>
          </CardContent>
        </Card>

        <div className="grid gap-6 lg:grid-cols-3">
          {/* Draft order */}
          <Card className="lg:col-span-1">
            <CardHeader>
              <CardTitle className="text-lg">Draft order</CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {order.length === 0 ? (
                <div className="text-sm text-muted-foreground">Draft order not set yet.</div>
              ) : (
                <div className="space-y-2">
                  {order.map((o) => {
                    const nm = nameByUserId.get(o.user_id) || "Unknown";
                    const isMe = authUserId && o.user_id === authUserId;
                    const isOnClock = draftStarted && currentTurnUserId === o.user_id;

                    return (
                      <div
                        key={o.slot}
                        className={`flex items-center justify-between rounded-md border px-3 py-2 ${
                          isOnClock ? "ring-1 ring-border" : ""
                        }`}
                      >
                        <div className="min-w-0">
                          <div className="text-sm font-medium">
                            <span className="text-muted-foreground">#{o.slot}</span> {nm}{" "}
                            {isMe ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                          </div>
                          {isOnClock ? <div className="text-xs text-muted-foreground">On the clock</div> : null}
                        </div>
                        {isOnClock ? <Badge>Live</Badge> : <Badge variant="secondary">Slot</Badge>}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>

          {/* Picks + Available */}
          <Card className="lg:col-span-2">
            <CardHeader className="space-y-2">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <CardTitle className="text-lg">Draft board</CardTitle>

                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    className="w-full sm:w-64"
                    placeholder="Search players (name, team, pos)"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                  <div className="flex gap-1">
                    <Button
                      variant={posFilter === "ALL" ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setPosFilter("ALL")}
                    >
                      All
                    </Button>
                    <Button
                      variant={posFilter === "QB" ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setPosFilter("QB")}
                    >
                      QB
                    </Button>
                    <Button
                      variant={posFilter === "RB" ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setPosFilter("RB")}
                    >
                      RB
                    </Button>
                    <Button
                      variant={posFilter === "WR" ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setPosFilter("WR")}
                    >
                      WR
                    </Button>
                    <Button
                      variant={posFilter === "TE" ? "default" : "secondary"}
                      size="sm"
                      onClick={() => setPosFilter("TE")}
                    >
                      TE
                    </Button>
                  </div>
                </div>
              </div>

              <Tabs defaultValue="available">
                <TabsList className="grid w-full grid-cols-2">
                  <TabsTrigger value="available">Available</TabsTrigger>
                  <TabsTrigger value="picks">Picks</TabsTrigger>
                </TabsList>

                <TabsContent value="available" className="mt-4">
                  <div className="text-sm text-muted-foreground">
                    {postDraft
                      ? "Draft is complete. Available players are shown for reference only."
                      : draftStarted
                      ? myTurn
                        ? "It’s your turn. Pick wisely."
                        : "Wait for your turn."
                      : "Draft hasn't started yet."}
                  </div>

                  <Separator className="my-4" />

                  {availablePlayers.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No players match that filter.</div>
                  ) : (
                    <div className="space-y-2">
                      {availablePlayers.map((pl) => {
                        const canDraft = draftStarted && !postDraft && myTurn && !busy;

                        return (
                          <div
                            key={pl.id}
                            className="flex flex-col gap-2 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <div className="font-medium truncate">{pl.name}</div>
                                <Badge variant="secondary">{posBadge(pl.pos)}</Badge>
                              </div>
                              <div className="text-xs text-muted-foreground">{pl.nfl_team}</div>
                            </div>

                            <Button
                              onClick={() => draftPlayer(pl.id)}
                              disabled={!canDraft}
                              variant={canDraft ? "default" : "secondary"}
                            >
                              Draft
                            </Button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>

                <TabsContent value="picks" className="mt-4">
                  {picks.length === 0 ? (
                    <div className="text-sm text-muted-foreground">No picks yet.</div>
                  ) : (
                    <div className="space-y-2">
                      {picks.map((p) => {
                        const pl = players.find((x) => x.id === p.player_id);
                        const who = nameByUserId.get(p.user_id) || "Unknown";
                        const isMe = authUserId && p.user_id === authUserId;

                        return (
                          <div
                            key={p.id}
                            className="flex flex-col gap-1 rounded-lg border p-3 sm:flex-row sm:items-center sm:justify-between"
                          >
                            <div className="min-w-0">
                              <div className="text-sm text-muted-foreground">
                                Pick <span className="font-medium text-foreground">#{p.pick_number}</span>
                              </div>
                              <div className="font-medium truncate">
                                {who} {isMe ? <span className="text-xs text-muted-foreground">(you)</span> : null}
                              </div>
                            </div>

                            <div className="text-right">
                              <div className="font-medium">
                                {pl ? pl.name : p.player_id}{" "}
                                {pl ? <Badge variant="secondary" className="ml-2">{posBadge(pl.pos)}</Badge> : null}
                              </div>
                              {pl ? <div className="text-xs text-muted-foreground">{pl.nfl_team}</div> : null}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </TabsContent>
              </Tabs>
            </CardHeader>
          </Card>
        </div>
      </div>
    </div>
  );
}