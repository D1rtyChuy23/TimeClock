import assert from "node:assert/strict";
import { test } from "node:test";
import { distanceM, fmtDistance, parseClockRule, parseCoords, readsLocation, siteCheck, type WorkSite } from "./work-sites.ts";

const shop: WorkSite = { id: 1, name: "Shop", lat: 33.57791, lng: -101.8552, radiusM: 152 };
const yard: WorkSite = { id: 2, name: "Yard", lat: 33.6, lng: -101.9, radiusM: 91 };
// About 100 m north of the shop, and about 1.6 km north.
const near = { lat: 33.5788, lng: -101.8552, acc: 10 };
const far = { lat: 33.5923, lng: -101.8552, acc: 10 };

test("distance is right to within a few meters", () => {
  assert.ok(Math.abs(distanceM(shop, near) - 99) < 3, String(distanceM(shop, near)));
  assert.ok(Math.abs(distanceM(shop, far) - 1600) < 10);
});

test("inside the circle is on site, and names the site", () => {
  const r = siteCheck(near, [yard, shop]);
  assert.equal(r.ok, true);
  assert.equal(r.ok && r.site.name, "Shop");
});

test("outside the circle is refused with the nearest site and how far", () => {
  const r = siteCheck(far, [shop, yard]);
  assert.equal(r.ok, false);
  assert.equal(!r.ok && r.reason, "off_site");
  if (!r.ok && r.reason === "off_site") {
    assert.equal(r.site.name, "Shop");
    assert.equal(fmtDistance(r.distanceM), "1.0 mi");
  }
});

test("a slightly fuzzy reading at the edge still counts, up to 75 m", () => {
  const edge = { lat: 33.57791 + 0.0018, lng: -101.8552, acc: 60 }; // ~200 m: 48 m outside, 60 m fuzzy
  assert.equal(siteCheck(edge, [shop]).ok, true);
  assert.equal(siteCheck({ ...edge, acc: 10 }, [shop]).ok, false);
});

test("a very rough reading asks for a better one instead of saying too far", () => {
  const rough = { ...far, acc: 2000 };
  const r = siteCheck(rough, [shop]);
  assert.equal(!r.ok && r.reason, "rough_location");
  assert.equal(siteCheck({ ...far, lat: 34.5, acc: 2000 }, [shop]).ok === false && (siteCheck({ ...far, lat: 34.5, acc: 2000 }, [shop]) as { reason: string }).reason, "off_site", "rough but clearly far is still off site");
});

test("no sites set up yet", () => {
  assert.deepEqual(siteCheck(near, []), { ok: false, reason: "no_sites" });
});

test("rules and pasted coordinates", () => {
  assert.equal(parseClockRule("onsite"), "onsite");
  assert.equal(parseClockRule("bogus"), "anywhere");
  assert.equal(readsLocation("anywhere"), false);
  assert.equal(readsLocation("remote"), true);
  assert.equal(readsLocation("onsite"), true);
  assert.deepEqual(parseCoords("33.57791, -101.85520"), { lat: 33.57791, lng: -101.8552 });
  assert.deepEqual(parseCoords("https://www.google.com/maps/@33.5779,-101.8552,17z"), { lat: 33.5779, lng: -101.8552 });
  assert.equal(parseCoords("Main street"), null);
  assert.equal(fmtDistance(30), "100 ft");
});
