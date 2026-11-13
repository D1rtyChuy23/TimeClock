/**
 * Pay periods, PTO days and the payroll report. Pure: no React, no database.
 *
 * Pay is every two weeks. Periods run Monday through the Sunday 13 days later,
 * counted from PAY_ANCHOR in both directions. All days are the viewer's local
 * days (the shop's time zone, since admins pull reports at the shop).
 *
 * Tested in `pay-period.test.ts`.
 */

/** The first Monday of the bi-weekly cycle. Every period starts a multiple of 14 days from here. */
export const PAY_ANCHOR = "2026-11-09";
export const PERIOD_DAYS = 14;
/** One PTO day is paid as this many hours. */
export const PTO_DAY_HOURS = 8;
/** A finished shift longer than this was probably a forgotten clock-out. */
export const LONG_SHIFT_HOURS = 12;

const DAY_MS = 86_400_000;

/** Local midnight of a `YYYY-MM-DD` day. */
export function parseDay(day: string): Date {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(y, (m || 1) - 1, d || 1);
}

/** `YYYY-MM-DD` of a local date. */
export function dayKey(d: Date): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function addLocalDays(d: Date, n: number): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() + n);
  return x;
}

/** Whole local days from a to b. Rounding absorbs daylight-saving hours. */
function daysBetween(a: Date, b: Date): number {
  const a0 = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const b0 = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  return Math.round((b0.getTime() - a0.getTime()) / DAY_MS);
}

export type PayPeriod = {
  /** 0 is the period starting on PAY_ANCHOR; earlier periods are negative. */
  index: number;
  /** Local midnight of the first day (a Monday). */
  start: Date;
  /** Local midnight of the second Monday: week 1 is [start, mid), week 2 is [mid, end). */
  mid: Date;
  /** Local midnight after the last day (exclusive). */
  end: Date;
  /** `YYYY-MM-DD` of the first and last days. */
  firstDay: string;
  lastDay: string;
};

export function payPeriod(index: number): PayPeriod {
  const start = addLocalDays(parseDay(PAY_ANCHOR), index * PERIOD_DAYS);
  const mid = addLocalDays(start, 7);
  const end = addLocalDays(start, PERIOD_DAYS);
  return { index, start, mid, end, firstDay: dayKey(start), lastDay: dayKey(addLocalDays(end, -1)) };
}

/** The index of the pay period containing local date `d`. */
export function payPeriodIndex(d: Date): number {
  return Math.floor(daysBetween(parseDay(PAY_ANCHOR), d) / PERIOD_DAYS);
}

export function payPeriodOf(d: Date): PayPeriod {
  return payPeriod(payPeriodIndex(d));
}

/** Hours of [a, b) that fall inside [lo, hi). */
function overlapHours(a: number, b: number, lo: number, hi: number): number {
  const x = Math.max(a, lo);
  const y = Math.min(b, hi);
  return y > x ? (y - x) / 3_600_000 : 0;
}

// ---------------------------------------------------------------------------
// The report
// ---------------------------------------------------------------------------

export type ReportPerson = { userId: string; fullName: string; email: string; ptoAllowance: number };
export type ReportPunch = {
  id: number;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  manual: boolean;
  /** Tapped offline and sent later, stamped with the device's time. */
  late?: boolean;
};
/** Approved time off only. */
export type ReportPto = { userId: string; day: string; hours: number };

/**
 * Why a shift needs a look:
 * - open:   still clocked in from an earlier day (forgot to clock out). Counts 0 hours until fixed.
 * - long:   a finished shift over LONG_SHIFT_HOURS (clocked out late, probably forgot).
 * - late:   tapped while the device was offline and sent later. Listed so the time can be checked.
 * - manual: added by an admin (a missed punch that was filled in). Listed so it can be checked.
 */
export type MissedKind = "open" | "long" | "late" | "manual";
export type MissedPunch = { punchId: number; userId: string; clockIn: string; clockOut: string | null; kind: MissedKind };

export type ReportRow = {
  userId: string;
  name: string;
  email: string;
  week1: number;
  week2: number;
  worked: number;
  ptoDays: number;
  ptoHours: number;
  /** Worked hours plus PTO hours: what to pay. */
  total: number;
  /** PTO days left for the calendar year the period ends in. */
  ptoDaysLeft: number;
  missed: number;
};

