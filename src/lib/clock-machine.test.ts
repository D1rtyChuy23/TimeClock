import assert from "node:assert/strict";
import { test } from "node:test";
import {
  LOAD,
  PTO_NEXT,
  canPto,
  canSetRole,
  nextLoad,
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
