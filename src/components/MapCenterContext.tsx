"use client";

import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from "react";

export const TOKYO_TOWER = { lat: 35.6586, lng: 139.7454 } as const;

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

  const selectPlace = useCallback(
    (next: { lat: number; lng: number; address: string }) => {
      setCenter({ lat: next.lat, lng: next.lng });
      setAddress(next.address);
    },
    [],
  );

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
