/**
 * Daily apartment search — runs entirely inside Convex (see convex/crons.ts).
 *
 * Discovery is DETERMINISTIC: fetch Domu's neighborhood index pages and pull
 * the building/unit detail-page URLs straight out of the HTML, skip anything
 * already on the board, and queue each new URL through the existing
 * Add-by-URL importer (which researches it, structures it, and pulls photos
 * into Convex storage). A follow-up geocodes the new rows for the map.
 *
 * No Claude web-search (that was slow + returned nothing), no local machine,
 * no browser — Convex is always-on, so this is the reliable remote path.
 */
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const MAX_NEW_PER_RUN = 20;

// Target neighborhood slugs (the 3rd path segment of a Domu detail URL). We
// discover via Domu's sitemap (bot-friendly XML, fetchable from Convex's IP —
// unlike the HTML pages) and keep only listings in these areas.
const HOODS =
  "lincoln-park|lakeview|gold-coast|old-town|streeterville|west-loop|river-west|printers-row|south-loop|pilsen|bucktown|wicker-park|logan-square|ravenswood|lincoln-square|hyde-park|andersonville|edgewater|uptown|near-west-side|university-village";

const SITEMAP_PAGES = [1, 2];
const EXCLUDE = /neighborhoods|apartment-search|list-an-apartment|bedroom|studio|apartments-for-rent/;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

async function domuListingUrls(): Promise<string[]> {
  const urls = new Set<string>();
  const re = new RegExp(
    `https://www\\.domu\\.com/chicago/[a-z0-9-]+/(?:${HOODS})/[a-z0-9-]+`,
    "g",
  );
  for (const page of SITEMAP_PAGES) {
    try {
      const res = await fetch(`https://www.domu.com/sitemap.xml?page=${page}`, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      for (const u of xml.match(re) ?? []) {
        if (EXCLUDE.test(u)) continue;
        urls.add(u);
      }
    } catch {
      // skip a sitemap page that fails to fetch
    }
  }
  return [...urls];
}

export const run = internalAction({
  args: {},
  handler: async (ctx) => {
    const existing = await ctx.runQuery(
      internal.apartments.listForAutomation,
      {},
    );
    const seen = new Set(
      existing
        .map((a) => a.url)
        .filter((u): u is string => Boolean(u))
        .map(normalizeUrl),
    );

    const candidates = await domuListingUrls();
    console.log(
      `dailySearch: ${candidates.length} candidates, ${seen.size} already on board`,
    );

    const fresh: string[] = [];
    for (const url of candidates) {
      const norm = normalizeUrl(url);
      if (seen.has(norm)) continue;
      seen.add(norm);
      fresh.push(url);
      if (fresh.length >= MAX_NEW_PER_RUN) break;
    }

    for (const url of fresh) {
      await ctx.runMutation(api.apartmentImports.createFromUrl, { url });
    }

    if (fresh.length > 0) {
      // Imports run async (each researches + pulls images); geocode after.
      await ctx.scheduler.runAfter(
        10 * 60 * 1000,
        internal.dailySearch.geocodeMissing,
        {},
      );
    }

    console.log(`dailySearch: queued ${fresh.length} new listings`);
    return { candidates: candidates.length, queued: fresh.length };
  },
});

export const geocodeMissing = internalAction({
  args: {},
  handler: async (ctx) => {
    const key =
      process.env.GOOGLE_MAPS_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    if (!key) return { geocoded: 0 };

    const all = await ctx.runQuery(internal.apartments.listForAutomation, {});
    let geocoded = 0;
    for (const a of all) {
      if (a.hasGeo) continue;
      if (!a.address) continue;
      try {
        const res = await fetch(
          `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
            a.address,
          )}&key=${key}`,
        );
        const data = await res.json();
        const loc = data?.results?.[0]?.geometry?.location;
        if (loc) {
          await ctx.runMutation(api.apartments.setGeo, {
            id: a._id,
            latitude: loc.lat,
            longitude: loc.lng,
          });
          geocoded += 1;
        }
      } catch {
        // skip transient geocode failures; caught again next run
      }
    }
    return { geocoded };
  },
});
