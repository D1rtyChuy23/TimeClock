import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOAD,
  PTO_NEXT,
  canPto,
  canSetRole,
  inviteState,
  viewFor,
  nextLoad,
  queuedOutcome,
  sessionState,
  sessionUserId,
  syncState,
  ptoActions,
  shiftAction,
  type LoadStatus,
  type PtoStatus,
} from "./clock-machine.ts";

test("screen: every transition lands on a known state", () => {
  for (const from of Object.keys(LOAD) as LoadStatus[]) {
    for (const to of Object.values(LOAD[from])) assert.ok(to in LOAD, `${from} -> ${to}`);
  }
});

test("screen: a first-load failure and a later failure are different states", () => {
  assert.equal(nextLoad("booting", "FAILED"), "failed");
  assert.equal(nextLoad("ready", "FAILED"), "stale");
  assert.equal(nextLoad("stale", "FAILED"), "stale");
  assert.equal(nextLoad("failed", "LOADED"), "ready");
  assert.equal(nextLoad("stale", "LOADED"), "ready");
});

test("screen: saved data opens the app offline instead of an error", () => {
  assert.equal(nextLoad("booting", "RESTORED"), "stale");
  assert.equal(nextLoad("failed", "RESTORED"), "stale");
  assert.equal(nextLoad("ready", "RESTORED"), "ready", "fresh data is never replaced by saved data");
  assert.equal(nextLoad("stale", "LOADED"), "ready");
});

test("offline punches: what happens to a queued punch for each answer", () => {
  assert.equal(queuedOutcome({ ok: true }), "saved");
  assert.equal(queuedOutcome({ ok: false, error: "already_in" }), "dropped");
  assert.equal(queuedOutcome({ ok: false, error: "already_out" }), "dropped");
  assert.equal(queuedOutcome({ ok: false, error: "overlap" }), "rejected");
  assert.equal(queuedOutcome({ ok: false, error: "too_old" }), "rejected");
  assert.equal(queuedOutcome({ ok: false, error: "error" }), "keep");
});

test("shift: the button offers the opposite of what the screen shows", () => {
  assert.equal(shiftAction(false), "in");
  assert.equal(shiftAction(true), "out");
});

const employee = { owner: true, admin: false, daysUntil: 3 };
const stranger = { owner: false, admin: false, daysUntil: 3 };
const admin = { owner: false, admin: true, daysUntil: 3 };

test("time off: an employee can only cancel, and only their own", () => {
  assert.deepEqual(ptoActions("pending", employee), ["cancel"]);
  assert.deepEqual(ptoActions("approved", employee), ["cancel"]);
  assert.deepEqual(ptoActions("denied", employee), []);
  for (const status of ["pending", "approved", "denied"] as PtoStatus[]) {
    assert.deepEqual(ptoActions(status, stranger), []);
  }
});

test("time off: an approved day can be cancelled through the day itself, not after", () => {
  assert.ok(canPto("cancel", "approved", { ...employee, daysUntil: 0 }));
  assert.ok(!canPto("cancel", "approved", { ...employee, daysUntil: -1 }));
  assert.ok(canPto("cancel", "pending", { ...employee, daysUntil: -1 }));
});

test("time off: an admin decides pending requests and can undo a decision", () => {
  assert.deepEqual(ptoActions("pending", admin), ["approve", "deny", "cancel"]);
  assert.deepEqual(ptoActions("approved", admin), ["reopen", "cancel"]);
  assert.deepEqual(ptoActions("denied", admin), ["reopen", "cancel"]);
  assert.ok(!canPto("approve", "denied", admin), "a decided request must be reopened first");
  assert.deepEqual(PTO_NEXT, { approve: "approved", deny: "denied", reopen: "pending" });
});

test("role: the last admin cannot be made an employee", () => {
  assert.ok(!canSetRole("employee", 0));
  assert.ok(canSetRole("employee", 1));
  assert.ok(canSetRole("admin", 0));
});

test("invitation: open until accepted or 14 days pass", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  assert.equal(inviteState({ acceptedAt: null, expiresAt: "2026-11-10T00:00:00Z" }, now), "open");
  assert.equal(inviteState({ acceptedAt: null, expiresAt: "2026-11-09T11:59:59Z" }, now), "expired");
  assert.equal(inviteState({ acceptedAt: "2026-11-01T00:00:00Z", expiresAt: "2026-11-02T00:00:00Z" }, now), "accepted");
});

test("section: unknown and admin-only sections fall back to the clock", () => {
  assert.equal(viewFor("reports", true), "reports");
  assert.equal(viewFor("reports", false), "clock");
  assert.equal(viewFor("daysoff", false), "daysoff");
  assert.equal(viewFor("settings", false), "settings");
  assert.equal(viewFor("", true), "clock");
  assert.equal(viewFor("preferences", true), "clock");
});

test("sync: one answer from the screen status, the queue and the last try", () => {
  const base = { status: "ready" as LoadStatus, queued: 0, sending: false, refused: false };
  assert.equal(syncState(base), "synced");
  assert.equal(syncState({ ...base, status: "booting" }), "synced");
  assert.equal(syncState({ ...base, status: "stale" }), "offline");
  assert.equal(syncState({ ...base, status: "failed" }), "offline");
  assert.equal(syncState({ ...base, status: "stale", queued: 2 }), "waiting");
  assert.equal(syncState({ ...base, queued: 2, sending: true }), "sending");
  assert.equal(syncState({ ...base, queued: 1, refused: true }), "blocked");
  assert.equal(syncState({ ...base, queued: 1, sending: true, refused: true }), "sending", "a new try replaces the old refusal");
  assert.equal(syncState({ ...base, refused: true }), "synced", "nothing queued means nothing is blocked");
});

test("session: offline is not the same as signed out", () => {
  const base = { isPending: false, userId: null, unreachable: false, rememberedId: null };
  assert.equal(sessionState({ ...base, isPending: true, userId: "u" }), "pending");
  assert.equal(sessionState({ ...base, userId: "u" }), "signed_in");
  assert.equal(sessionState(base), "signed_out");
  assert.equal(sessionState({ ...base, rememberedId: "u" }), "signed_out", "the server said signed out: remembering does not override it");
  assert.equal(sessionState({ ...base, unreachable: true, rememberedId: "u" }), "offline_known");
  assert.equal(sessionState({ ...base, unreachable: true }), "offline_unknown");
  assert.equal(sessionUserId("signed_in", "u", "old"), "u");
  assert.equal(sessionUserId("offline_known", null, "u"), "u");
  assert.equal(sessionUserId("offline_unknown", null, null), null);
  assert.equal(sessionUserId("signed_out", null, "u"), null);
});
