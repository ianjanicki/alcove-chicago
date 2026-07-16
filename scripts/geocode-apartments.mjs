/**
 * Geocode apartments that lack lat/lng and store the coordinates on Convex,
 * so the whole-board map and the drawer location map place pins precisely.
 *
 * Usage:
 *   node scripts/geocode-apartments.mjs           # geocode only rows missing geo
 *   node scripts/geocode-apartments.mjs --force   # re-geocode every row
 *
 * Requires NEXT_PUBLIC_GOOGLE_MAPS_KEY (Geocoding API enabled) and a Convex URL,
 * both read from .env.local.
 */
import { ConvexHttpClient } from "convex/browser";
import { api } from "../convex/_generated/api.js";
import { loadEnvLocal } from "./r2.mjs";

loadEnvLocal();

const force = process.argv.includes("--force");
const convexUrl =
  process.env.NEXT_PUBLIC_CONVEX_URL ?? process.env.CONVEX_URL;
const mapsKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

if (!convexUrl) throw new Error("Missing NEXT_PUBLIC_CONVEX_URL in .env.local");
if (!mapsKey) throw new Error("Missing NEXT_PUBLIC_GOOGLE_MAPS_KEY in .env.local");

const client = new ConvexHttpClient(convexUrl);

function fullAddress(apartment) {
  const a = apartment.apartment?.address ?? {};
  return [
    a.streetAddress,
    a.addressLocality,
    a.addressRegion,
    a.postalCode,
    a.addressCountry,
  ]
    .filter(Boolean)
    .join(", ");
}

async function geocode(address) {
  const url = `https://maps.googleapis.com/maps/api/geocode/json?address=${encodeURIComponent(
    address,
  )}&key=${mapsKey}`;
  const res = await fetch(url);
  const data = await res.json();
  if (data.status !== "OK" || !data.results?.length) return null;
  const loc = data.results[0].geometry?.location;
  if (!loc) return null;
  return { latitude: loc.lat, longitude: loc.lng };
}

const rows = await client.query(api.apartments.list, {});
let done = 0;
let skipped = 0;
let failed = 0;

for (const apt of rows) {
  const hasGeo = apt.apartment?.geo?.latitude && apt.apartment?.geo?.longitude;
  if (hasGeo && !force) {
    skipped += 1;
    continue;
  }
  const address = fullAddress(apt);
  if (!address) {
    failed += 1;
    console.log(`  no address: ${apt._id}`);
    continue;
  }
  const geo = await geocode(address);
  if (!geo) {
    failed += 1;
    console.log(`  geocode failed: ${address}`);
    continue;
  }
  await client.mutation(api.apartments.setGeo, {
    id: apt._id,
    latitude: geo.latitude,
    longitude: geo.longitude,
  });
  done += 1;
  console.log(`  ${geo.latitude.toFixed(5)}, ${geo.longitude.toFixed(5)}  ${address}`);
  // Be polite to the Geocoding API.
  await new Promise((r) => setTimeout(r, 120));
}

console.log(`done: ${done} geocoded, ${skipped} already had geo, ${failed} failed`);
