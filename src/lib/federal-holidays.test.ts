import assert from "node:assert/strict";
import { test } from "node:test";
import { federalHolidays, federalOn } from "./federal-holidays.ts";

const days = (year: number) => Object.fromEntries(federalHolidays(year).map((h) => [h.key, h.day]));

test("federal holidays 2026", () => {
  assert.deepEqual(days(2026), {
    newYear: "2026-01-01",
    mlk: "2026-01-19",
    presidents: "2026-02-16",
    memorial: "2026-05-25",
    juneteenth: "2026-06-19",
    independence: "2026-07-04",
    labor: "2026-09-07",
    columbus: "2026-10-12",
    veterans: "2026-11-11",
    thanksgiving: "2026-11-26",
    christmas: "2026-12-25",
  });
});

test("federal holidays 2027 and 2028 floating dates", () => {
  const a = days(2027);
  assert.equal(a.mlk, "2027-01-18");
  assert.equal(a.presidents, "2027-02-15");
  assert.equal(a.memorial, "2027-05-31");
  assert.equal(a.labor, "2027-09-06");
  assert.equal(a.columbus, "2027-10-11");
  assert.equal(a.thanksgiving, "2027-11-25");
  const b = days(2028);
  assert.equal(b.mlk, "2028-01-17");
  assert.equal(b.memorial, "2028-05-29");
  assert.equal(b.thanksgiving, "2028-11-23");
});

test("federalOn finds a holiday by date", () => {
  assert.equal(federalOn("2026-11-26")?.key, "thanksgiving");
  assert.equal(federalOn("2026-11-27"), null);
});
