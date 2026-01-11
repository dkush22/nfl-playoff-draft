"use client";

import { useEffect, useState, useMemo } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { supabase } from "../../../../lib/supabase";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

type Standing = { user_id: string; display_name: string; total_points: number };
type Member = { user_id: string; display_name: string };

type PlayerStat = {
  player_id: string;
  player_name: string;
  pos: string;
  nfl_team: string;
  owner_id: string;
  owner_name: string;
  fantasy_points: number;
  passing_yards: number;
  passing_tds: number;
  interceptions: number;
  rushing_yards: number;
  rushing_tds: number;
  receiving_yards: number;
  receiving_tds: number;
  receptions: number;
  fumbles_lost: number;
};

export default function StandingsPage() {
  const params = useParams<{ id: string }>();
  const leagueId = params?.id;

  const [standings, setStandings] = useState<Standing[]>([]);
  const [playerStats, setPlayerStats] = useState<PlayerStat[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [loading, setLoading] = useState(true);
  const [sortBy, setSortBy] = useState<keyof PlayerStat>("fantasy_points");
  const [sortDesc, setSortDesc] = useState(true);
  const [filterPos, setFilterPos] = useState<string>("ALL");

  const nameByUserId = useMemo(() => new Map(members.map((m) => [m.user_id, m.display_name])), [members]);

  // Fetch team standings
  async function fetchStandings() {
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

  // Fetch all player stats
  async function fetchPlayerStats() {
    if (!leagueId) return;

    // Get all draft picks for this league
    const { data: picks, error: picksError } = await supabase
      .from("draft_picks")
      .select("player_id, user_id")
      .eq("league_id", leagueId);

    if (picksError || !picks) {
      console.error(picksError);
      return;
    }

    const playerIds = picks.map((p) => p.player_id);
    const ownerMap = new Map(picks.map((p) => [p.player_id, p.user_id]));

    // Get player info
    const { data: players, error: playersError } = await supabase
      .from("players")
      .select("id, name, pos, nfl_team, espn_athlete_id")
      .in("id", playerIds);

    if (playersError || !players) {
      console.error(playersError);
      return;
    }

    const playerInfoMap = new Map(
      players.map((p) => [
        p.espn_athlete_id,
        { id: p.id, name: p.name, pos: p.pos, nfl_team: p.nfl_team },
      ])
    );

    const athleteIds = players.map((p) => p.espn_athlete_id).filter(Boolean);

    if (athleteIds.length === 0) {
      setPlayerStats([]);
      return;
    }

    // Get fantasy points
    const { data: pointsData, error: pointsError } = await supabase
      .from("player_event_points")
      .select("espn_athlete_id, fantasy_points")
      .in("espn_athlete_id", athleteIds);

    if (pointsError) {
      console.error(pointsError);
    }

    const pointsByAthlete = new Map<string, number>();
    for (const row of pointsData || []) {
      const current = pointsByAthlete.get(row.espn_athlete_id) || 0;
      pointsByAthlete.set(row.espn_athlete_id, current + Number(row.fantasy_points));
    }

    // Get stats
    const { data: statsData, error: statsError } = await supabase
      .from("player_event_stats")
      .select("*")
      .in("espn_athlete_id", athleteIds);

    if (statsError) {
      console.error(statsError);
    }

    // Aggregate stats by player
    const statsByAthlete = new Map<string, Partial<PlayerStat>>();
    for (const row of statsData || []) {
      const current = statsByAthlete.get(row.espn_athlete_id) || {
        passing_yards: 0,
        passing_tds: 0,
        interceptions: 0,
        rushing_yards: 0,
        rushing_tds: 0,
        receiving_yards: 0,
        receiving_tds: 0,
        receptions: 0,
        fumbles_lost: 0,
      };

      statsByAthlete.set(row.espn_athlete_id, {
        passing_yards: (current.passing_yards || 0) + Number(row.passing_yards || 0),
        passing_tds: (current.passing_tds || 0) + Number(row.passing_tds || 0),
        interceptions: (current.interceptions || 0) + Number(row.interceptions || 0),
        rushing_yards: (current.rushing_yards || 0) + Number(row.rushing_yards || 0),
        rushing_tds: (current.rushing_tds || 0) + Number(row.rushing_tds || 0),
        receiving_yards: (current.receiving_yards || 0) + Number(row.receiving_yards || 0),
        receiving_tds: (current.receiving_tds || 0) + Number(row.receiving_tds || 0),
        receptions: (current.receptions || 0) + Number(row.receptions || 0),
        fumbles_lost: (current.fumbles_lost || 0) + Number(row.fumbles_lost || 0),
      });
    }

    // Build final array
    const allStats: PlayerStat[] = [];
    for (const [athleteId, info] of playerInfoMap.entries()) {
      const stats = statsByAthlete.get(athleteId) || {};
      const points = pointsByAthlete.get(athleteId) || 0;
      const ownerId = ownerMap.get(info.id) || "";

      allStats.push({
        player_id: info.id,
        player_name: info.name,
        pos: info.pos,
        nfl_team: info.nfl_team,
        owner_id: ownerId,
        owner_name: nameByUserId.get(ownerId) || "Unknown",
        fantasy_points: points,
        passing_yards: stats.passing_yards || 0,
        passing_tds: stats.passing_tds || 0,
        interceptions: stats.interceptions || 0,
        rushing_yards: stats.rushing_yards || 0,
        rushing_tds: stats.rushing_tds || 0,
        receiving_yards: stats.receiving_yards || 0,
        receiving_tds: stats.receiving_tds || 0,
        receptions: stats.receptions || 0,
        fumbles_lost: stats.fumbles_lost || 0,
      });
    }

    setPlayerStats(allStats);
  }

  // Load members
  useEffect(() => {
    if (!leagueId) return;

    supabase
      .from("league_members")
      .select("user_id, display_name")
      .eq("league_id", leagueId)
      .then(({ data, error }) => {
        if (error) console.error(error);
        else setMembers((data || []) as Member[]);
      });
  }, [leagueId]);

  // Load data when members are ready
  useEffect(() => {
    if (!leagueId || members.length === 0) return;

    setLoading(true);
    Promise.all([fetchStandings(), fetchPlayerStats()]).then(() => {
      setLoading(false);
    });
  }, [leagueId, members]);

  const sortedAndFilteredStats = useMemo(() => {
    let filtered = [...playerStats];

    if (filterPos !== "ALL") {
      filtered = filtered.filter((p) => p.pos === filterPos);
    }

    filtered.sort((a, b) => {
      const aVal = a[sortBy];
      const bVal = b[sortBy];
      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortDesc ? bVal - aVal : aVal - bVal;
      }
      if (typeof aVal === "string" && typeof bVal === "string") {
        return sortDesc ? bVal.localeCompare(aVal) : aVal.localeCompare(bVal);
      }
      return 0;
    });

    return filtered;
  }, [playerStats, sortBy, sortDesc, filterPos]);

  const handleSort = (key: keyof PlayerStat) => {
    if (sortBy === key) {
      setSortDesc(!sortDesc);
    } else {
      setSortBy(key);
      setSortDesc(true);
    }
  };

  if (!leagueId) return <div className="p-10">Loading...</div>;

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <div className="gradient-field py-8 mb-8">
        <div className="mx-auto max-w-7xl px-6">
          <div className="flex items-center justify-between">
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-primary-foreground mb-2">
                📊 League Standings & Stats
              </h1>
              <p className="text-primary-foreground/80">Complete breakdown of team rankings and player performance</p>
            </div>
            <Button asChild variant="outline" className="border-primary-foreground/30 text-primary-foreground hover:bg-primary-foreground/10">
              <Link href={`/league/${leagueId}`}>← Back to League</Link>
            </Button>
          </div>
        </div>
      </div>

      <div className="mx-auto max-w-7xl px-6 pb-16 -mt-6 space-y-8">
        <Tabs defaultValue="players" className="w-full">
          <TabsList className="grid w-full max-w-md grid-cols-2">
            <TabsTrigger value="teams">Team Standings</TabsTrigger>
            <TabsTrigger value="players">Player Stats</TabsTrigger>
          </TabsList>

          {/* Team Standings */}
          <TabsContent value="teams" className="mt-6">
            <Card className="shadow-xl border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>🏆</span>
                  Team Standings
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading standings...</div>
                ) : standings.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No points yet.</div>
                ) : (
                  <div className="space-y-3">
                    {standings.map((s, idx) => (
                      <div
                        key={s.user_id}
                        className="flex items-center justify-between rounded-lg border-2 p-4 card-hover"
                      >
                        <div className="flex items-center gap-4">
                          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-primary/10 border-2 border-primary text-base font-bold">
                            {idx + 1}
                          </div>
                          <div>
                            <div className="font-semibold text-lg">{s.display_name}</div>
                          </div>
                        </div>
                        <div className="text-right">
                          <div className="text-2xl font-bold tabular-nums text-primary">
                            {s.total_points.toFixed(2)}
                          </div>
                          <div className="text-xs text-muted-foreground">points</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>

          {/* Player Stats */}
          <TabsContent value="players" className="mt-6 space-y-4">
            {/* Filters */}
            <Card className="shadow-xl border-2">
              <CardHeader>
                <CardTitle className="text-base">Filters</CardTitle>
              </CardHeader>
              <CardContent>
                <div className="flex flex-wrap gap-2">
                  {["ALL", "QB", "RB", "WR", "TE"].map((pos) => (
                    <Button
                      key={pos}
                      variant={filterPos === pos ? "default" : "outline"}
                      size="sm"
                      onClick={() => setFilterPos(pos)}
                      className={filterPos === pos ? "gradient-field text-primary-foreground" : ""}
                    >
                      {pos}
                    </Button>
                  ))}
                </div>
              </CardContent>
            </Card>

            {/* Stats Table */}
            <Card className="shadow-xl border-2">
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <span>📈</span>
                  Player Statistics
                </CardTitle>
              </CardHeader>
              <CardContent>
                {loading ? (
                  <div className="text-sm text-muted-foreground">Loading player stats...</div>
                ) : sortedAndFilteredStats.length === 0 ? (
                  <div className="text-sm text-muted-foreground">No player stats yet.</div>
                ) : (
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead className="border-b-2">
                        <tr className="text-left">
                          <th className="pb-3 pr-4 font-semibold cursor-pointer hover:text-primary" onClick={() => handleSort("player_name")}>
                            Player {sortBy === "player_name" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-center" onClick={() => handleSort("pos")}>
                            Pos {sortBy === "pos" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary" onClick={() => handleSort("owner_name")}>
                            Team {sortBy === "owner_name" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("fantasy_points")}>
                            Pts {sortBy === "fantasy_points" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("passing_yards")}>
                            Pass Yds {sortBy === "passing_yards" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("passing_tds")}>
                            Pass TD {sortBy === "passing_tds" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("rushing_yards")}>
                            Rush Yds {sortBy === "rushing_yards" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("rushing_tds")}>
                            Rush TD {sortBy === "rushing_tds" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("receptions")}>
                            Rec {sortBy === "receptions" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("receiving_yards")}>
                            Rec Yds {sortBy === "receiving_yards" && (sortDesc ? "↓" : "↑")}
                          </th>
                          <th className="pb-3 px-2 font-semibold cursor-pointer hover:text-primary text-right" onClick={() => handleSort("receiving_tds")}>
                            Rec TD {sortBy === "receiving_tds" && (sortDesc ? "↓" : "↑")}
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {sortedAndFilteredStats.map((p) => (
                          <tr key={p.player_id} className="border-b hover:bg-muted/50 transition-colors">
                            <td className="py-3 pr-4">
                              <div className="font-medium">{p.player_name}</div>
                              <div className="text-xs text-muted-foreground">{p.nfl_team}</div>
                            </td>
                            <td className="py-3 px-2 text-center">
                              <Badge variant="outline" className="text-xs">
                                {p.pos}
                              </Badge>
                            </td>
                            <td className="py-3 px-2 text-sm">{p.owner_name}</td>
                            <td className="py-3 px-2 text-right font-semibold tabular-nums text-primary">
                              {p.fantasy_points.toFixed(2)}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                              {p.passing_yards || "-"}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                              {p.passing_tds || "-"}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                              {p.rushing_yards || "-"}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                              {p.rushing_tds || "-"}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                              {p.receptions || "-"}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                              {p.receiving_yards || "-"}
                            </td>
                            <td className="py-3 px-2 text-right tabular-nums text-muted-foreground">
                              {p.receiving_tds || "-"}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}
