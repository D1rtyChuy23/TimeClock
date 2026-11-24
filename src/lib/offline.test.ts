import assert from "node:assert/strict";
import { test } from "node:test";
import { ownSnapshot, withQueued, type QueuedPunch } from "./offline.ts";

const base = { manual: false, late: false, createdBy: "u", inLoc: null, outLoc: null, inLocMiss: null, outLocMiss: null };
const closed = { id: 1, userId: "u", clockIn: "2026-11-13T14:00:00Z", clockOut: "2026-11-13T18:00:00Z", ...base };
const q = (action: "in" | "out", at: string, id = at): QueuedPunch => ({ id, action, at });

test("a queued clock-in shows as an open shift waiting to send", () => {
  const out = withQueued([closed], "u", [q("in", "2026-11-13T19:00:00Z")]);
  assert.equal(out.length, 2);
  assert.equal(out[0].clockOut, null);
  assert.equal(out[0].pending, true);
  assert.equal(out[0].late, true);
});

test("a queued clock-in then clock-out shows one finished shift", () => {
  const out = withQueued([closed], "u", [q("in", "2026-11-13T19:00:00Z"), q("out", "2026-11-13T21:00:00Z")]);
  assert.equal(out[0].clockIn, "2026-11-13T19:00:00Z");
  assert.equal(out[0].clockOut, "2026-11-13T21:00:00Z");
});

test("a queued clock-out closes the shift that was open on the server", () => {
  const open = { ...closed, clockOut: null };
  const out = withQueued([open], "u", [q("out", "2026-11-13T20:00:00Z")]);
  assert.equal(out[0].clockOut, "2026-11-13T20:00:00Z");
  assert.equal(out[0].pending, true);
  assert.equal(open.clockOut, null, "the server's copy is left alone");
});

test("queued taps that don't fit (in while in, out before the start) change nothing", () => {
  const open = { ...closed, clockOut: null };
  assert.deepEqual(withQueued([open], "u", [q("in", "2026-11-13T20:00:00Z")]), [open]);
  assert.deepEqual(withQueued([open], "u", [q("out", "2026-11-13T13:00:00Z")]), [open]);
  assert.deepEqual(withQueued([closed], "u", [q("out", "2026-11-13T20:00:00Z")]), [closed]);
});

test("other people's shifts are untouched", () => {
  const theirs = { ...closed, id: 2, userId: "v", clockOut: null };
  const out = withQueued([theirs], "u", [q("in", "2026-11-13T19:00:00Z")]);
  assert.equal(out.length, 2);
  assert.equal(out[1].clockOut, null);
  assert.equal(out[1].userId, "v");
});

test("a remote worker's queued punch carries where they were", () => {
  const loc = { lat: 33.5, lng: -101.8, acc: 10 };
  const out = withQueued([closed], "u", [
    { id: "a", action: "in", at: "2026-11-13T19:00:00Z", loc },
    { id: "b", action: "out", at: "2026-11-13T21:00:00Z", loc: null, locMiss: "denied" },
  ]);
  assert.deepEqual(out[0].inLoc, loc);
  assert.equal(out[0].outLoc, null);
  assert.equal(out[0].outLocMiss, "denied");
});

test("the copy saved on the device holds only this person's own data", () => {
  const other = { ...closed, id: 9, userId: "v" };
  const snap = {
    me: { userId: "u" },
    people: [{ userId: "u" }, { userId: "v" }],
    invites: [{ token: "secret" }],
    punches: [closed, other],
    pto: [{ userId: "u" }, { userId: "v" }],
    offDays: [{ userId: "v" }],
  } as unknown as Parameters<typeof ownSnapshot>[0];
  const kept = ownSnapshot(snap);
  assert.deepEqual(kept.people.map((p) => p.userId), ["u"]);
  assert.equal(kept.invites.length, 0);
  assert.deepEqual(kept.punches.map((p) => p.userId), ["u"]);
  assert.equal(kept.pto.length, 1);
  assert.equal(kept.offDays.length, 0);
});
