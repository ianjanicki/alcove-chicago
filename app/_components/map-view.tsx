"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import {
  getDisplayName,
  getBedroomCount,
  getBathroomCount,
  getRepresentativeImage,
} from "@/_lib/apartment";

/* eslint-disable @typescript-eslint/no-explicit-any */

const CHICAGO = { lat: 41.8781, lng: -87.6298 };
const MAPS_KEY = process.env.NEXT_PUBLIC_GOOGLE_MAPS_KEY;

let mapsPromise: Promise<any> | null = null;
function loadGoogleMaps(): Promise<any> {
  if (typeof window === "undefined") return Promise.reject();
  if ((window as any).google?.maps) return Promise.resolve((window as any).google);
  if (mapsPromise) return mapsPromise;
  mapsPromise = new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = `https://maps.googleapis.com/maps/api/js?key=${MAPS_KEY}`;
    script.async = true;
    script.onload = () => resolve((window as any).google);
    script.onerror = reject;
    document.head.appendChild(script);
  });
  return mapsPromise;
}

function priceText(apt: any): string {
  const p = apt.offer?.price;
  if (typeof p === "number") return `$${p.toLocaleString("en-US")}/mo`;
  const disp = (apt.offer?.additionalProperty ?? []).find(
    (x: any) => x.name === "priceDisplay",
  )?.value;
  return disp ?? "Price on request";
}

function infoHtml(apt: any): string {
  const img = getRepresentativeImage(apt);
  const beds = getBedroomCount(apt);
  const baths = getBathroomCount(apt);
  const name = getDisplayName(apt);
  const meta = [
    priceText(apt),
    beds != null ? `${beds} bd` : null,
    baths != null ? `${baths} ba` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const hood =
    (apt.listing?.additionalProperty ?? []).find(
      (x: any) => x.name === "neighborhood",
    )?.value ?? "";
  const imgTag = img?.url
    ? `<img src="${img.url}" alt="" style="width:100%;height:120px;object-fit:cover;border-radius:8px;margin-bottom:8px" />`
    : "";
  return `
    <div style="width:220px;font-family:system-ui,sans-serif;color:#111">
      ${imgTag}
      <div style="font-weight:600;font-size:14px;line-height:1.2;margin-bottom:2px">${name}</div>
      <div style="font-size:12px;color:#555;margin-bottom:2px">${meta}</div>
      <div style="font-size:11px;color:#888;margin-bottom:8px">${hood}</div>
      <a href="/?apartment=${apt._id}" style="font-size:12px;color:#2563eb;text-decoration:none;font-weight:500">View details →</a>
    </div>`;
}

// Color pins by recency (matches the card freshness badges): fresh finds pop
// green, this-week amber, older slate.
function recencyColor(createdAt: number | undefined): string {
  if (!createdAt) return "#64748b";
  const days = Math.floor((Date.now() - createdAt) / 86_400_000);
  if (days <= 2) return "#10b981"; // emerald — new
  if (days <= 7) return "#f59e0b"; // amber — this week
  return "#64748b"; // slate — older
}

export function MapView() {
  const apartments = useQuery(api.apartments.list, {});
  const mapRef = useRef<HTMLDivElement>(null);
  const mapObj = useRef<any>(null);
  const infoWin = useRef<any>(null);
  const markers = useRef<any[]>([]);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const withGeo = useMemo(
    () =>
      (apartments ?? []).filter(
        (a: any) => a.apartment?.geo?.latitude && a.apartment?.geo?.longitude,
      ),
    [apartments],
  );
  const total = apartments?.length ?? 0;

  useEffect(() => {
    if (!MAPS_KEY) {
      setError("NEXT_PUBLIC_GOOGLE_MAPS_KEY is not set.");
      return;
    }
    let cancelled = false;
    loadGoogleMaps()
      .then((google) => {
        if (cancelled || !mapRef.current) return;
        mapObj.current = new google.maps.Map(mapRef.current, {
          center: CHICAGO,
          zoom: 11,
          mapTypeControl: false,
          streetViewControl: false,
          fullscreenControl: false,
        });
        infoWin.current = new google.maps.InfoWindow();
        setReady(true);
      })
      .catch(() => setError("Failed to load Google Maps."));
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready || !mapObj.current) return;
    const google = (window as any).google;
    markers.current.forEach((m) => m.setMap(null));
    markers.current = [];
    const bounds = new google.maps.LatLngBounds();
    withGeo.forEach((apt: any) => {
      const pos = {
        lat: apt.apartment.geo.latitude,
        lng: apt.apartment.geo.longitude,
      };
      const marker = new google.maps.Marker({
        position: pos,
        map: mapObj.current,
        title: getDisplayName(apt),
        icon: {
          path: google.maps.SymbolPath.CIRCLE,
          scale: 7,
          fillColor: recencyColor(apt.createdAt),
          fillOpacity: 1,
          strokeColor: "#ffffff",
          strokeWeight: 1.5,
        },
      });
      const openCard = () => {
        infoWin.current.setContent(infoHtml(apt));
        infoWin.current.open(mapObj.current, marker);
      };
      // Show the card on hover (and keep click working for touch/persistence).
      marker.addListener("mouseover", openCard);
      marker.addListener("click", openCard);
      markers.current.push(marker);
      bounds.extend(pos);
    });
    if (withGeo.length > 1) mapObj.current.fitBounds(bounds);
  }, [ready, withGeo]);

  return (
    <div className="relative h-[100dvh] w-full">
      <div className="absolute left-4 top-4 z-10 flex items-center gap-3 rounded-full bg-background/90 px-4 py-2 shadow-card-1 backdrop-blur">
        <Link href="/" className="text-sm font-medium text-foreground hover:underline">
          ← List
        </Link>
        <span className="text-sm text-muted-foreground">
          {withGeo.length} of {total} on map
        </span>
      </div>
      <div className="absolute bottom-4 left-4 z-10 flex flex-col gap-1.5 rounded-xl bg-background/90 px-3 py-2.5 text-xs shadow-card-1 backdrop-blur">
        <div className="font-medium text-foreground">Freshness</div>
        {[
          ["#10b981", "New (≤2 days)"],
          ["#f59e0b", "This week"],
          ["#64748b", "Older"],
        ].map(([color, label]) => (
          <div key={label} className="flex items-center gap-2 text-muted-foreground">
            <span
              className="inline-block size-2.5 rounded-full"
              style={{ backgroundColor: color }}
            />
            {label}
          </div>
        ))}
      </div>
      {error ? (
        <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
          {error}
        </div>
      ) : (
        <div ref={mapRef} className="h-full w-full" />
      )}
    </div>
  );
}
