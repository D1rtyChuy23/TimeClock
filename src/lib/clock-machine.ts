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
//
//    failed: nothing to show yet, full "couldn't load" card with a retry.
//    stale:  the last good data stays on screen under a "no connection" notice.
// ---------------------------------------------------------------------------
export type LoadStatus = "booting" | "failed" | "ready" | "stale";
export type LoadEvent = "LOADED" | "FAILED";

export const LOAD: Record<LoadStatus, Record<LoadEvent, LoadStatus>> = {
  booting: { LOADED: "ready", FAILED: "failed" },
  failed: { LOADED: "ready", FAILED: "failed" },
  ready: { LOADED: "ready", FAILED: "stale" },
  stale: { LOADED: "ready", FAILED: "stale" },
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
