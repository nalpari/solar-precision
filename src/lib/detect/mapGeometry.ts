// src/lib/detect/mapGeometry.ts
// Helpers for converting between viewport pixels and LatLng on a Google Maps instance,
// and for waiting until the map has fully settled after camera changes.

import type { CapturedRect } from "@/components/DetectionContext";

type GMap = google.maps.Map;
type LatLng = google.maps.LatLng;
type LatLngBounds = google.maps.LatLngBounds;

/** Singleton OverlayView per map. The OverlayView is required to obtain a
 *  MapCanvasProjection, which gives accurate container-pixel ↔ LatLng conversion. */
const projectionCache = new WeakMap<
  GMap,
  {
    overlay: google.maps.OverlayView;
    ready: Promise<google.maps.MapCanvasProjection>;
  }
>();

function getProjection(
  map: GMap,
): Promise<google.maps.MapCanvasProjection> {
  const cached = projectionCache.get(map);
  if (cached) return cached.ready;

  let resolve!: (p: google.maps.MapCanvasProjection) => void;
  const ready = new Promise<google.maps.MapCanvasProjection>((res) => {
    resolve = res;
  });

  const overlay = new google.maps.OverlayView();
  overlay.onAdd = () => {};
  overlay.onRemove = () => {};
  overlay.draw = () => {
    const proj = overlay.getProjection();
    if (proj) resolve(proj);
  };
  overlay.setMap(map);

  projectionCache.set(map, { overlay, ready });
  return ready;
}

export async function pixelRectToLatLngBounds(
  map: GMap,
  rect: CapturedRect,
): Promise<LatLngBounds> {
  const proj = await getProjection(map);
  const sw = proj.fromContainerPixelToLatLng(
    new google.maps.Point(rect.left, rect.top + rect.height),
  );
  const ne = proj.fromContainerPixelToLatLng(
    new google.maps.Point(rect.left + rect.width, rect.top),
  );
  if (!sw || !ne) {
    throw new Error("LatLng 변환 실패: projection이 픽셀을 매핑하지 못함");
  }
  return new google.maps.LatLngBounds(sw, ne);
}

export async function latLngBoundsToPixelRect(
  map: GMap,
  bounds: LatLngBounds,
): Promise<CapturedRect> {
  const proj = await getProjection(map);
  const sw: LatLng = bounds.getSouthWest();
  const ne: LatLng = bounds.getNorthEast();
  const swPx = proj.fromLatLngToContainerPixel(sw);
  const nePx = proj.fromLatLngToContainerPixel(ne);
  if (!swPx || !nePx) {
    throw new Error("픽셀 변환 실패: projection이 LatLng를 매핑하지 못함");
  }
  const left = Math.round(Math.min(swPx.x, nePx.x));
  const right = Math.round(Math.max(swPx.x, nePx.x));
  const top = Math.round(Math.min(swPx.y, nePx.y));
  const bottom = Math.round(Math.max(swPx.y, nePx.y));
  return {
    left,
    top,
    width: Math.max(1, right - left),
    height: Math.max(1, bottom - top),
  };
}

/** Lightweight settle used on non-capture camera changes (e.g., restoring the
 *  original camera when the user re-selects or cancels). Waits for a single
 *  `idle` event and yields two animation frames. Does NOT wait for
 *  `tilesloaded` — on restores the target camera state is often already fully
 *  tiled, so `tilesloaded` may never fire. The 800 ms safety cap keeps the
 *  UX responsive even when `idle` doesn't fire. */
export function waitForMapSettled(map: GMap): Promise<void> {
  return new Promise((resolve) => {
    let done = false;
    const finish = () => {
      if (done) return;
      done = true;
      google.maps.event.removeListener(idleListener);
      clearTimeout(safety);
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
    };
    const idleListener = google.maps.event.addListenerOnce(map, "idle", finish);
    const safety = setTimeout(finish, 800);
  });
}

/** Wait until both `idle` AND `tilesloaded` have fired, then yield a short
 *  delay so Google Maps' tile fade-in animation finishes before we capture.
 *
 *  `idle` alone is not enough: it fires when the camera stops moving, but the
 *  new tiles may still be fetching/swapping. When tiles were cached from a
 *  prior capture, `idle` fires so fast that Google Maps is still mid-swap and
 *  html-to-image ends up snapshotting the previous zoom's upscaled tiles —
 *  producing blurry output that looks like "broken tiles" on the 2nd capture.
 *  Waiting for `tilesloaded` (fires after all visible tiles finish loading)
 *  eliminates that race. */
export function waitForMapIdle(map: GMap): Promise<void> {
  return new Promise((resolve) => {
    let idleFired = false;
    let tilesLoadedFired = false;
    let done = false;

    const finish = () => {
      if (done) return;
      done = true;
      google.maps.event.removeListener(idleListener);
      google.maps.event.removeListener(tilesListener);
      clearTimeout(safety);
      // Yield a few frames + a micro-delay for tile fade-in (≈200 ms default).
      requestAnimationFrame(() => {
        setTimeout(() => {
          requestAnimationFrame(() => resolve());
        }, 250);
      });
    };

    const maybeFinish = () => {
      if (idleFired && tilesLoadedFired) finish();
    };

    const idleListener = google.maps.event.addListenerOnce(map, "idle", () => {
      idleFired = true;
      maybeFinish();
    });
    const tilesListener = google.maps.event.addListenerOnce(
      map,
      "tilesloaded",
      () => {
        tilesLoadedFired = true;
        maybeFinish();
      },
    );

    // Safety net: if one of the events never fires (e.g., camera already at
    // target with tiles cached), don't hang forever.
    const safety = setTimeout(() => {
      idleFired = true;
      tilesLoadedFired = true;
      finish();
    }, 3000);
  });
}
