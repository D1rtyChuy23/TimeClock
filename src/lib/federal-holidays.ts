/**
 * The 11 United States federal holidays for a year, on their actual calendar
 * dates (not the "observed" weekday when one lands on a weekend).
 *
 * These are only suggestions on the calendar. The shop is closed on one only
 * after an admin switches it on, which saves it as an ordinary `holidays` row.
 */
export const FEDERAL_KEYS = [
  "newYear",
  "mlk",
  "presidents",
  "memorial",
  "juneteenth",
  "independence",
  "labor",
  "columbus",
  "veterans",
  "thanksgiving",
  "christmas",
] as const;
export type FederalKey = (typeof FEDERAL_KEYS)[number];
export type FederalHoliday = { key: FederalKey; day: string };

const ymd = (y: number, m: number, d: number) => `${y}-${String(m).padStart(2, "0")}-${String(d).padStart(2, "0")}`;

/** Day of month of the nth `weekday` (0 = Sunday) in `month` (1-12). */
function nth(year: number, month: number, weekday: number, n: number): number {
  const first = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  return 1 + ((weekday - first + 7) % 7) + (n - 1) * 7;
}

/** Day of month of the last `weekday` in `month`. */
function last(year: number, month: number, weekday: number): number {
  const days = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = new Date(Date.UTC(year, month - 1, days)).getUTCDay();
  return days - ((end - weekday + 7) % 7);
}

export function federalHolidays(year: number): FederalHoliday[] {
  return [
    { key: "newYear", day: ymd(year, 1, 1) },
    { key: "mlk", day: ymd(year, 1, nth(year, 1, 1, 3)) },
    { key: "presidents", day: ymd(year, 2, nth(year, 2, 1, 3)) },
    { key: "memorial", day: ymd(year, 5, last(year, 5, 1)) },
    { key: "juneteenth", day: ymd(year, 6, 19) },
    { key: "independence", day: ymd(year, 7, 4) },
    { key: "labor", day: ymd(year, 9, nth(year, 9, 1, 1)) },
    { key: "columbus", day: ymd(year, 10, nth(year, 10, 1, 2)) },
    { key: "veterans", day: ymd(year, 11, 11) },
    { key: "thanksgiving", day: ymd(year, 11, nth(year, 11, 4, 4)) },
    { key: "christmas", day: ymd(year, 12, 25) },
  ];
}

/** The federal holiday on `day` (YYYY-MM-DD), if there is one. */
export function federalOn(day: string): FederalHoliday | null {
  return federalHolidays(Number(day.slice(0, 4))).find((h) => h.day === day) ?? null;
}
