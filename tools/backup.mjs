// Durable backup: pull the whole collection from the Worker and write it to
// data/spoons.json, for you to review and commit. The KV store is the live
// source of truth; this git-tracked file is the "service went down" safety net.
// Reads are open, so no token is needed.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const API = process.env.SPOON_API || "https://spoon-tracker.mufflon.workers.dev";
const root = join(dirname(fileURLToPath(import.meta.url)), "..");

const res = await fetch(API + "/spoons");
if (!res.ok) {
  console.error(`Backup failed: GET ${API}/spoons -> ${res.status}`);
  process.exit(1);
}
const data = await res.json();
writeFileSync(join(root, "data", "spoons.json"), JSON.stringify(data, null, 2) + "\n");
console.log(`✓ Backed up ${data.length} spoon(s) to data/spoons.json — review and commit.`);
