import assert from "node:assert/strict";
import test from "node:test";
import { commitValue, getK, leadNodes, patchFor, rowValue } from "./logic.ts";
import type { FieldRow, Row } from "./types.ts";

test("getK and patchFor read and merge top-level and dotted keys", () => {
  assert.equal(getK({ liveSources: { bluetooth: true } }, "liveSources.bluetooth"), true);
  assert.equal(getK({}, "liveSources.bluetooth"), undefined);
  assert.deepEqual(
    patchFor({ liveSources: { a: true, bluetooth: false } }, "liveSources.bluetooth", true),
    { liveSources: { a: true, bluetooth: true } }
  );
  assert.deepEqual(patchFor({}, "haptics", true), { haptics: true });
});

test("commitValue validates number, select, display, list, range, and toggle", () => {
  const num: Row = { t: "number", k: "standbySecs", label: "", min: 1, max: 3600 };
  assert.deepEqual(commitValue(num, "abc", {}), { ok: false });
  assert.deepEqual(commitValue(num, "", {}), { ok: false });
  assert.deepEqual(commitValue(num, "99999", {}), { ok: true, v: 3600 });
  assert.deepEqual(commitValue(num, "0", {}), { ok: true, v: 1 });
  assert.deepEqual(commitValue(num, "7.6", {}), { ok: true, v: 8 });

  const sel: Row = {
    t: "select",
    k: "notifSeconds",
    label: "",
    options: [
      [6, "6"],
      [0, "x"],
    ],
  };
  assert.deepEqual(commitValue(sel, "6", {}), { ok: true, v: 6 });

  const disp: Row = {
    t: "select",
    k: "display",
    label: "",
    options: [["primary", "p"]],
  };
  assert.deepEqual(commitValue(disp, "42", {}), { ok: true, v: 42 });
  assert.deepEqual(commitValue(disp, "all", {}), { ok: true, v: "all" });

  const list: Row = { t: "list", k: "x", label: "" };
  assert.deepEqual(commitValue(list, " A, b ,, ", {}), { ok: true, v: ["a", "b"] });

  const tog: Row = { t: "toggle", k: "haptics", label: "" };
  assert.deepEqual(commitValue(tog, true, {}), { ok: true, v: true });

  const rng: Row = { t: "range", k: "hoverDelay", label: "", min: 0, max: 1000, step: 50 };
  assert.deepEqual(commitValue(rng, "250", {}), { ok: true, v: 250 });
});

test("leadNodes turns <b> into bold nodes and keeps all other tags as plain text", () => {
  assert.deepEqual(leadNodes("Music on the <b>Home</b> tab"), [
    "Music on the ",
    { b: "Home" },
    " tab",
  ]);
  assert.deepEqual(leadNodes("x <img src=y onerror=alert(1)> z"), [
    "x <img src=y onerror=alert(1)> z",
  ]);
  assert.deepEqual(leadNodes("<b>A</b> and <b>B</b> and <a href='x'>C</a>"), [
    { b: "A" },
    " and ",
    { b: "B" },
    " and <a href='x'>C</a>",
  ]);
  assert.deepEqual(leadNodes("Data stays in <code>screentime.json</code> here"), [
    "Data stays in ",
    { code: "screentime.json" },
    " here",
  ]);
  assert.deepEqual(leadNodes("a<br>b <i>c</i>"), ["a", { br: true }, "b ", { i: "c" }]);
  assert.deepEqual(leadNodes('x <a href="y">z</a>'), ['x <a href="y">z</a>']);
});

test("rowValue falls back to row.unset when key is missing", () => {
  const sunrise = { t: "toggle", k: "prayerList.sunrise", label: "", unset: true } as FieldRow;
  assert.equal(rowValue(sunrise, { prayerList: { fajr: false } }), true);
  assert.equal(rowValue(sunrise, { prayerList: { sunrise: false } }), false);
  assert.deepEqual(patchFor({ prayerList: { fajr: false } }, "prayerList.sunrise", false), {
    prayerList: { fajr: false, sunrise: false },
  });
});
