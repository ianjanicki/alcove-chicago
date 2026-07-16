import type { Metadata } from "next";
import { MapView } from "@/_components/map-view";

export const metadata: Metadata = { title: "Alcove — Map" };

export default function MapPage() {
  return <MapView />;
}
