/** Local Monday 00:00 of the week containing `d`. Weeks are Monday–Sunday. */
export function weekStart(d: Date): Date {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const day = x.getDay();
  const diff = day === 0 ? 6 : day - 1;
  x.setDate(x.getDate() - diff);
  return x;
}

export function addDays(d: Date, n: number): Date {
  const x = new Date(d);
  x.setDate(x.getDate() + n);
  return x;
}

export function dayStart(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

export type PunchSpan = { clockIn: string; clockOut: string | null };

/** Hours of `punches` that overlap [start, end). Open punches run until `now`. */
export function hoursIn(punches: PunchSpan[], start: Date, end: Date, now: Date): number {
  const winA = start.getTime();
  const winB = end.getTime();
  const nowMs = now.getTime();
  let ms = 0;
  for (const p of punches) {
    const a = new Date(p.clockIn).getTime();
    const b = p.clockOut ? new Date(p.clockOut).getTime() : nowMs;
    if (!Number.isFinite(a) || !Number.isFinite(b) || b <= a) continue;
    const lo = Math.max(a, winA);
    const hi = Math.min(b, winB);
    if (hi > lo) ms += hi - lo;
  }
  return ms / 3_600_000;
}

export function ptoUsed(
  rows: { day: string; hours: number; status: string }[],
  year: number,
): number {
  let sum = 0;
  for (const r of rows) {
    if (r.status !== "approved") continue;
    if (Number(r.day.slice(0, 4)) !== year) continue;
    sum += Number(r.hours);
  }
  return sum;
}

/** Whole days from local today until `YYYY-MM-DD`. Today is 0. */
export function daysUntil(day: string, today: Date): number {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(y, (m || 1) - 1, d || 1);
  const t0 = dayStart(today);
  return Math.round((target.getTime() - t0.getTime()) / 86_400_000);
}

export function fmtHours(n: number): string {
  if (!Number.isFinite(n)) return "0.00";
  return (Math.round(n * 100) / 100).toFixed(2);
}

export function fmtHms(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000));
  const hh = Math.floor(s / 3600);
  const mm = Math.floor((s % 3600) / 60);
  const ss = s % 60;
  return [hh, mm, ss].map((n) => String(n).padStart(2, "0")).join(":");
}

export function selfCheck(): void {
  const sat = new Date(2026, 10, 7, 18, 30, 0);
  const ws = weekStart(sat);
  if (ws.getFullYear() !== 2026 || ws.getMonth() !== 10 || ws.getDate() !== 2 || ws.getHours() !== 0) {
    throw new Error(`weekStart saturday -> ${ws.toString()}`);
  }
  const sun = weekStart(new Date(2026, 10, 8, 1, 0, 0));
  if (sun.getDate() !== 2) throw new Error("weekStart sunday");
  const mon = new Date(2026, 10, 2, 0, 0, 0);
  if (weekStart(mon).getTime() !== mon.getTime()) throw new Error("weekStart monday");

  const dayA = new Date(2026, 10, 7, 0, 0, 0);
  const dayB = new Date(2026, 10, 8, 0, 0, 0);
  const closed = hoursIn(
    [
      {
        clockIn: new Date(2026, 10, 7, 9, 0, 0).toISOString(),
        clockOut: new Date(2026, 10, 7, 12, 30, 0).toISOString(),
      },
    ],
    dayA,
    dayB,
    new Date(2026, 10, 7, 15, 0, 0),
  );
  if (Math.abs(closed - 3.5) > 0.001) throw new Error(`closed hours ${closed}`);

  const open = hoursIn(
    [{ clockIn: new Date(2026, 10, 7, 8, 0, 0).toISOString(), clockOut: null }],
    dayA,
    dayB,
    new Date(2026, 10, 7, 10, 30, 0),
  );
  if (Math.abs(open - 2.5) > 0.001) throw new Error(`open hours ${open}`);

  const weekS = weekStart(sat);
  const weekE = addDays(weekS, 7);
  const overnight = hoursIn(
    [
      {
        clockIn: new Date(2026, 10, 1, 22, 0, 0).toISOString(),
        clockOut: new Date(2026, 10, 2, 2, 0, 0).toISOString(),
      },
    ],
    weekS,
    weekE,
    new Date(2026, 10, 7, 12, 0, 0),
  );
  if (Math.abs(overnight - 2) > 0.001) throw new Error(`overnight ${overnight}`);

  const used = ptoUsed(
    [
      { day: "2026-03-01", hours: 8, status: "approved" },
      { day: "2026-04-01", hours: 4, status: "pending" },
      { day: "2025-12-01", hours: 8, status: "approved" },
      { day: "2026-05-01", hours: 2, status: "denied" },
    ],
    2026,
  );
  if (used !== 8) throw new Error(`pto ${used}`);

  if (daysUntil("2026-11-07", new Date(2026, 10, 7, 23, 0, 0)) !== 0) throw new Error("days 0");
  if (daysUntil("2026-11-08", new Date(2026, 10, 7, 1, 0, 0)) !== 1) throw new Error("days 1");
  if (daysUntil("2026-11-06", new Date(2026, 10, 7, 12, 0, 0)) !== -1) throw new Error("days -1");
}
