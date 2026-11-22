import assert from "node:assert/strict";
import test from "node:test";
import { commitValue, rowValue } from "../rows/logic.ts";
import type { FieldRow } from "../rows/types.ts";
import { POMODORO_ROWS, PRAYER_ROWS, TODO_ROWS } from "./features.rows.ts";
import { searchAll } from "./registry.ts";

test("pomodoro presets carry the timer spot", () => {
  assert.ok(
    POMODORO_ROWS.some((r) => r.t === "custom" && r.id === "timerPresets" && r.spot === "timer")
  );
});

test("todoLateMinutes and todoSnoozeMinutes save numbers", () => {
  const late = TODO_ROWS.find((r) => "k" in r && r.k === "todoLateMinutes")!;
  assert.deepEqual(commitValue(late, "30", {}), { ok: true, v: 30 });
  const snooze = TODO_ROWS.find((r) => "k" in r && r.k === "todoSnoozeMinutes")!;
  assert.deepEqual(commitValue(snooze, "15", {}), { ok: true, v: 15 });
});

test("search finds pomodoro presets and health Indonesian synonym", () => {
  assert.ok(
    searchAll("presets", "macos").some((h) => h.section === "pomodoro" && h.label === "Presets")
  );
  assert.ok(searchAll("minum", "macos").some((h) => h.section === "health"));
});

test("prayer reminders default on for prayers the defaults don't list", () => {
  const sunrise = PRAYER_ROWS.find(
    (r) => "k" in r && r.k === "prayerList.sunrise"
  ) as FieldRow;
  assert.equal(rowValue(sunrise, { prayerList: { fajr: true } }), true);
});

test("prayerBefore saves a number", () => {
  const r = PRAYER_ROWS.find((x) => "k" in x && x.k === "prayerBefore")!;
  assert.deepEqual(commitValue(r, "15", {}), { ok: true, v: 15 });
});

test("search reaches the hand-drawn pages' rows", () => {
  assert.ok(searchAll("adzan", "macos").some((h) => h.section === "prayer"));
  assert.ok(
    searchAll("kemenag", "macos").some(
      (h) => h.section === "prayer" && h.label === "Kemenag regency / city"
    )
  );
  assert.ok(searchAll("lokasi", "macos").some((h) => h.section === "weather"));
  assert.ok(searchAll("local events", "macos").some((h) => h.section === "calendar"));
});
