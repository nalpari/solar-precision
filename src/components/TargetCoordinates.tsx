"use client";

import { useMapCenter } from "./MapCenterContext";

function fmtLatLng(lat: number, lng: number) {
  const ns = lat >= 0 ? "N" : "S";
  const ew = lng >= 0 ? "E" : "W";
  return `${Math.abs(lat).toFixed(4)}° ${ns}, ${Math.abs(lng).toFixed(4)}° ${ew}`;
}

export function TargetCoordinatesCard() {
  const { center } = useMapCenter();
  return (
    <div className="glass-panel p-6 rounded-xl shadow-lg">
      <div className="flex items-center justify-between mb-4">
        <span className="text-[10px] font-bold text-primary uppercase tracking-widest">
          Target Coordinates
        </span>
        <span className="material-symbols-outlined text-outline text-sm">
          more_horiz
        </span>
      </div>
      <div className="space-y-4">
        <div className="flex flex-col">
          <span className="text-xs text-outline mb-1 font-medium uppercase tracking-tight">
            Latitude / Longitude
          </span>
          <span className="font-mono text-sm text-on-surface font-semibold tracking-tight">
            {fmtLatLng(center.lat, center.lng)}
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-xs text-outline mb-1 font-medium uppercase tracking-tight">
            Elevation (ASL)
          </span>
          <span className="font-mono text-sm text-on-surface font-semibold tracking-tight">
            18.4 meters
          </span>
        </div>
      </div>
      <div className="mt-6 pt-4 border-t border-outline-variant/15">
        <div className="flex justify-between items-center">
          <span className="text-xs font-medium text-slate-500">
            Azimuth Angle
          </span>
          <span className="font-mono text-sm font-bold text-primary">
            164.2°
          </span>
        </div>
      </div>
    </div>
  );
}

export function CoordinatesBentoCard() {
  const { center } = useMapCenter();
  const ns = center.lat >= 0 ? "N" : "S";
  const ew = center.lng >= 0 ? "E" : "W";
  return (
    <div className="glass-panel p-4 rounded-xl shadow-sm border border-outline-variant/10">
      <div className="flex items-center justify-between mb-3">
        <span className="text-[10px] font-bold text-tertiary uppercase tracking-wider">
          Coordinates
        </span>
        <span className="material-symbols-outlined text-sm text-primary">
          gps_fixed
        </span>
      </div>
      <div className="space-y-1">
        <p className="font-mono text-sm font-medium">
          {Math.abs(center.lat).toFixed(4)}° {ns}
        </p>
        <p className="font-mono text-sm font-medium">
          {Math.abs(center.lng).toFixed(4)}° {ew}
        </p>
      </div>
    </div>
  );
}
