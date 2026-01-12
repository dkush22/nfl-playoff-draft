import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

// scoring settings
function computePoints(s) {
    const pass = 0.04 * s.passing_yards + 4 * s.passing_tds - 2 * s.interceptions;
    const rush = 0.1 * s.rushing_yards + 6 * s.rushing_tds;
    const recv = 0.1 * s.receiving_yards + 6 * s.receiving_tds + 0.5 * s.receptions;
  
    const fum = -2 * s.fumbles_lost;
  
    const returns = 6 * (s.kick_return_tds + s.punt_return_tds);
  
    return Number((pass + rush + recv + fum + returns).toFixed(2));
  }
  

// Helpers
function toInt(x) {
  if (x === null || x === undefined) return 0;
  const n = parseInt(String(x).replace(/[^\d-]/g, ""), 10);
  return Number.isFinite(n) ? n : 0;
}

/**
 * ESPN summary has player stats often as "boxscore.players":
 * Each team has categories (passing, rushing, receiving, fumbles)
 * with columns + athletes rows.
 */
function extractStatsFromSummary(summaryJson) {
  const box = summaryJson?.boxscore;
  const players = box?.players;
  if (!Array.isArray(players)) return [];

  // Build map espnAthleteId -> stat accumulator
  const acc = new Map();

  function getOrInit(athleteId, teamAbbr) {
    if (!acc.has(athleteId)) {
      acc.set(athleteId, {
        espn_athlete_id: athleteId,
        team_abbr: teamAbbr || null,
        passing_yards: 0,
        passing_tds: 0,
        interceptions: 0,
        rushing_yards: 0,
        rushing_tds: 0,
        receiving_yards: 0,
        receiving_tds: 0,
        receptions: 0,
        fumbles_lost: 0,
        kick_return_tds: 0,
        punt_return_tds: 0,
      });
    }
    const obj = acc.get(athleteId);
    if (!obj.team_abbr && teamAbbr) obj.team_abbr = teamAbbr;
    return obj;
  }

  // ESPN structure: players[] each has team + statistics[]
  for (const teamBlock of players) {
    const teamAbbr =
      teamBlock?.team?.abbreviation ||
      teamBlock?.team?.shortDisplayName ||
      null;

    const statsGroups = teamBlock?.statistics;
    if (!Array.isArray(statsGroups)) continue;

    for (const group of statsGroups) {
      const name = String(group?.name || "").toLowerCase();
      const labels = group?.labels || [];
      const athletes = group?.athletes || [];

      // Each athlete row has athlete.id and stats[] aligned with labels
      for (const row of athletes) {
        const athleteId = row?.athlete?.id ? String(row.athlete.id) : null;
        if (!athleteId) continue;

        const s = getOrInit(athleteId, teamAbbr);
        const values = row?.stats || [];

        // label mapping per category
        // We look for known label names rather than fixed indices.
        for (let i = 0; i < labels.length; i++) {
          const label = String(labels[i] || "").toLowerCase();
          const val = values[i];

          if (name === "passing") {
            if (label === "yds") s.passing_yards += toInt(val);
            if (label === "td") s.passing_tds += toInt(val);
            if (label === "int") s.interceptions += toInt(val);
          }

          if (name === "rushing") {
            if (label === "yds") s.rushing_yards += toInt(val);
            if (label === "td") s.rushing_tds += toInt(val);
          }

          if (name === "receiving") {
            if (label === "yds") s.receiving_yards += toInt(val);
            if (label === "td") s.receiving_tds += toInt(val);
            if (label === "rec") s.receptions += toInt(val);
          }

          if (name === "kickreturns") {
            if (label === "td") s.kick_return_tds += toInt(val);
          }

          if (name === "puntreturns") {
            if (label === "td") s.punt_return_tds += toInt(val);
          }

          // ESPN sometimes calls it "fumbles" or "fumblesLost" data
          if (name.includes("fumble")) {
            if (label.includes("lost")) s.fumbles_lost += toInt(val);
            // If the feed only provides "fum", you can decide to treat it as lost or not.
          }
        }
      }
    }
  }

  return Array.from(acc.values());
}

