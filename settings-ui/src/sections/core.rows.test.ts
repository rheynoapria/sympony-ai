import assert from "node:assert/strict";
import test from "node:test";
import { commitValue } from "../rows/logic.ts";
import { applyOs } from "../rows/os.ts";
import { EFFECTS_ROWS, LIVE_ROWS } from "./core.rows.ts";
import { searchAll } from "./registry.ts";

test("live and effects filter OS-off keys and sysPeekEvery saves a number", () => {
  assert.ok(
    !applyOs("live", LIVE_ROWS, "linux").some(
      (r) => "k" in r && r.k === "liveSources.bluetooth"
    )
  );
  assert.ok(
    !applyOs("effects", EFFECTS_ROWS, "macos").some(
      (r) => "k" in r && r.k === "fxGenie"
    )
  );
  const sys = LIVE_ROWS.find((r) => "k" in r && r.k === "sysPeekEvery")!;
  assert.deepEqual(commitValue(sys, "300", {}), { ok: true, v: 300 });
});

test("search finds GitHub personal access token and Effects confetti", () => {
  assert.ok(
    searchAll("token", "macos").some(
      (h) => h.section === "github" && h.label === "Personal access token"
    )
  );
  assert.ok(searchAll("confetti", "macos").some((h) => h.section === "effects"));
});
