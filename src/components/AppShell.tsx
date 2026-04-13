"use client";

import { APIProvider } from "@vis.gl/react-google-maps";
import type { ReactNode } from "react";
import { MapCenterProvider } from "./MapCenterContext";
import { TopNav } from "./TopNav";

const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <APIProvider
      apiKey={GOOGLE_MAPS_API_KEY}
      libraries={["places", "geometry"]}
    >
      <MapCenterProvider>
        <TopNav />
        {children}
      </MapCenterProvider>
    </APIProvider>
  );
}
