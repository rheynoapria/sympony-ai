import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import type { FieldRow } from "../rows/types.ts";
import { SECTION_KEYS } from "./keys.ts";
import { sectionRows, type OS } from "./registry.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaults = JSON.parse(
  fs.readFileSync(
    path.resolve(here, "../../../crates/contract/defaults/settings.json"),
    "utf8"
  )
) as Record<string, unknown>;

function hasKey(obj: Record<string, unknown>, dotted: string): boolean {
  let cur: unknown = obj;
  for (const part of dotted.split(".")) {
    if (cur == null || typeof cur !== "object") return false;
    if (!(part in (cur as Record<string, unknown>))) return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return true;
}

function hasParentObject(obj: Record<string, unknown>, dotted: string): boolean {
  const parts = dotted.split(".");
  if (parts.length < 2) return false;
  let cur: unknown = obj;
  for (const part of parts.slice(0, -1)) {
    if (cur == null || typeof cur !== "object") return false;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur != null && typeof cur === "object" && !Array.isArray(cur);
}

function unsetKeysFor(sectionId: string): Set<string> {
  const out = new Set<string>();
  for (const os of ["macos", "linux", "windows"] as OS[]) {
    for (const r of sectionRows(sectionId, os)) {
      if ("k" in r && (r as FieldRow).unset !== undefined) {
        out.add(r.k);
      }
    }
  }
  return out;
}

for (const [sectionId, keys] of Object.entries(SECTION_KEYS)) {
  test(`${sectionId} section keys exist in defaults/settings.json`, () => {
    assert.ok(keys.length > 0, `${sectionId} should define setting keys`);
    const withUnset = unsetKeysFor(sectionId);
    for (const k of keys) {
      const ok = hasKey(defaults, k) || (withUnset.has(k) && hasParentObject(defaults, k));
      assert.ok(
        ok,
        `Section ${sectionId}: setting key "${k}" is missing from crates/contract/defaults/settings.json`
      );
    }
  });
}
