import assert from "node:assert/strict";
import test from "node:test";
import { keyOptions } from "./KeyPicker.tsx";

test("the dictation keys are named as each system names them, with the same settings", () => {
  const mac = keyOptions("dictate", "macos");
  const win = keyOptions("dictate", "windows");
  assert.equal(new Map(mac).get("right_option"), "Right ⌥ (Option)");
  assert.equal(new Map(win).get("right_option"), "Right Alt");
  // (Windows never sees Fn: not offered there)
  assert.ok(mac.some(([v]) => v === "fn"));
  assert.ok(!win.some(([v]) => v === "fn"));
  // every Windows choice is one the setting already knows
  const known = new Set(mac.map(([v]) => v));
  assert.ok(win.every(([v]) => known.has(v)));
  assert.deepEqual(keyOptions("command", "windows").map(([v]) => v), keyOptions("command", "macos").map(([v]) => v));
});
