/**
 * Clock-in rules and work sites. Pure: no React, no database. The server uses
 * `siteCheck` to refuse a punch away from a work site, and the screen uses the
 * same function first, so it can say how far away the person is.
 *
 * Each person has one clock-in rule, set by an admin in Team:
 *
 *   anywhere  clock in and out from anywhere; no location is read (the default)
 *   remote    clock in and out from anywhere; the location is saved with each punch
 *   onsite    clock in and out only inside a work site; the location is read,
 *             checked and saved with each punch
 *
 * Tested in `work-sites.test.ts`.
 */
import type { PunchLocation } from "./location.ts";

export const CLOCK_RULES = ["anywhere", "remote", "onsite"] as const;
export type ClockRule = (typeof CLOCK_RULES)[number];

export function parseClockRule(raw: unknown): ClockRule {
  return (CLOCK_RULES as readonly unknown[]).includes(raw) ? (raw as ClockRule) : "anywhere";
}

/** Whether a punch under this rule reads the device location. */
export function readsLocation(rule: ClockRule): boolean {
  return rule !== "anywhere";
}

export type WorkSite = { id: number; name: string; lat: number; lng: number; radiusM: number };

/** The choices an admin picks from, in feet, with the meters stored. */
export const RADIUS_CHOICES = [
  { feet: 300, meters: 91 },
  { feet: 500, meters: 152 },
  { feet: 1000, meters: 305 },
  { feet: 2640, meters: 805 },
] as const;
export const DEFAULT_RADIUS_M = 152;

/**
 * Some slack for an imperfect reading: up to this many meters of the phone's own
 * accuracy counts toward being inside. More than that and the reading is too rough
 * to trust either way.
 */
export const ACCURACY_ALLOWANCE_M = 75;
export const TOO_ROUGH_M = 500;

/** Straight-line distance in meters (haversine). */
export function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6_371_000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

export type SiteCheck =
  | { ok: true; site: WorkSite }
  | { ok: false; reason: "no_sites" }
  | { ok: false; reason: "rough_location"; site: WorkSite; distanceM: number }
  | { ok: false; reason: "off_site"; site: WorkSite; distanceM: number };

/** Is this reading inside a work site? Names the nearest one either way. */
export function siteCheck(loc: PunchLocation, sites: WorkSite[]): SiteCheck {
  if (sites.length === 0) return { ok: false, reason: "no_sites" };
  let best = sites[0];
  let bestGap = Infinity;
  let bestDist = Infinity;
  for (const site of sites) {
    const d = distanceM(loc, site);
    const gap = d - site.radiusM;
    if (gap < bestGap) {
      best = site;
      bestGap = gap;
      bestDist = d;
    }
  }
  const slack = Math.min(loc.acc, ACCURACY_ALLOWANCE_M);
  if (bestGap <= slack) return { ok: true, site: best };
  // A rough reading that might still be inside: ask for a better one instead of saying "too far".
  if (loc.acc > TOO_ROUGH_M && bestGap <= loc.acc) return { ok: false, reason: "rough_location", site: best, distanceM: bestDist };
  return { ok: false, reason: "off_site", site: best, distanceM: bestDist };
}

/** Distance for people, in the US style the team uses: feet up to a tenth of a mile, then miles. */
export function fmtDistance(meters: number): string {
  const feet = meters * 3.28084;
  if (feet < 528) return `${Math.max(10, Math.round(feet / 10) * 10)} ft`;
  const miles = feet / 5280;
  return `${miles < 10 ? miles.toFixed(1) : Math.round(miles)} mi`;
}

/** "33.57791, -101.85520" or a Google Maps link pasted by an admin, read as a point. */
export function parseCoords(text: string): { lat: number; lng: number } | null {
  const m = text.match(/(-?\d{1,2}(?:\.\d+)?)\s*,\s*(-?\d{1,3}(?:\.\d+)?)/);
  if (!m) return null;
  const lat = Number(m[1]);
  const lng = Number(m[2]);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || Math.abs(lat) > 90 || Math.abs(lng) > 180) return null;
  return { lat, lng };
}
