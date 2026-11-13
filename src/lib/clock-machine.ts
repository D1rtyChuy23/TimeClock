/**
 * The app's state machines, in one place.
 *
 * Pure: no React, no database, no clock. The server functions use these rules to
 * decide what is allowed and the screens use the same rules to decide which
 * buttons to draw, so the two can never disagree. Change a flow here, then run
 * `npm test` (see `clock-machine.test.ts`).
 */

// ---------------------------------------------------------------------------
// 1. Screen: what the signed-in app is showing.
//
//    booting --LOADED--> ready <--LOADED-- stale
//    booting --FAILED--> failed            ready --FAILED--> stale
//    booting/failed --RESTORED--> stale
//
//    failed:   nothing to show yet, full "couldn't load" card with a retry.
//    stale:    the last good data stays on screen under a "no connection" notice.
//    RESTORED: the first load failed, but this device saved the last good data
//              (offline.ts), so the app opens on that instead of an error.
// ---------------------------------------------------------------------------
export type LoadStatus = "booting" | "failed" | "ready" | "stale";
export type LoadEvent = "LOADED" | "FAILED" | "RESTORED";

export const LOAD: Record<LoadStatus, Record<LoadEvent, LoadStatus>> = {
  booting: { LOADED: "ready", FAILED: "failed", RESTORED: "stale" },
  failed: { LOADED: "ready", FAILED: "failed", RESTORED: "stale" },
  ready: { LOADED: "ready", FAILED: "stale", RESTORED: "ready" },
  stale: { LOADED: "ready", FAILED: "stale", RESTORED: "stale" },
};

export function nextLoad(status: LoadStatus, event: LoadEvent): LoadStatus {
  return LOAD[status][event];
}

// ---------------------------------------------------------------------------
// 2. Shift: out --in--> in --out--> out, one open shift per person.
//
//    The screen says which way it wants to go instead of asking the server to
//    flip. A stale screen, a second device or a double tap then gets
//    `already_in` / `already_out` back instead of the opposite of what was meant.
// ---------------------------------------------------------------------------
export type ShiftAction = "in" | "out";

/** The move the big button offers for the shift state the screen is showing. */
export function shiftAction(onClock: boolean): ShiftAction {
  return onClock ? "out" : "in";
}

/**
 * Offline punches (offline.ts) wait on the device and are sent in order when the
 * connection is back. The server stamps them with the time they were tapped and
 * marks them `late`, so the pay report lists them for an admin to check.
 *
 *    queued --sent--> saved (late)
 *    queued --already_in / already_out--> dropped   (it already happened, e.g. on another device)
 *    queued --overlap / too_old / bad_range / future--> dropped with a warning (an admin fixes it)
 *    queued --no connection / signed out--> stays queued
 */
export const OFFLINE_MAX_DAYS = 7;
export type QueuedOutcome = "saved" | "dropped" | "rejected" | "keep";

export function queuedOutcome(result: { ok: true } | { ok: false; error: string }): QueuedOutcome {
  if (result.ok) return "saved";
  if (result.error === "already_in" || result.error === "already_out") return "dropped";
  if (["overlap", "too_old", "bad_range", "future", "not_allowed"].includes(result.error)) return "rejected";
  return "keep";
}

// ---------------------------------------------------------------------------
// 3. Time-off request.
//
//    pending --approve--> approved        (admin)
//    pending --deny-----> denied          (admin)
//    approved/denied --reopen--> pending  (admin: undo a decision)
//    pending --cancel--> gone             (owner, or admin)
//    approved --cancel--> gone            (owner until the day has passed, or admin)
// ---------------------------------------------------------------------------
export type PtoStatus = "pending" | "approved" | "denied";
export type PtoAction = "approve" | "deny" | "reopen" | "cancel";

/** Where each deciding move leaves the request. `cancel` deletes it. */
export const PTO_NEXT: Record<Exclude<PtoAction, "cancel">, PtoStatus> = {
  approve: "approved",
  deny: "denied",
  reopen: "pending",
};

export type PtoActor = {
  /** The request belongs to the person acting. */
  owner: boolean;
  admin: boolean;
  /** Whole days from the actor's today until the requested day. Today is 0, yesterday is -1. */
  daysUntil: number;
};

/** Every move this person may make on a request in this status. */
export function ptoActions(status: PtoStatus, who: PtoActor): PtoAction[] {
  const actions: PtoAction[] = [];
  if (who.admin) {
    if (status === "pending") actions.push("approve", "deny");
    else actions.push("reopen");
  }
  const ownerMay = who.owner && (status === "pending" || (status === "approved" && who.daysUntil >= 0));
  if (who.admin || ownerMay) actions.push("cancel");
  return actions;
}

