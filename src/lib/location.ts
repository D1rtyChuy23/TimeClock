/**
 * Where a remote worker was when they clocked in or out.
 *
 * Only people an admin marks as remote (Team > person > "Remote worker") are
 * asked, and only at the moment they tap Clock in / Clock out: the app never
 * tracks anyone in between. If the location can't be read (turned off, no
 * signal, too slow), the punch still counts and the reason is saved instead,
 * so the pay report can list it for an admin.
 *
 * Pure except `getLocation`, which uses the browser. Tested in `location.test.ts`.
 */

export type PunchLocation = {
  lat: number;
  lng: number;
  /** How close the reading is, in meters, as the device reports it. */
  acc: number;
};

export const LOCATION_MISSES = ["denied", "unavailable", "timeout", "unsupported"] as const;
export type LocationMiss = (typeof LOCATION_MISSES)[number];

export type LocationResult = { ok: true; loc: PunchLocation } | { ok: false; miss: LocationMiss };

/** How long a tap waits for a reading before the punch goes through without one. */
export const LOCATION_WAIT_MS = 10_000;

const round = (n: number, places: number) => Math.round(n * 10 ** places) / 10 ** places;

/** A location from the screen, checked. Rounded to about 1 meter. Anything odd is dropped. */
export function parseLocation(raw: unknown): PunchLocation | null {
  if (!raw || typeof raw !== "object") return null;
  const o = raw as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  const acc = Number(o.acc);
  if (![lat, lng, acc].every(Number.isFinite)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180 || acc < 0 || acc > 100_000) return null;
  return { lat: round(lat, 5), lng: round(lng, 5), acc: Math.round(acc) };
}

export function parseMiss(raw: unknown): LocationMiss | null {
  return (LOCATION_MISSES as readonly unknown[]).includes(raw) ? (raw as LocationMiss) : null;
}

/** Opens the spot in the phone's map app, or Google Maps in a browser. */
export function mapUrl(loc: PunchLocation): string {
  return `https://www.google.com/maps/search/?api=1&query=${loc.lat},${loc.lng}`;
}

export function fmtCoords(loc: PunchLocation): string {
  return `${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)}`;
}

/** Accuracy in feet, rounded so it reads easily (the team is in the US). */
export function accuracyFeet(loc: PunchLocation): number {
  const ft = loc.acc * 3.28084;
  return ft < 100 ? Math.max(5, Math.round(ft / 5) * 5) : Math.round(ft / 50) * 50;
}

/** Map a browser GeolocationPositionError code to why the reading is missing. */
export function missFromCode(code: number): LocationMiss {
  return code === 1 ? "denied" : code === 3 ? "timeout" : "unavailable";
}

/** One reading from the device. Never throws and never waits longer than `ms`. */
export function getLocation(ms = LOCATION_WAIT_MS): Promise<LocationResult> {
  if (typeof navigator === "undefined" || !("geolocation" in navigator)) {
    return Promise.resolve({ ok: false, miss: "unsupported" });
  }
  return new Promise((resolve) => {
    let done = false;
    const finish = (r: LocationResult) => {
      if (done) return;
      done = true;
      window.clearTimeout(timer);
      resolve(r);
    };
    // Backstop: some browsers never call back if the prompt is left open.
    const timer = window.setTimeout(() => finish({ ok: false, miss: "timeout" }), ms + 500);
    try {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const loc = parseLocation({ lat: pos.coords.latitude, lng: pos.coords.longitude, acc: pos.coords.accuracy });
          finish(loc ? { ok: true, loc } : { ok: false, miss: "unavailable" });
        },
        (err) => finish({ ok: false, miss: missFromCode(err.code) }),
        { enableHighAccuracy: true, timeout: ms, maximumAge: 60_000 },
      );
    } catch {
      finish({ ok: false, miss: "unavailable" });
    }
  });
}
