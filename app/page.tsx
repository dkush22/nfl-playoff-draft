"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import AuthStatus from "./components/AuthStatus";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Separator } from "@/components/ui/separator";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type League = {
  id: string;
  name: string;
  status: string;
  is_public: boolean;
  num_teams: number;
  created_at?: string;
};

function statusLabel(status: string) {
  if (status === "pre_draft") return "Pre-draft";
  if (status === "draft") return "Draft";
  if (status === "post_draft") return "Post-draft";
  return status;
}

function statusVariant(status: string): "secondary" | "default" | "outline" {
  if (status === "draft") return "default";
  if (status === "post_draft") return "secondary";
  return "outline";
}

export default function Home() {
  const router = useRouter();

  const [userId, setUserId] = useState<string | null>(null);
  const [authLoading, setAuthLoading] = useState(true);

  const [myLeagues, setMyLeagues] = useState<League[]>([]);
  const [publicLeagues, setPublicLeagues] = useState<League[]>([]);
  const [loadingLists, setLoadingLists] = useState(false);

  const [name, setName] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [numTeams, setNumTeams] = useState(7);
  const [isPublic, setIsPublic] = useState(false);
  const [creating, setCreating] = useState(false);

  const canCreate = useMemo(() => {
    return (
      !!userId &&
      name.trim().length > 0 &&
      displayName.trim().length > 0 &&
      Number.isFinite(numTeams) &&
      numTeams >= 2 &&
      numTeams <= 20
    );
  }, [userId, name, displayName, numTeams]);

  // Auth
  useEffect(() => {
    supabase.auth.getUser().then(({ data }) => {
      setUserId(data.user?.id ?? null);
      setAuthLoading(false);
    });

    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      setUserId(session?.user?.id ?? null);
    });

    return () => sub.subscription.unsubscribe();
  }, []);

  // Load leagues (my + public)
  useEffect(() => {
    if (!userId) {
      setMyLeagues([]);
      setPublicLeagues([]);
      return;
    }

    async function load() {
      setLoadingLists(true);

      const { data: mems, error: memErr } = await supabase
        .from("league_members")
        .select("league_id")
        .eq("user_id", userId);

      if (memErr) {
        console.error(memErr);
        setLoadingLists(false);
        return;
      }

      const leagueIds = (mems || []).map((m) => m.league_id as string);

      // My leagues
      if (leagueIds.length > 0) {
        const { data: leagues, error: leaguesErr } = await supabase
          .from("leagues")
          .select("id,name,status,is_public,num_teams,created_at")
          .in("id", leagueIds)
          .order("created_at", { ascending: false });

        if (leaguesErr) console.error(leaguesErr);
        else setMyLeagues((leagues || []) as League[]);
      } else {
        setMyLeagues([]);
      }

      // Public leagues (exclude ones already joined)
      const { data: pubs, error: pubsErr } = await supabase
        .from("leagues")
        .select("id,name,status,is_public,num_teams,created_at")
        .eq("is_public", true)
        .order("created_at", { ascending: false })
        .limit(50);

      if (pubsErr) console.error(pubsErr);
      else {
        const filtered = (pubs || []).filter((l) => !leagueIds.includes(l.id));
        setPublicLeagues(filtered as League[]);
      }

      setLoadingLists(false);
    }

    load();
  }, [userId]);

  async function createLeague() {
    if (!userId) return;

    const leagueName = name.trim();
    const dn = displayName.trim();
    if (!leagueName || !dn) return;

    setCreating(true);

    const { data: league, error: leagueErr } = await supabase
      .from("leagues")
      .insert({
        name: leagueName,
        status: "pre_draft",
        commissioner_user_id: userId,
        is_public: isPublic,
        num_teams: numTeams,
        roster_qb: 1,
        roster_flex: 5,
      })
      .select()
      .single();

    if (leagueErr) {
      setCreating(false);
      alert(leagueErr.message);
      return;
    }

    const { error: joinErr } = await supabase.from("league_members").insert({
      league_id: league.id,
      user_id: userId,
      display_name: dn,
    });

    if (joinErr && !String(joinErr.message).toLowerCase().includes("duplicate")) {
      console.error(joinErr);
      alert(joinErr.message);
      setCreating(false);
      return;
    }

    setCreating(false);
    setName("");
    setDisplayName("");
    router.push(`/league/${league.id}`);
  }

  if (authLoading) {
    return (
      <main className="min-h-screen bg-background">
        <div className="mx-auto max-w-5xl px-6 py-10">
          <Card>
            <CardHeader>
              <CardTitle>Loading</CardTitle>
              <CardDescription>Getting things ready…</CardDescription>
            </CardHeader>
            <CardContent>
              <div className="h-10 w-full rounded-md bg-muted" />
            </CardContent>
          </Card>
        </div>
      </main>
    );
  }

  if (!userId) {
    return (
      <main className="min-h-screen bg-background">
        {/* Hero Section */}
        <div className="relative overflow-hidden gradient-field py-20">
          <div className="absolute inset-0 bg-[url('/grid.svg')] bg-center opacity-10"></div>
          <div className="relative mx-auto max-w-5xl px-6 text-center">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-primary-foreground/20 bg-primary-foreground/10 px-3 py-1 text-sm text-primary-foreground">
              <span>🏈</span>
              <span>NFL Playoff Fantasy</span>
            </div>
            <h1 className="text-5xl font-bold tracking-tight text-primary-foreground sm:text-6xl mb-6">
              NFL Playoff Draft
            </h1>
            <p className="text-xl text-primary-foreground/90 mb-8 max-w-2xl mx-auto">
              Create a league, invite friends, draft once, and let points accumulate through the playoffs.
            </p>
            <Button asChild size="lg" className="bg-secondary hover:bg-secondary/90 text-secondary-foreground shadow-xl">
              <Link href="/login">Get Started</Link>
            </Button>
          </div>
        </div>

        {/* Features */}
        <div className="mx-auto max-w-6xl px-6 py-16">
          <div className="grid gap-6 md:grid-cols-3">
            <Card className="card-hover">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">⚡</span>
                  Quick Setup
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Create a league in seconds. Set your team size, draft settings, and invite your friends.
                </p>
              </CardContent>
            </Card>

            <Card className="card-hover">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">🎯</span>
                  Live Scoring
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Real-time updates as your players score. Watch the standings change with every touchdown.
                </p>
              </CardContent>
            </Card>

            <Card className="card-hover">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span className="text-2xl">🏆</span>
                  Playoff Action
                </CardTitle>
              </CardHeader>
              <CardContent>
                <p className="text-sm text-muted-foreground">
                  Draft once and compete through the entire NFL playoff season. May the best team win!
                </p>
              </CardContent>
            </Card>
          </div>

          <div className="mt-12 text-center">
            <Card className="glass-effect">
              <CardHeader>
                <CardTitle>Ready to compete?</CardTitle>
                <CardDescription>Sign in to create or join a league</CardDescription>
              </CardHeader>
              <CardContent>
                <Button asChild className="gradient-field text-primary-foreground">
                  <Link href="/login">Sign in to continue</Link>
                </Button>
              </CardContent>
            </Card>
          </div>
        </div>
      </main>
    );
  }

  return (
    <main className="min-h-screen bg-background">
      {/* Hero Banner */}
      <div className="gradient-field py-12 mb-10">
        <div className="mx-auto max-w-6xl px-6">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div>
              <h1 className="text-4xl font-bold tracking-tight text-primary-foreground mb-2">
                Your Leagues
              </h1>
              <p className="text-primary-foreground/80">
                Manage your fantasy playoff leagues and track your teams
              </p>
            </div>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-6xl px-6 -mt-6 pb-16">
        {/* Create league */}
        <Card className="shadow-xl border-2">
          <CardHeader>
            <CardTitle>Create a league</CardTitle>
            <CardDescription>Set the basics now. You can make rules configurable later.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-12">
              <div className="space-y-2 lg:col-span-4">
                <Label htmlFor="leagueName">League name</Label>
                <Input
                  id="leagueName"
                  placeholder="e.g. Danny’s Degens"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
              </div>

              <div className="space-y-2 lg:col-span-4">
                <Label htmlFor="displayName">Your display name</Label>
                <Input
                  id="displayName"
                  placeholder="e.g. Danny K"
                  value={displayName}
                  onChange={(e) => setDisplayName(e.target.value)}
                />
              </div>

              <div className="space-y-2 lg:col-span-2">
                <Label htmlFor="numTeams">Teams</Label>
                <Input
                  id="numTeams"
                  type="number"
                  min={2}
                  max={20}
                  value={numTeams}
                  onChange={(e) => setNumTeams(parseInt(e.target.value || "7", 10))}
                />
              </div>

              <div className="flex items-end lg:col-span-2">
              <div className="grid gap-2 lg:col-span-2">
  <div className="flex items-center justify-between">
    <Label className="text-sm">Visibility</Label>
    <span className="text-xs text-muted-foreground">
      {isPublic ? "Public" : "Private"}
    </span>
  </div>

  <div className="inline-flex w-full overflow-hidden rounded-md border bg-background">
    <button
      type="button"
      onClick={() => setIsPublic(false)}
      className={[
        "flex-1 px-3 py-2 text-sm font-medium transition",
        !isPublic ? "bg-muted" : "hover:bg-muted/50",
      ].join(" ")}
      aria-pressed={!isPublic}
    >
      Private league
    </button>

    <div className="w-px bg-border" />

    <button
      type="button"
      onClick={() => setIsPublic(true)}
      className={[
        "flex-1 px-3 py-2 text-sm font-medium transition",
        isPublic ? "bg-muted" : "hover:bg-muted/50",
      ].join(" ")}
      aria-pressed={isPublic}
    >
      Public league
    </button>
  </div>

  <p className="text-xs text-muted-foreground">
    {isPublic
      ? "Anyone can find and join this league."
      : "Only people with the invite link can join."}
  </p>
</div>
</div>

              <div className="lg:col-span-12">
                <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
                  <p className="text-sm text-muted-foreground">
                    Defaults: 1 QB, 5 Flex (RB/WR/TE). Max per NFL team enforced in the draft RPC.
                  </p>
                  <Button
                    onClick={createLeague}
                    disabled={!canCreate || creating}
                    className="md:w-auto"
                    title={!canCreate ? "Enter league name, display name, and a valid team count" : ""}
                  >
                    {creating ? "Creating…" : "Create league"}
                  </Button>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Lists */}
        <div className="mt-10">
          <div className="flex items-center justify-between">
            <h2 className="text-xl font-semibold tracking-tight">Leagues</h2>
            <Button variant="outline" onClick={() => window.location.reload()} disabled={loadingLists}>
              {loadingLists ? "Refreshing…" : "Refresh"}
            </Button>
          </div>

          <Tabs defaultValue="my" className="mt-4">
            <TabsList>
              <TabsTrigger value="my">My leagues</TabsTrigger>
              <TabsTrigger value="public">Public leagues</TabsTrigger>
            </TabsList>

            <TabsContent value="my" className="mt-4">
              {myLeagues.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">No leagues yet</CardTitle>
                    <CardDescription>Create one above or join a public league.</CardDescription>
                  </CardHeader>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {myLeagues.map((l) => (
                    <Card key={l.id} className="card-hover border-2">
                      <CardHeader className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="text-base">
                            <Link href={`/league/${l.id}`} className="hover:text-primary transition-colors">
                              {l.name}
                            </Link>
                          </CardTitle>
                          <Badge variant={statusVariant(l.status)} className="shrink-0">
                            {statusLabel(l.status)}
                          </Badge>
                        </div>
                        <CardDescription className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{l.num_teams} teams</span>
                          <span className="text-muted-foreground">•</span>
                          <span>{l.is_public ? "🌐 Public" : "🔒 Private"}</span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent>
                        <Button asChild className="w-full gradient-field text-primary-foreground">
                          <Link href={`/league/${l.id}`}>Open league</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>

            <TabsContent value="public" className="mt-4">
              {publicLeagues.length === 0 ? (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-base">No public leagues</CardTitle>
                    <CardDescription>Ask a friend to set their league to public, or create one.</CardDescription>
                  </CardHeader>
                </Card>
              ) : (
                <div className="grid gap-4 md:grid-cols-2">
                  {publicLeagues.map((l) => (
                    <Card key={l.id} className="card-hover border-2">
                      <CardHeader className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <CardTitle className="text-base">
                            <Link href={`/league/${l.id}`} className="hover:text-primary transition-colors">
                              {l.name}
                            </Link>
                          </CardTitle>
                          <Badge variant={statusVariant(l.status)} className="shrink-0">
                            {statusLabel(l.status)}
                          </Badge>
                        </div>
                        <CardDescription className="flex flex-wrap items-center gap-2">
                          <span className="font-medium">{l.num_teams} teams</span>
                          <span className="text-muted-foreground">•</span>
                          <span>🌐 Public</span>
                        </CardDescription>
                      </CardHeader>
                      <CardContent className="flex items-center gap-2">
                        <Button asChild variant="outline" className="w-full">
                          <Link href={`/league/${l.id}`}>View</Link>
                        </Button>
                        <Button asChild className="w-full gradient-gold text-foreground">
                          <Link href={`/league/${l.id}`}>Join</Link>
                        </Button>
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          </Tabs>
        </div>

        <p className="mt-10 text-xs text-muted-foreground">
          Note: “Join” currently just takes you to the league page where you enter your display name.
        </p>
      </div>
    </main>
  );
}