export function canPto(action: PtoAction, status: PtoStatus, who: PtoActor): boolean {
  return ptoActions(status, who).includes(action);
}

// ---------------------------------------------------------------------------
// 4. Role: employee <--> admin. The first profile ever created is the admin,
//    and the team never drops to zero admins.
// ---------------------------------------------------------------------------
export type Role = "admin" | "employee";

/** May `target` be moved to `role`, given how many admins there would be without them? */
export function canSetRole(role: Role, otherAdmins: number): boolean {
  return role === "admin" || otherAdmins >= 1;
}

// ---------------------------------------------------------------------------
// 5. Invitation: open --accept--> accepted
//                open --14 days--> expired --send again--> open
//    Removing an invitation deletes it.
// ---------------------------------------------------------------------------
export const INVITE_DAYS = 14;
export type InviteState = "open" | "expired" | "accepted";

export function inviteState(invite: { acceptedAt: string | null; expiresAt: string }, now: Date): InviteState {
  if (invite.acceptedAt) return "accepted";
  return new Date(invite.expiresAt).getTime() > now.getTime() ? "open" : "expired";
}

// ---------------------------------------------------------------------------
// 6. Section (the side menu). One section shows at a time; admin-only sections
//    fall back to the clock for everyone else. The section is kept in the
//    address as `#reports` and so on, so a refresh or a bookmark opens it.
// ---------------------------------------------------------------------------
export const VIEWS = ["clock", "timeoff", "settings", "calendar", "daysoff", "team", "invite", "reports"] as const;
export type View = (typeof VIEWS)[number];
export const ADMIN_VIEWS: ReadonlySet<View> = new Set<View>(["team", "invite", "reports"]);

/** The section to show for a requested one (from the menu or the address). */
export function viewFor(requested: string, admin: boolean): View {
  const view = (VIEWS as readonly string[]).includes(requested) ? (requested as View) : "clock";
  return ADMIN_VIEWS.has(view) && !admin ? "clock" : view;
}

// ---------------------------------------------------------------------------
// 7. Sync: is this device in step with the server?
//
//    synced --load fails--> offline --load works--> synced
//    synced/offline --punch with no connection--> waiting
//    waiting --connection back--> sending --all sent--> synced
//    sending --still no connection--> waiting
//    sending --server reachable but said no (signed out, server error)--> blocked
//    blocked --Send now / next try--> sending
//
//    One answer for the notice the person sees and for `data-sync`. Before this,
//    it was spread over the screen status, the queue length and two flags, and a
//    punch stuck for another reason was wrongly shown as "waiting for internet".
// ---------------------------------------------------------------------------
export type SyncState = "synced" | "offline" | "waiting" | "sending" | "blocked";

export function syncState(input: {
  status: LoadStatus;
  /** Punches waiting on this device. */
  queued: number;
  /** The queue is being sent right now. */
  sending: boolean;
  /** The last try reached the server and it did not accept the punch. */
  refused: boolean;
}): SyncState {
  if (input.queued > 0) return input.sending ? "sending" : input.refused ? "blocked" : "waiting";
  return input.status === "stale" || input.status === "failed" ? "offline" : "synced";
}

// ---------------------------------------------------------------------------
// 8. Session: who is using this device, and do we know?
//
//    pending --> signed_in | signed_out          (the server answered)
//    pending --> offline_known                   (no answer; this device remembers who was signed in)
//    pending --> offline_unknown                 (no answer; nobody remembered)
//    offline_* --connection back--> signed_in | signed_out
//
//    offline_known opens the clock (punches queue up). offline_unknown shows
//    "connect to sign in": the sign-in form cannot work without the server.
// ---------------------------------------------------------------------------
export type SessionState = "pending" | "signed_in" | "signed_out" | "offline_known" | "offline_unknown";

export function sessionState(input: {
  isPending: boolean;
  /** The signed-in person's id, when the server confirmed one. */
  userId: string | null;
  /** The session check could not reach the server. */
  unreachable: boolean;
  /** Who was last signed in on this device (offline.ts). */
  rememberedId: string | null;
}): SessionState {
  if (input.isPending) return "pending";
  if (input.userId) return "signed_in";
  if (!input.unreachable) return "signed_out";
  return input.rememberedId ? "offline_known" : "offline_unknown";
}

/** Whose clock to open for a session state, if any. */
export function sessionUserId(state: SessionState, userId: string | null, rememberedId: string | null): string | null {
  if (state === "signed_in") return userId;
  if (state === "offline_known") return rememberedId;
  return null;
}