/** One shift as it counts toward this period. */
export type ReportShift = {
  punchId: number;
  userId: string;
  clockIn: string;
  clockOut: string | null;
  /** Hours inside this pay period (0 for a shift left open on an earlier day). */
  hours: number;
  kind: MissedKind | null;
};

export type PayReport = { period: PayPeriod; rows: ReportRow[]; missed: MissedPunch[]; shifts: ReportShift[] };

/** The kind of problem with one shift, if any. `todayStart` is local midnight of today. */
export function missedKind(p: ReportPunch, todayStart: Date): MissedKind | null {
  const a = new Date(p.clockIn).getTime();
  if (!p.clockOut) return a < todayStart.getTime() ? "open" : null;
  const hours = (new Date(p.clockOut).getTime() - a) / 3_600_000;
  if (hours > LONG_SHIFT_HOURS) return "long";
  if (p.late) return "late";
  return p.manual ? "manual" : null;
}

export function buildPayReport(input: {
  people: ReportPerson[];
  punches: ReportPunch[];
  /** Approved PTO for the whole calendar year the period ends in (for "days left"). */
  pto: ReportPto[];
  period: PayPeriod;
  now: Date;
}): PayReport {
  const { people, punches, pto, period, now } = input;
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const [s, m, e] = [period.start.getTime(), period.mid.getTime(), period.end.getTime()];
  const year = period.lastDay.slice(0, 4);
  const missed: MissedPunch[] = [];
  const shifts: ReportShift[] = [];

  const rows = people.map((person): ReportRow => {
    let week1 = 0;
    let week2 = 0;
    let flagged = 0;
    for (const p of punches) {
      if (p.userId !== person.userId) continue;
      const a = new Date(p.clockIn).getTime();
      const kind = missedKind(p, todayStart);
      // An open shift from an earlier day has no real end: pay nothing until an admin fixes it.
      const b = p.clockOut ? new Date(p.clockOut).getTime() : kind === "open" ? a : now.getTime();
      const h1 = overlapHours(a, b, s, m);
      const h2 = overlapHours(a, b, m, e);
      week1 += h1;
      week2 += h2;
      if (h1 + h2 > 0 || (a >= s && a < e)) {
        shifts.push({ punchId: p.id, userId: p.userId, clockIn: p.clockIn, clockOut: p.clockOut, hours: h1 + h2, kind });
      }
      if (kind && a >= s && a < e) {
        flagged += 1;
        missed.push({ punchId: p.id, userId: p.userId, clockIn: p.clockIn, clockOut: p.clockOut, kind });
      }
    }
    const mine = pto.filter((r) => r.userId === person.userId);
    const ptoHours = mine
      .filter((r) => r.day >= period.firstDay && r.day <= period.lastDay)
      .reduce((sum, r) => sum + r.hours, 0);
    const usedThisYear = mine.filter((r) => r.day.startsWith(year)).reduce((sum, r) => sum + r.hours, 0);
    const worked = week1 + week2;
    return {
      userId: person.userId,
      name: person.fullName || person.email,
      email: person.email,
      week1,
      week2,
      worked,
      ptoDays: ptoHours / PTO_DAY_HOURS,
      ptoHours,
      total: worked + ptoHours,
      ptoDaysLeft: (person.ptoAllowance - usedThisYear) / PTO_DAY_HOURS,
      missed: flagged,
    };
  });

  rows.sort((x, y) => x.name.localeCompare(y.name));
  missed.sort((x, y) => x.clockIn.localeCompare(y.clockIn));
  shifts.sort((x, y) => x.clockIn.localeCompare(y.clockIn));
  return { period, rows, missed, shifts };
}

// ---------------------------------------------------------------------------
// Spreadsheet export
// ---------------------------------------------------------------------------

function cell(v: string | number): string {
  const s = typeof v === "number" ? (Math.round(v * 100) / 100).toFixed(2) : v;
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** CSV text from a header row and data rows. Opens cleanly in Excel and Google Sheets. */
export function toCsv(header: string[], rows: Array<Array<string | number>>): string {
  return [header, ...rows].map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}
