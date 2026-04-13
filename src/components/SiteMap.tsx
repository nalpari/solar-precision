"use client";

import { Map, useMap } from "@vis.gl/react-google-maps";
import { forwardRef, useEffect, useRef } from "react";
import { useMapCenter } from "./MapCenterContext";

const MAP_ID = "solar-precision-map";
const GOOGLE_MAPS_API_KEY =
  process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY || "";

function CenterUpdater() {
  const map = useMap(MAP_ID);
  const { center } = useMapCenter();
  const isFirst = useRef(true);

  useEffect(() => {
    if (!map) return;
    if (isFirst.current) {
      isFirst.current = false;
      return;
    }
    map.panTo(center);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable lat/lng deps
  }, [map, center.lat, center.lng]);

  return null;
}

type SiteMapProps = {
  zoom?: number;
  tint?: "none" | "primary" | "fade";
};

export const SiteMap = forwardRef<HTMLDivElement, SiteMapProps>(function SiteMap(
  { zoom = 19, tint = "none" },
  ref,
) {
  const { center } = useMapCenter();

  if (!GOOGLE_MAPS_API_KEY) {
    return (
      <div className="absolute inset-0 z-0 flex items-center justify-center bg-surface-container">
        <div className="glass-panel px-6 py-4 rounded-xl text-center max-w-sm">
          <p className="text-sm font-semibold text-on-surface mb-2">
            Google Maps API key missing
          </p>
          <p className="text-xs text-outline font-mono">
            Set NEXT_PUBLIC_GOOGLE_MAPS_API_KEY in .env
          </p>
        </div>
      </div>
    );
  }

  return (
    <div ref={ref} className="absolute inset-0 z-0">
      <Map
        id={MAP_ID}
        defaultCenter={center}
        defaultZoom={zoom}
        mapTypeId="satellite"
        tilt={0}
        disableDefaultUI
        gestureHandling="greedy"
        style={{ width: "100%", height: "100%" }}
      >
        <CenterUpdater />
      </Map>
      {tint === "primary" && (
        <div className="absolute inset-0 bg-primary/5 pointer-events-none" />
      )}
      {tint === "fade" && (
        <div className="absolute inset-0 map-gradient-overlay pointer-events-none" />
      )}
    </div>
  );
});