async function upsertEvent(eventId, summaryJson) {
  const seasonYear = summaryJson?.season?.year ?? null;
  const seasonType = summaryJson?.season?.type ?? null;
  const week = summaryJson?.week?.number ?? null;
  const name = summaryJson?.header?.competitions?.[0]?.description ?? null;
  const start = summaryJson?.header?.competitions?.[0]?.date ?? null;

  // Extract game information
  const competition = summaryJson?.header?.competitions?.[0];
  const competitors = competition?.competitors || [];
  const status = competition?.status?.type?.name ?? null;

  // Find home and away teams
  const homeTeam = competitors.find(c => c.homeAway === "home");
  const awayTeam = competitors.find(c => c.homeAway === "away");

  // Extract team info
  const homeTeamId = homeTeam?.team?.id ?? null;
  const homeTeamName = homeTeam?.team?.displayName ?? homeTeam?.team?.name ?? null;
  const homeTeamAbbr = homeTeam?.team?.abbreviation ?? null;
  const homeScore = homeTeam?.score ? parseInt(homeTeam.score, 10) : null;

  const awayTeamId = awayTeam?.team?.id ?? null;
  const awayTeamName = awayTeam?.team?.displayName ?? awayTeam?.team?.name ?? null;
  const awayTeamAbbr = awayTeam?.team?.abbreviation ?? null;
  const awayScore = awayTeam?.score ? parseInt(awayTeam.score, 10) : null;

  // Determine winner (only if game is final and not tied)
  let winnerId = null;
  if (status === "STATUS_FINAL" && homeScore !== null && awayScore !== null) {
    if (homeScore > awayScore) {
      winnerId = homeTeamId;
    } else if (awayScore > homeScore) {
      winnerId = awayTeamId;
    }
    // If tied, winnerId remains null
  }

  const { error } = await supabase.from("nfl_events").upsert(
    {
      id: String(eventId),
      season_year: seasonYear ?? 0,
      season_type: seasonType ?? 0,
      week: week,
      name,
      start_time: start,
      home_team_id: homeTeamId,
      home_team_name: homeTeamName,
      home_team_abbr: homeTeamAbbr,
      away_team_id: awayTeamId,
      away_team_name: awayTeamName,
      away_team_abbr: awayTeamAbbr,
      home_score: homeScore,
      away_score: awayScore,
      status: status,
      winner_id: winnerId,
    },
    { onConflict: "id" }
  );

  if (error) throw error;

  // Log the game info for visibility
  if (homeTeamAbbr && awayTeamAbbr) {
    const scoreDisplay = homeScore !== null && awayScore !== null
      ? `${homeTeamAbbr} ${homeScore} - ${awayScore} ${awayTeamAbbr}`
      : `${homeTeamAbbr} vs ${awayTeamAbbr}`;
    console.log(`📊 Event ${eventId}: ${scoreDisplay} (${status || 'Unknown Status'})`);
  }
}

async function main() {
  const eventId = process.argv[2];
  if (!eventId) {
    console.error("Usage: node scripts/scoreEvent.mjs <EVENT_ID>");
    process.exit(1);
  }

  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`ESPN summary fetch failed: ${res.status}`);
  const summary = await res.json();

  await upsertEvent(eventId, summary);

  const stats = extractStatsFromSummary(summary);

  console.log(`Parsed ${stats.length} player stat lines for event ${eventId}`);

  // Upsert stats
  const { error: statsErr } = await supabase
    .from("player_event_stats")
    .upsert(
      stats.map((s) => ({ event_id: String(eventId), ...s })),
      { onConflict: "event_id,espn_athlete_id" }
    );

  if (statsErr) throw statsErr;

  // Compute points + upsert points
  const pointsRows = stats.map((s) => ({
    event_id: String(eventId),
    espn_athlete_id: s.espn_athlete_id,
    fantasy_points: computePoints(s),
  }));

  const { error: ptsErr } = await supabase
    .from("player_event_points")
    .upsert(pointsRows, { onConflict: "event_id,espn_athlete_id" });

  if (ptsErr) throw ptsErr;

  console.log(`✓ Updated player_event_points for ${pointsRows.length} players`);

  // Update league team points
  await updateLeagueTeamPoints(String(eventId));

  // Show top 20 for quick sanity
  const top = pointsRows
    .slice()
    .sort((a, b) => Number(b.fantasy_points) - Number(a.fantasy_points))
    .slice(0, 20);

  console.table(top);
}

