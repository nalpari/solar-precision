"use client";

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

export const TOKYO_TOWER = { lat: 35.6586, lng: 139.7454 } as const;

const GEOLOCATION_TIMEOUT_MS = 8000;

type LatLng = { lat: number; lng: number };

type MapCenterContextValue = {
  center: LatLng;
  address: string;
  selectPlace: (next: { lat: number; lng: number; address: string }) => void;
};

const MapCenterContext = createContext<MapCenterContextValue | null>(null);

export function MapCenterProvider({ children }: { children: ReactNode }) {
  const [center, setCenter] = useState<LatLng>(TOKYO_TOWER);
  const [address, setAddress] = useState<string>("Tokyo Tower, 東京タワー");
  const userOverrode = useRef(false);

  const selectPlace = useCallback(
    (next: { lat: number; lng: number; address: string }) => {
      userOverrode.current = true;
      setCenter({ lat: next.lat, lng: next.lng });
      setAddress(next.address);
    },
    [],
  );

  useEffect(() => {
    if (typeof navigator === "undefined" || !navigator.geolocation) return;
    let cancelled = false;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        if (cancelled || userOverrode.current) return;
        setCenter({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setAddress("현재 위치");
      },
      () => {
        // Permission denied / unavailable — keep default fallback silently.
      },
      { enableHighAccuracy: false, timeout: GEOLOCATION_TIMEOUT_MS, maximumAge: 60_000 },
    );
    return () => {
      cancelled = true;
    };
  }, []);

  const value = useMemo(
    () => ({ center, address, selectPlace }),
    [center, address, selectPlace],
  );

  return (
    <MapCenterContext.Provider value={value}>
      {children}
    </MapCenterContext.Provider>
  );
}

export function useMapCenter(): MapCenterContextValue {
  const ctx = useContext(MapCenterContext);
  if (!ctx) {
    throw new Error("useMapCenter must be used within MapCenterProvider");
  }
  return ctx;
}
