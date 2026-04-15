"use client";

import Link from "next/link";
import { useMapsLibrary } from "@vis.gl/react-google-maps";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { useMapCenter } from "./MapCenterContext";

export function TopNav() {
  const placesLib = useMapsLibrary("places");
  const { selectPlace } = useMapCenter();

  const [query, setQuery] = useState("");
  const [predictions, setPredictions] = useState<
    google.maps.places.AutocompletePrediction[]
  >([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const autocompleteRef = useRef<google.maps.places.AutocompleteService | null>(
    null,
  );
  const detailsRef = useRef<google.maps.places.PlacesService | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined,
  );
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!placesLib) return;
    autocompleteRef.current = new placesLib.AutocompleteService();
    detailsRef.current = new placesLib.PlacesService(
      document.createElement("div"),
    );
  }, [placesLib]);

  useEffect(() => {
    function handleClickOutside(e: MouseEvent) {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, []);

  const runSearch = useCallback((input: string) => {
    const svc = autocompleteRef.current;
    if (!svc) return;
    if (!input.trim()) {
      setPredictions([]);
      setOpen(false);
      return;
    }
    setLoading(true);
    svc.getPlacePredictions({ input }, (results, status) => {
      setLoading(false);
      if (
        status === google.maps.places.PlacesServiceStatus.OK &&
        results
      ) {
        setPredictions(results);
        setOpen(true);
      } else {
        setPredictions([]);
        setOpen(false);
        if (status !== google.maps.places.PlacesServiceStatus.ZERO_RESULTS) {
          console.warn("Places autocomplete status:", status);
        }
      }
    });
  }, []);

  function handleChange(value: string) {
    setQuery(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(value), 300);
  }

  function handleSelect(prediction: google.maps.places.AutocompletePrediction) {
    const svc = detailsRef.current;
    if (!svc) return;
    svc.getDetails(
      {
        placeId: prediction.place_id,
        fields: ["geometry", "formatted_address", "name"],
      },
      (place, status) => {
        if (
          status === google.maps.places.PlacesServiceStatus.OK &&
          place?.geometry?.location
        ) {
          const address =
            place.formatted_address || place.name || prediction.description;
          setQuery(address);
          setPredictions([]);
          setOpen(false);
          selectPlace({
            lat: place.geometry.location.lat(),
            lng: place.geometry.location.lng(),
            address,
          });
        } else {
          console.warn("Places getDetails status:", status);
        }
      },
    );
  }

  return (
    <nav className="bg-background border-b border-outline-variant/15 flex justify-between px-6 py-2 w-full items-center fixed top-0 z-50 font-headline text-sm tracking-tight">
      <div className="flex items-center gap-8">
        <Link href="/" className="text-lg font-bold text-primary tracking-tighter hover:opacity-80 transition-opacity">
          SolarPrecision JP
        </Link>
        <div ref={containerRef} className="relative w-96">
          <div className="absolute inset-y-0 left-3 flex items-center pointer-events-none">
            <span className="material-symbols-outlined text-outline text-sm">
              search
            </span>
          </div>
          <input
            type="text"
            value={query}
            onChange={(e) => handleChange(e.target.value)}
            onFocus={() => {
              if (predictions.length > 0) setOpen(true);
            }}
            placeholder="주소를 입력하세요 (예: 도쿄도 미나토구...)"
            className="w-full bg-surface-container-highest border-0 rounded-lg py-2 pl-10 pr-10 text-on-surface placeholder:text-outline focus:outline-none focus:ring-2 focus:ring-primary/20 transition-all text-xs"
          />
          {loading && (
            <div className="absolute inset-y-0 right-3 flex items-center pointer-events-none">
              <span className="material-symbols-outlined text-outline text-sm animate-spin">
                progress_activity
              </span>
            </div>
          )}

          {open && predictions.length > 0 && (
            <ul className="absolute top-full left-0 right-0 mt-2 bg-surface-container-lowest border border-outline-variant/30 rounded-lg shadow-lg z-50 max-h-72 overflow-y-auto py-1">
              {predictions.map((p) => (
                <li key={p.place_id}>
                  <button
                    type="button"
                    onClick={() => handleSelect(p)}
                    className="w-full flex items-start gap-2 px-3 py-2 text-left text-xs text-on-surface hover:bg-surface-container transition-colors"
                  >
                    <span className="material-symbols-outlined text-outline text-sm mt-0.5 flex-shrink-0">
                      location_on
                    </span>
                    <span className="leading-snug">{p.description}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2">
          <button className="p-2 text-slate-500 hover:bg-surface-container-low transition-colors rounded-lg">
            <span className="material-symbols-outlined">settings</span>
          </button>
          <button className="p-2 text-slate-500 hover:bg-surface-container-low transition-colors rounded-lg">
            <span className="material-symbols-outlined">help</span>
          </button>
          <div className="relative">
            <button className="p-2 text-slate-500 hover:bg-surface-container-low transition-colors rounded-lg">
              <span className="material-symbols-outlined">notifications</span>
            </button>
            <span className="absolute top-2 right-2 w-2 h-2 bg-error rounded-full" />
          </div>
        </div>
        <div className="h-8 w-px bg-outline-variant/30 mx-2" />
        <div
          aria-label="User avatar"
          className="w-8 h-8 rounded-full border border-outline-variant/30 bg-gradient-to-br from-primary-fixed to-tertiary-fixed-dim flex items-center justify-center text-on-primary-fixed text-xs font-bold"
        >
          YT
        </div>
      </div>
    </nav>
  );
}
