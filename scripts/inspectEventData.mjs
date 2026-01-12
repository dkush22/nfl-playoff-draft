// Quick script to see what data ESPN provides for an event
const eventId = process.argv[2] || "401772979";

const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/summary?event=${eventId}`;
const res = await fetch(url);
const summary = await res.json();

console.log("\n=== EVENT HEADER ===");
console.log(JSON.stringify(summary.header, null, 2));

console.log("\n=== COMPETITIONS ===");
const comp = summary.header?.competitions?.[0];
if (comp) {
  console.log("Status:", comp.status);
  console.log("Competitors:", comp.competitors);
  console.log("Venue:", comp.venue);
}

console.log("\n=== Available top-level keys ===");
console.log(Object.keys(summary));
