/**
 * Daily apartment search — runs entirely inside Convex (see convex/crons.ts).
 *
 * Discovery is DETERMINISTIC via Domu's sitemap (bot-friendly XML, fetchable
 * from Convex's IP unlike the HTML pages). We also read each entry's <lastmod>
 * — the source's real posted/updated date — and store it as `listedAt`, which
 * drives the honest "freshness" label (NOT our scrape date).
 *
 *   run       — queue new listings + schedule finalize.
 *   finalize  — set listedAt from the sitemap for every row, and geocode any
 *               row still missing map coordinates.
 *
 * No Claude web-search, no local machine, no browser — Convex is always-on.
 */
import { internalAction } from "./_generated/server";
import { api, internal } from "./_generated/api";

const MAX_NEW_PER_RUN = 20;
const SITEMAP_PAGES = [1, 2];
const HOODS =
  "lincoln-park|lakeview|gold-coast|old-town|streeterville|west-loop|river-west|printers-row|south-loop|pilsen|bucktown|wicker-park|logan-square|ravenswood|lincoln-square|hyde-park|andersonville|edgewater|uptown|near-west-side|university-village";
const HOOD_RE = new RegExp(`/chicago/[a-z0-9-]+/(?:${HOODS})/[a-z0-9-]+`);
const EXCLUDE = /neighborhoods|apartment-search|list-an-apartment|bedroom|studio|apartments-for-rent/;

function normalizeUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").toLowerCase();
}

type Entry = { url: string; lastmod: number | null };

async function sitemapEntries(): Promise<Entry[]> {
  const out: Entry[] = [];
  const re = /<url>\s*<loc>([^<]+)<\/loc>(?:\s*<lastmod>([^<]+)<\/lastmod>)?/g;
  for (const page of SITEMAP_PAGES) {
    try {
      const res = await fetch(`https://www.domu.com/sitemap.xml?page=${page}`, {
        headers: {
          "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
        },
      });
      if (!res.ok) continue;
      const xml = await res.text();
      let m: RegExpExecArray | null;
      while ((m = re.exec(xml)) !== null) {
        const url = m[1];
        if (!HOOD_RE.test(url) || EXCLUDE.test(url)) continue;
        const parsed = m[2] ? Date.parse(m[2]) : NaN;
        out.push({ url, lastmod: Number.isNaN(parsed) ? null : parsed });
      }
    } catch {
      // skip a sitemap page that fails to fetch
    }
  }
  return out;
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

    const entries = await sitemapEntries();
    const byUrl = new Map<string, Entry>();
    for (const e of entries) {
      const n = normalizeUrl(e.url);
      if (!byUrl.has(n)) byUrl.set(n, e);
    }

    const fresh: string[] = [];
    for (const [n, e] of byUrl) {
      if (seen.has(n)) continue;
      fresh.push(e.url);
      if (fresh.length >= MAX_NEW_PER_RUN) break;
    }

    for (const url of fresh) {
      await ctx.runMutation(api.apartmentImports.createFromUrl, { url });
    }

    console.log(`dailySearch: ${byUrl.size} candidates, queued ${fresh.length}`);
    // Imports run async; finalize sets listedAt + geocodes once they settle.
    await ctx.scheduler.runAfter(10 * 60 * 1000, internal.dailySearch.finalize, {});
    return { candidates: byUrl.size, queued: fresh.length };
  },
});

export const finalize = internalAction({
  args: {},
  handler: async (ctx) => {
    const entries = await sitemapEntries();
    const lastmodByUrl = new Map<string, number>();
    for (const e of entries) {
      if (e.lastmod) lastmodByUrl.set(normalizeUrl(e.url), e.lastmod);
    }

    const all = await ctx.runQuery(internal.apartments.listForAutomation, {});
    const key =
      process.env.GOOGLE_MAPS_KEY ?? process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;
    let listed = 0;
    let geocoded = 0;

    for (const a of all) {
      // Posted/updated date from the sitemap → listedAt.
      if (a.url) {
        const lm = lastmodByUrl.get(normalizeUrl(a.url));
        if (lm && lm !== a.listedAt) {
          await ctx.runMutation(api.apartments.setListedAt, {
            id: a._id,
            listedAt: lm,
          });
          listed += 1;
        }
      }
      // Fill map coordinates for anything still missing them.
      if (!a.hasGeo && a.address && key) {
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
          // skip transient geocode failures; retried next run
        }
      }
    }

    console.log(`dailySearch.finalize: listedAt set on ${listed}, geocoded ${geocoded}`);
    return { listed, geocoded };
  },
});
