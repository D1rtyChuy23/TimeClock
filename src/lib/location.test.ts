import assert from "node:assert/strict";
import { test } from "node:test";
import { accuracyFeet, fmtCoords, mapUrl, missFromCode, parseLocation, parseMiss } from "./location.ts";

test("a good reading is kept, rounded to about a meter", () => {
  assert.deepEqual(parseLocation({ lat: 33.5779123, lng: -101.8551987, acc: 12.4 }), { lat: 33.57791, lng: -101.8552, acc: 12 });
});

test("odd readings are dropped instead of saved", () => {
  assert.equal(parseLocation(null), null);
  assert.equal(parseLocation({ lat: 91, lng: 0, acc: 5 }), null);
  assert.equal(parseLocation({ lat: 0, lng: -181, acc: 5 }), null);
  assert.equal(parseLocation({ lat: 0, lng: 0, acc: -1 }), null);
  assert.equal(parseLocation({ lat: "x", lng: 0, acc: 5 }), null);
  assert.equal(parseLocation({ lat: 0, lng: 0 }), null);
});

test("only known reasons for a missing reading are accepted", () => {
  assert.equal(parseMiss("denied"), "denied");
  assert.equal(parseMiss("timeout"), "timeout");
  assert.equal(parseMiss("hacked"), null);
  assert.equal(missFromCode(1), "denied");
  assert.equal(missFromCode(2), "unavailable");
  assert.equal(missFromCode(3), "timeout");
});

test("map link, coordinates and accuracy read well", () => {
  const loc = { lat: 33.57791, lng: -101.8552, acc: 12 };
  assert.equal(mapUrl(loc), "https://www.google.com/maps/search/?api=1&query=33.57791,-101.8552");
  assert.equal(fmtCoords(loc), "33.57791, -101.85520");
  assert.equal(accuracyFeet(loc), 40);
  assert.equal(accuracyFeet({ ...loc, acc: 1 }), 5);
  assert.equal(accuracyFeet({ ...loc, acc: 200 }), 650);
});
