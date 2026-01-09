import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });
import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// For seeding, anon key is OK if RLS is off for nfl_teams.
// If you later enable RLS, you'll want a service role key in a non-public env var.
if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set.");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

async function main() {
  const res = await fetch("https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams");
  if (!res.ok) throw new Error(`ESPN teams fetch failed: ${res.status}`);

  const json = await res.json();

  const teams =
    json?.sports?.[0]?.leagues?.[0]?.teams?.map((t) => t.team) ?? [];

  const rows = teams.map((t) => ({
    id: String(t.id),
    abbreviation: t.abbreviation,
    display_name: t.displayName,
    slug: t.slug,
    // is_playoffs and is_eliminated default false; you’ll set later
  }));

  console.log(`Upserting ${rows.length} teams...`);

  const { error } = await supabase
    .from("nfl_teams")
    .upsert(rows, { onConflict: "id" });

  if (error) throw error;

  console.log("Done.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});