async function updateLeagueTeamPoints(eventId) {
  console.log(`\n📊 Updating league team points for event ${eventId}...`);

  // Get all leagues
  const { data: leagues, error: leaguesErr } = await supabase
    .from("leagues")
    .select("id, name");

  if (leaguesErr) throw leaguesErr;

  if (!leagues || leagues.length === 0) {
    console.log("❌ No leagues found in database");
    return;
  }

  console.log(`Found ${leagues.length} league(s)`);

  let totalUpdates = 0;

  // For each league, calculate team points
  for (const league of leagues) {
    const leagueId = league.id;
    const leagueName = league.name || leagueId;

    console.log(`\n  Processing: ${leagueName}`);

    // Get all draft picks for this league
    const { data: picks, error: picksErr } = await supabase
      .from("draft_picks")
      .select("user_id, player_id")
      .eq("league_id", leagueId);

    if (picksErr) {
      console.error(`    ❌ Error fetching picks:`, picksErr);
      continue;
    }

    if (!picks || picks.length === 0) {
      console.log(`    ⚠️  No draft picks yet - skipping`);
      continue;
    }

    console.log(`    Found ${picks.length} draft pick(s)`);

    // Get player IDs and build user->players map
    const playerIds = picks.map((p) => p.player_id);
    const userPlayersMap = new Map();
    for (const pick of picks) {
      if (!userPlayersMap.has(pick.user_id)) {
        userPlayersMap.set(pick.user_id, []);
      }
      userPlayersMap.get(pick.user_id).push(pick.player_id);
    }

    // Get player info to get espn_athlete_ids
    const { data: players, error: playersErr } = await supabase
      .from("players")
      .select("id, espn_athlete_id, name")
      .in("id", playerIds);

    if (playersErr) {
      console.error(`    ❌ Error fetching players:`, playersErr);
      continue;
    }

    if (!players || players.length === 0) {
      console.log(`    ❌ No player data found for ${playerIds.length} player IDs`);
      continue;
    }

    console.log(`    Found ${players.length} player(s) in database`);

    // Build map of player_id -> espn_athlete_id
    const playerToAthleteMap = new Map(
      players.map((p) => [p.id, p.espn_athlete_id])
    );

    // Get all espn_athlete_ids
    const athleteIds = players
      .map((p) => p.espn_athlete_id)
      .filter(Boolean);

    const playersWithoutAthleteId = players.filter(p => !p.espn_athlete_id);
    if (playersWithoutAthleteId.length > 0) {
      console.log(`    ⚠️  ${playersWithoutAthleteId.length} player(s) missing espn_athlete_id:`,
        playersWithoutAthleteId.map(p => p.name).join(", "));
    }

    if (athleteIds.length === 0) {
      console.log(`    ❌ No players have espn_athlete_id set - cannot calculate points`);
      continue;
    }

    console.log(`    Querying points for ${athleteIds.length} athlete ID(s) for this event`);

    // Get fantasy points for these athletes FOR THIS EVENT ONLY
    const { data: eventPoints, error: pointsErr } = await supabase
      .from("player_event_points")
      .select("espn_athlete_id, fantasy_points")
      .eq("event_id", eventId)
      .in("espn_athlete_id", athleteIds);

    if (pointsErr) {
      console.error(`    ❌ Error fetching points:`, pointsErr);
      continue;
    }

    console.log(`    Found ${(eventPoints || []).length} point record(s) from player_event_points for this event`);

    // Build map of espn_athlete_id -> total points
    const athletePointsMap = new Map();
    for (const row of eventPoints || []) {
      const current = athletePointsMap.get(row.espn_athlete_id) || 0;
      athletePointsMap.set(
        row.espn_athlete_id,
        current + Number(row.fantasy_points)
      );
    }

    // Calculate total points for each user
    const teamPointsRows = [];
    for (const [userId, playerIdsList] of userPlayersMap.entries()) {
      let totalPoints = 0;

      for (const playerId of playerIdsList) {
        const athleteId = playerToAthleteMap.get(playerId);
        if (athleteId) {
          const points = athletePointsMap.get(athleteId) || 0;
          totalPoints += points;
        }
      }

      teamPointsRows.push({
        event_id: eventId,
        league_id: leagueId,
        user_id: userId,
        fantasy_points: Number(totalPoints.toFixed(2)),
      });
    }

    // Update team points for this league and event (delete old records for this event, insert new ones)
    if (teamPointsRows.length > 0) {
      console.log(`    Updating ${teamPointsRows.length} team point record(s) for this event...`);

      // First, delete existing records for this league and event (in case we're re-running)
      const { error: deleteErr } = await supabase
        .from("league_team_event_points")
        .delete()
        .eq("league_id", leagueId)
        .eq("event_id", eventId);

      if (deleteErr) {
        console.error(`    ❌ Error deleting old team points:`, deleteErr);
      } else {
        // Then insert the new records
        const { error: insertErr } = await supabase
          .from("league_team_event_points")
          .insert(teamPointsRows);

        if (insertErr) {
          console.error(`    ❌ Error inserting team points:`, insertErr);
        } else {
          console.log(`    ✅ Successfully updated ${teamPointsRows.length} team(s) for this event`);
          // Show the points for verification
          teamPointsRows.forEach(row => {
            console.log(`       User ${row.user_id.substring(0, 8)}... = ${row.fantasy_points} points for this event`);
          });
          totalUpdates += teamPointsRows.length;
        }
      }
    } else {
      console.log(`    ⚠️  No team points to update (no players scored in this event)`);
    }
  }

  console.log(`\n${totalUpdates > 0 ? '✅' : '⚠️'}  Updated ${totalUpdates} team point record(s) across all leagues\n`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});