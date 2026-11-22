import assert from "node:assert/strict";
import test from "node:test";
import { applyOs } from "../rows/os.ts";
import type { FieldRow, Row } from "../rows/types.ts";
import { searchAll, type OS } from "./registry.ts";
import { dropActionsRows, hudRows, STATS_ROWS } from "./system.rows.ts";

const keys = (rows: readonly Row[], id: string, os: OS) =>
  applyOs(id, rows, os)
    .filter((r): r is FieldRow => "k" in r)
    .map((r) => r.k);

test("hudRows match per-OS key sets", () => {
  assert.deepEqual(keys(hudRows("macos"), "hud", "macos"), [
    "hudEnabled",
    "hudMic",
    "hudInputLang",
    "langMark",
    "hudStyle",
  ]);
  assert.deepEqual(keys(hudRows("linux"), "hud", "linux"), [
    "hudEnabled",
    "hudMic",
    "hudStyle",
  ]);
  assert.equal(keys(hudRows("windows"), "hud", "windows").length, 14);
});

test("dropActionsRows hide Clipboard on Linux and keep it on macOS", () => {
  assert.ok(!keys(dropActionsRows("linux"), "dropactions", "linux").includes("clipboardHistory"));
  assert.ok(keys(dropActionsRows("macos"), "dropactions", "macos").includes("clipboardMax"));
});

test("STATS_ROWS filter fpsCounter on macOS", () => {
  assert.deepEqual(keys(STATS_ROWS, "stats", "macos"), ["statsEnabled"]);
  assert.deepEqual(keys(STATS_ROWS, "stats", "windows"), ["statsEnabled", "fpsCounter"]);
});

test("search finds battery and dropactions Indonesian synonyms", () => {
  assert.ok(searchAll("baterai", "macos").some((h) => h.section === "battery"));
  assert.ok(searchAll("riwayat", "macos").some((h) => h.section === "dropactions"));
});
