/**
 * Working without internet. Everything here lives on the device (localStorage):
 *
 * - The punch queue: Clock in / Clock out taps made with no connection, sent in
 *   order when it comes back (rules in clock-machine.ts, `queuedOutcome`).
 * - The last good data, so the app opens offline on what it last showed
 *   (the screen machine's RESTORED event) instead of an error.
 * - The last signed-in person, so an offline reload doesn't fall back to sign-in.
 *
 * The server never trusts any of this: queued punches are checked when they
 * arrive, and saved data is only ever shown, under the "no connection" notice.
 * Tested in `offline.test.ts`.
 */
import type { Punch, Snapshot } from "@/lib/timeclock.functions";

export type QueuedPunch = {
  /** Unique per tap, so the same punch is never queued twice. */
  id: string;
  action: "in" | "out";
  /** When it was tapped, corrected by the last known gap between this device's clock and the server's. */
  at: string;
};

const QUEUE_KEY = (userId: string) => `tc-queue:${userId}`;
const SNAPSHOT_KEY = "tc-last-snapshot";
const USER_KEY = "tc-last-user";

function read<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown): void {
  try {
    if (value == null) window.localStorage.removeItem(key);
    else window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage full or blocked: offline support is best-effort */
  }
}

function isQueued(v: unknown): v is QueuedPunch {
  const o = v as QueuedPunch;
  return !!o && typeof o.id === "string" && (o.action === "in" || o.action === "out") && !Number.isNaN(Date.parse(o.at));
}

export function readQueue(userId: string): QueuedPunch[] {
  const list = read<unknown[]>(QUEUE_KEY(userId));
  return Array.isArray(list) ? list.filter(isQueued) : [];
}

export function writeQueue(userId: string, queue: QueuedPunch[]): void {
  write(QUEUE_KEY(userId), queue.length ? queue : null);
}

/** The data last shown to this person, and the server-minus-device clock gap at that moment. */
export type SavedSnapshot = { userId: string; snap: Snapshot; offsetMs: number };

export function saveSnapshot(snap: Snapshot, offsetMs: number): void {
  write(SNAPSHOT_KEY, { userId: snap.me.userId, snap, offsetMs } satisfies SavedSnapshot);
}

export function readSnapshot(userId: string): SavedSnapshot | null {
  const saved = read<SavedSnapshot>(SNAPSHOT_KEY);
  return saved && saved.userId === userId && saved.snap?.me ? saved : null;
}

export type SavedUser = { id: string; name: string | null; email: string | null };

export function rememberUser(user: SavedUser | null): void {
  write(USER_KEY, user);
  // Signing out also forgets what was on screen. Queued punches stay: they are sent
  // the next time that person signs in on this device.
  if (!user) write(SNAPSHOT_KEY, null);
}

export function rememberedUser(): SavedUser | null {
  const u = read<SavedUser>(USER_KEY);
  return u && typeof u.id === "string" ? u : null;
}

/** The shift state this person will have once their queued punches reach the server. */
export function withQueued(punches: Punch[], userId: string, queue: QueuedPunch[]): Punch[] {
  let list = punches.map((p) => ({ ...p }));
  queue.forEach((q, n) => {
    const open = list.find((p) => p.userId === userId && !p.clockOut);
    if (q.action === "in" && !open) {
      list = [
        { id: -(n + 1), userId, clockIn: q.at, clockOut: null, manual: false, late: true, createdBy: userId, pending: true },
        ...list,
      ];
    } else if (q.action === "out" && open && Date.parse(q.at) > Date.parse(open.clockIn)) {
      open.clockOut = q.at;
      open.late = true;
      open.pending = true;
    }
  });
  return list;
}

/** True when an error from a server call means "couldn't reach it", not "it said no". */
export function isOffline(e: unknown): boolean {
  if (typeof navigator !== "undefined" && navigator.onLine === false) return true;
  return e instanceof TypeError || (e instanceof Error && /fetch|network|load failed/i.test(e.message));
}
