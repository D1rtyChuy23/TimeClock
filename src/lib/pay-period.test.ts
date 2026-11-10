import assert from "node:assert/strict";
import { test } from "node:test";
import {
  PAY_ANCHOR,
  buildPayReport,
  dayKey,
  missedKind,
  payPeriod,
  payPeriodIndex,
  payPeriodOf,
  toCsv,
} from "./pay-period.ts";

const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min);
const at = (y: number, m: number, d: number, h = 0, min = 0) => local(y, m, d, h, min).toISOString();

test("the cycle starts on the anchor Monday", () => {
  assert.equal(PAY_ANCHOR, "2026-11-09");
  assert.equal(local(2026, 11, 9).getDay(), 1);
  const p = payPeriod(0);
  assert.equal(p.firstDay, "2026-11-09");
  assert.equal(p.lastDay, "2026-11-22");
  assert.equal(dayKey(p.mid), "2026-11-16");
  assert.equal(dayKey(p.end), "2026-11-23");
});

test("periods run every 14 days in both directions", () => {
  assert.equal(payPeriod(1).firstDay, "2026-11-23");
  assert.equal(payPeriod(1).lastDay, "2026-12-06");
  assert.equal(payPeriod(-1).firstDay, "2026-10-26");
  assert.equal(payPeriod(-1).lastDay, "2026-11-08");
  assert.equal(payPeriod(4).firstDay, "2027-01-04"); // across the new year
});

test("any day finds its period", () => {
  assert.equal(payPeriodIndex(local(2026, 11, 9)), 0);
  assert.equal(payPeriodIndex(local(2026, 11, 22, 23, 59)), 0);
  assert.equal(payPeriodIndex(local(2026, 11, 23)), 1);
  assert.equal(payPeriodIndex(local(2026, 11, 8, 23, 59)), -1);
  assert.equal(payPeriodOf(local(2027, 3, 15)).firstDay, "2027-03-15"); // daylight saving starts 2027-03-14
  assert.equal(payPeriodOf(local(2027, 11, 7, 23)).firstDay, "2027-10-25"); // and ends 2027-11-07
  assert.equal(payPeriodOf(local(2027, 11, 8)).firstDay, "2027-11-08");
});

test("missed punches", () => {
  const today = local(2026, 11, 12);
  const base = { id: 1, userId: "u", manual: false };
  assert.equal(missedKind({ ...base, clockIn: at(2026, 11, 11, 8), clockOut: null }, today), "open");
  assert.equal(missedKind({ ...base, clockIn: at(2026, 11, 12, 8), clockOut: null }, today), null);
  assert.equal(missedKind({ ...base, clockIn: at(2026, 11, 10, 8), clockOut: at(2026, 11, 10, 21) }, today), "long");
  assert.equal(missedKind({ ...base, clockIn: at(2026, 11, 10, 8), clockOut: at(2026, 11, 10, 16) }, today), null);
  assert.equal(
    missedKind({ ...base, manual: true, clockIn: at(2026, 11, 10, 8), clockOut: at(2026, 11, 10, 16) }, today),
    "manual",
  );
});

test("the report adds worked hours, PTO at 8 hours a day, and flags problems", () => {
  const period = payPeriod(0);
  const report = buildPayReport({
    period,
    now: local(2026, 11, 20, 12),
    people: [
      { userId: "b", fullName: "Beto", email: "b@x", ptoAllowance: 80 },
      { userId: "a", fullName: "Ana", email: "a@x", ptoAllowance: 40 },
    ],
    punches: [
      // week 1: 8 h + 8 h
      { id: 1, userId: "a", clockIn: at(2026, 11, 9, 8), clockOut: at(2026, 11, 9, 16), manual: false },
      { id: 2, userId: "a", clockIn: at(2026, 11, 10, 8), clockOut: at(2026, 11, 10, 16), manual: true },
      // overnight across the week boundary: 2 h in week 1, 4 h in week 2
      { id: 3, userId: "a", clockIn: at(2026, 11, 15, 22), clockOut: at(2026, 11, 16, 4), manual: false },
      // forgot to clock out two days ago: counts 0 and is flagged
      { id: 4, userId: "a", clockIn: at(2026, 11, 18, 8), clockOut: null, manual: false },
      // before the period: ignored
      { id: 5, userId: "a", clockIn: at(2026, 11, 6, 8), clockOut: at(2026, 11, 6, 16), manual: true },
      // on the clock right now: counts up to now (8:00 -> 12:00 = 4 h)
      { id: 6, userId: "b", clockIn: at(2026, 11, 20, 8), clockOut: null, manual: false },
    ],
    pto: [
      { userId: "a", day: "2026-11-12", hours: 8 },
      { userId: "a", day: "2026-11-13", hours: 8 },
      { userId: "a", day: "2026-03-02", hours: 8 }, // earlier this year: only lowers days left
      { userId: "a", day: "2026-11-30", hours: 8 }, // next period
    ],
  });
  const [ana, beto] = report.rows;
  assert.equal(ana.name, "Ana");
  assert.equal(ana.week1, 18);
  assert.equal(ana.week2, 4);
  assert.equal(ana.worked, 22);
  assert.equal(ana.ptoDays, 2);
  assert.equal(ana.ptoHours, 16);
  assert.equal(ana.total, 38);
  assert.equal(ana.ptoDaysLeft, 1); // 5 days a year, 4 approved this year
  assert.equal(ana.missed, 2);
  assert.equal(beto.week2, 4);
  assert.equal(beto.total, 4);
  assert.equal(beto.ptoDaysLeft, 10);
  assert.deepEqual(
    report.shifts.map((x) => [x.punchId, x.hours]),
    [
      [1, 8],
      [2, 8],
      [3, 6],
      [4, 0],
      [6, 4],
    ],
  );
  assert.deepEqual(
    report.missed.map((m) => [m.punchId, m.kind]),
    [
      [2, "manual"],
      [4, "open"],
    ],
  );
});

test("csv quotes what needs quoting and rounds hours", () => {
  assert.equal(toCsv(["Name", "Hours"], [["Smith, Ana", 7.999], ['Say "hi"', 8]]), 'Name,Hours\r\n"Smith, Ana",8.00\r\n"Say ""hi""",8.00\r\n');
});
