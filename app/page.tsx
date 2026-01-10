"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "../lib/supabase";
import AuthStatus from "./components/AuthStatus";

type League = {
  id: string;
  name: string;
  status: string;
  is_public: boolean;
  num_teams: number;
  created_at?: string;
};

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

    return () => {
      sub.subscription.unsubscribe();
    };
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

      // memberships -> league ids
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

      // my leagues
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

      // public leagues (exclude ones already joined)
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

    // 1) create league
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

    // 2) auto-join commissioner with chosen display name
    const { error: joinErr } = await supabase.from("league_members").insert({
      league_id: league.id,
      user_id: userId,
      display_name: dn,
    });

    // If you have a unique index (league_id, user_id), double-click is safe.
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
    return <main style={{ padding: 40, fontFamily: "system-ui" }}>Loading…</main>;
  }

  if (!userId) {
    return (
      <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 900 }}>
        <h1 style={{ fontSize: 28, fontWeight: 700 }}>NFL Playoff Draft</h1>
        <p style={{ marginTop: 8, opacity: 0.8 }}>Sign in to create or join leagues.</p>
        <div style={{ marginTop: 14 }}>
          <Link href="/login">Go to login</Link>
        </div>
      </main>
    );
  }

  return (
    <main style={{ padding: 40, fontFamily: "system-ui", maxWidth: 980 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", gap: 20 }}>
        <div>
          <h1 style={{ fontSize: 28, fontWeight: 700 }}>NFL Playoff Draft</h1>
          <p style={{ marginTop: 6, opacity: 0.7 }}>
            Create a league, invite friends, draft once, and let points accumulate through the playoffs.
          </p>
        </div>
        <AuthStatus />
      </div>

      {/* Create league */}
      <section style={{ marginTop: 22, padding: 16, border: "1px solid #ddd", borderRadius: 10 }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 10 }}>Create a league</h2>

        <div style={{ display: "grid", gap: 10 }}>
          <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
            <input
              style={{ padding: 10, width: 280 }}
              placeholder="League name"
              value={name}
              onChange={(e) => setName(e.target.value)}
            />

            <input
              style={{ padding: 10, width: 220 }}
              placeholder="Your display name"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
            />

            <input
              style={{ padding: 10, width: 140 }}
              type="number"
              min={2}
              max={20}
              value={numTeams}
              onChange={(e) => setNumTeams(parseInt(e.target.value || "7", 10))}
              placeholder="Teams"
            />

            <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} />
              Public
            </label>

            <button
              style={{ padding: "10px 14px" }}
              onClick={createLeague}
              disabled={!canCreate || creating}
              title={!canCreate ? "Enter a league name, your display name, and valid team count" : ""}
            >
              {creating ? "Creating..." : "Create"}
            </button>
          </div>

          <div style={{ fontSize: 13, opacity: 0.75 }}>
            Defaults: 1 QB, 5 Flex (RB/WR/TE). You can make this configurable later.
          </div>
        </div>
      </section>

      {/* Lists */}
      <div style={{ marginTop: 26, display: "grid", gap: 22 }}>
        <section>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <h2 style={{ fontSize: 18, fontWeight: 700 }}>My leagues</h2>
            <button style={{ padding: "6px 10px" }} onClick={() => window.location.reload()} disabled={loadingLists}>
              {loadingLists ? "Refreshing..." : "Refresh"}
            </button>
          </div>

          {myLeagues.length === 0 ? (
            <p style={{ opacity: 0.7 }}>You’re not in any leagues yet.</p>
          ) : (
            <ul style={{ marginTop: 10, paddingLeft: 18 }}>
              {myLeagues.map((l) => (
                <li key={l.id} style={{ marginBottom: 6 }}>
                  <Link href={`/league/${l.id}`}>{l.name}</Link>{" "}
                  <span style={{ opacity: 0.7 }}>
                    ({l.status}, {l.num_teams} teams{l.is_public ? ", public" : ""})
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section>
          <h2 style={{ fontSize: 18, fontWeight: 700 }}>Public leagues</h2>

          {publicLeagues.length === 0 ? (
            <p style={{ opacity: 0.7 }}>No public leagues right now.</p>
          ) : (
            <ul style={{ marginTop: 10, paddingLeft: 18 }}>
              {publicLeagues.map((l) => (
                <li key={l.id} style={{ marginBottom: 6 }}>
                  <Link href={`/league/${l.id}`}>{l.name}</Link>{" "}
                  <span style={{ opacity: 0.7 }}>
                    ({l.status}, {l.num_teams} teams)
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </main>
  );
}