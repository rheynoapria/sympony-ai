import assert from "node:assert/strict";
import test from "node:test";
import { SCREENTIME_ROWS } from "../sections/features.rows.ts";
import { GENERAL_ROWS } from "../sections/general.rows.ts";
import { STATS_ROWS } from "../sections/system.rows.ts";
import { applyOs, LINUX_OFF, MAC_OFF, offCards, optionsFor } from "./os.ts";
import type { FieldRow, Row } from "./types.ts";

test("applyOs strips OS-off keys, windowsOnly custom parts, and orphaned headings", () => {
  const rows: Row[] = [
    { t: "h2", text: "A" },
    { t: "toggle", k: "touchMode", label: "" },
    { t: "h2", text: "B" },
    { t: "toggle", k: "haptics", label: "" },
  ];
  assert.deepEqual(
    applyOs("general", rows, "macos").map((r) =>
      r.t === "h2" ? r.text : "k" in r ? r.k : r.t
    ),
    ["B", "haptics"]
  );
  assert.equal(applyOs("general", rows, "windows").length, 4);
  assert.ok(
    !applyOs("general", [{ t: "custom", id: "gap", windowsOnly: true }], "macos").length
  );
  assert.ok(
    !applyOs("general", [{ t: "custom", id: "gap", windowsOnly: true }], "linux").length
  );
  assert.equal(
    applyOs("general", [{ t: "custom", id: "gap", windowsOnly: true }], "windows").length,
    1
  );
});

test("optionsFor filters OS-off options and offCards returns per-OS hidden cards", () => {
  const form = GENERAL_ROWS.find((r) => "k" in r && r.k === "shellForm");
  assert.ok(form, "shellForm row should exist in GENERAL_ROWS");
  assert.deepEqual(
    optionsFor(form, {}, "macos").map(([v]) => v),
    ["notch", "hidden"]
  );
  assert.deepEqual(
    optionsFor(form, {}, "linux").map(([v]) => v),
    ["notch", "hidden"]
  );
  assert.deepEqual(
    optionsFor(form, {}, "windows").map(([v]) => v),
    ["notch", "island", "drawer", "hidden"]
  );
  assert.ok(!("notchLook" in MAC_OFF.options) && !("notchLook" in LINUX_OFF.options));
  assert.ok(offCards("macos").includes("bell"));
  assert.ok(offCards("linux").includes("bluetooth-b"));
  assert.deepEqual(offCards("windows"), []);
});

test("applyOs swaps Screen Time excluded apps subtitle on macOS", () => {
  const ex = applyOs("screentime", SCREENTIME_ROWS, "macos").find(
    (r) => "k" in r && r.k === "screenTimeExcluded"
  )!;
  assert.equal((ex as FieldRow).sub, "Comma-separated app names, e.g. Steam, 1Password");
});

test("applyOs swaps System Monitor subtitle on macOS", () => {
  const se = applyOs("stats", STATS_ROWS, "macos").find(
    (r) => "k" in r && r.k === "statsEnabled"
  ) as FieldRow;
  assert.equal(se.sub, "CPU, memory, network and disk");
});
