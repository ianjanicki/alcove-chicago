/**
 * Merge all data/automation-backfill/src-*.json agent outputs into one runs.json,
 * dedup by URL, normalize track from bedroom count, fold buildingType into tags.
 * Writes the combined file path to stdout.
 */
import { readdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const dir = resolve(process.cwd(), "data/automation-backfill");
const files = (await readdir(dir)).filter(
  (f) => f.startsWith("src-") && f.endsWith(".json"),
);

function normUrl(u) {
  return String(u).trim().replace(/\/+$/, "").toLowerCase();
}
function toNum(v) {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const m = v.match(/\d+(\.\d+)?/);
    if (m) return Number(m[0]);
  }
  return undefined;
}
function trackFor(beds) {
  const n = toNum(beds);
  if (n === undefined) return "1br";
  if (n >= 3) return "3br";
  if (n === 2) return "2br";
  return "1br";
}

const seen = new Set();
const listings = [];
const perFile = {};

for (const file of files) {
  let arr;
  try {
    arr = JSON.parse(await readFile(resolve(dir, file), "utf8"));
  } catch (e) {
    console.log(`  SKIP ${file}: invalid JSON (${e.message})`);
    continue;
  }
  if (!Array.isArray(arr)) {
    console.log(`  SKIP ${file}: not an array`);
    continue;
  }
  let kept = 0;
  for (const raw of arr) {
    if (!raw?.url) continue;
    const key = normUrl(raw.url);
    if (seen.has(key)) continue;
    seen.add(key);
    const beds = toNum(raw.bedrooms);
    const tags = Array.isArray(raw.tags) ? [...raw.tags] : [];
    if (raw.buildingType && !tags.includes(raw.buildingType)) {
      tags.unshift(raw.buildingType);
    }
    const listing = {
      url: raw.url,
      name: raw.name,
      streetAddress: raw.streetAddress,
      neighborhood: raw.neighborhood,
      track: trackFor(raw.bedrooms),
      tags,
      amenities: Array.isArray(raw.amenities) ? raw.amenities : undefined,
      note: raw.note,
    };
    if (beds !== undefined) listing.bedrooms = beds;
    const baths = toNum(raw.bathrooms);
    if (baths !== undefined) listing.bathrooms = baths;
    const price = toNum(raw.price);
    if (price !== undefined) listing.price = price;
    const pmin = toNum(raw.priceMin);
    if (pmin !== undefined) listing.priceMin = pmin;
    const pmax = toNum(raw.priceMax);
    if (pmax !== undefined) listing.priceMax = pmax;
    // strip undefined keys
    for (const k of Object.keys(listing)) {
      if (listing[k] === undefined) delete listing[k];
    }
    listings.push(listing);
    kept += 1;
  }
  perFile[file] = kept;
}

const out = {
  runs: [
    {
      id: "chicago-more-2026-07-13",
      runDate: "2026-07-13",
      summary:
        "Expanded character-first sweep: greystones, coach houses, vintage flats/walk-ups, mansion conversions, and industrial/timber lofts across the north side, west side loft districts, Logan Square, and Hyde Park.",
      sourcesSearched: ["domu.com", "zillow.com", "loft building sites"],
      listings,
    },
  ],
};

const outPath = resolve(dir, "chicago-more-2026-07-13.json");
await writeFile(outPath, JSON.stringify(out, null, 2));
console.log("per-file kept:", JSON.stringify(perFile));
console.log(`merged ${listings.length} unique listings -> ${outPath}`);
