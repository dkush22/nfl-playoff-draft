// Quick script to see what team IDs ESPN uses
const eventId = process.argv[2] || "401772980";

const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
const res = await fetch(url);
const summary = await res.json();

const competition = summary?.header?.competitions?.[0];
const competitors = competition?.competitors || [];

console.log("\n=== TEAM INFORMATION ===\n");

for (const comp of competitors) {
  console.log(`${comp.homeAway.toUpperCase()}:`);
  console.log(`  ESPN Team ID: ${comp.team.id}`);
  console.log(`  Name: ${comp.team.displayName}`);
  console.log(`  Abbreviation: ${comp.team.abbreviation}`);
  console.log(`  Score: ${comp.score}`);
  console.log(`  Winner: ${comp.winner ? 'YES' : 'NO'}`);
  console.log();
}

console.log(`Game Status: ${competition?.status?.type?.name}`);
console.log(`Winner ID: ${competition?.competitors?.find(c => c.winner)?.team?.id || 'None'}`);
