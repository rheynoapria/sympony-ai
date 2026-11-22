import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { SECTION_KEYS } from "./keys.ts";

const here = path.dirname(fileURLToPath(import.meta.url));
const defaults = JSON.parse(
  fs.readFileSync(
    path.resolve(here, "../../../crates/contract/defaults/settings.json"),
    "utf8"
  )
) as Record<string, unknown>;
const classicSrc = fs.readFileSync(
  path.resolve(here, "../../../frontend/settings.js"),
  "utf8"
);

// Deliberately dropped keys (with reason):
const DROPPED: readonly string[] = [
  // Notch spec §10: Look / color picker removed; classic still has dead renderNotchColor
  "notchColor",
  // Dashboard removed: Ringkas derives directly from Settings → Modules order
  "dashboardWidgets",
  "glanceSlots",
];

// Dropped keys also removed from classic settings.js (so classic regexes no longer see them)
const ALSO_DROPPED_IN_CLASSIC: ReadonlySet<string> = new Set([
  "dashboardWidgets",
  "glanceSlots",
]);

// Windows-only custom parts not ported in R3/R4
const WINDOWS_ONLY: readonly string[] = [
  "autoHideApps",
  "notchTopGapApps",
  "tempZone",
  "cursorRoles",
  "dockDisplays",
  "dockStyle",
  "wallpaperOn",
  "snapLayouts",
];

// Set with computed keys in classic, which static regexes cannot see
const CLASSIC_DYNAMIC: readonly string[] = [
  "idleLeft",
  "idleRight",
  "idleClock",
  "clockSize",
  "hourChimeFrom",
  "hourChimeTo",
  "language",
  "todoSyncGoogleClientId",
  "todoSyncMsClientId",
];

function extractClassicKeys(src: string): Set<string> {
  const out = new Set<string>(CLASSIC_DYNAMIC);
  const keep = (k: string) => {
    const top = k.split(".")[0];
    if (top in defaults) out.add(k);
  };

  for (const m of src.matchAll(/\bk:\s*'([A-Za-z0-9.]+)'/g)) {
    keep(m[1]);
  }
  for (const m of src.matchAll(/data-k="([A-Za-z0-9]+)"/g)) {
    keep(m[1]);
  }

  // Extract top-level property names inside every `setSettings({ ... })` literal
  const callRe = /setSettings\(\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = callRe.exec(src)) !== null) {
    let i = match.index + match[0].length;
    let depth = 1;
    let topBuf = "";
    while (i < src.length && depth > 0) {
      const ch = src[i];
      if (ch === "'" || ch === '"' || ch === "`") {
        const q = ch;
        i++;
        while (i < src.length && src[i] !== q) {
          if (src[i] === "\\") i++;
          i++;
        }
      } else if (ch === "{") {
        depth++;
      } else if (ch === "}") {
        depth--;
      } else if (depth === 1) {
        topBuf += ch;
      }
      i++;
    }
    for (const pm of topBuf.matchAll(/(?:^|[,{])\s*([A-Za-z0-9_]+)\s*(?::|,|$)/g)) {
      keep(pm[1]);
    }
  }

  return out;
}

const classic = extractClassicKeys(classicSrc);

test("every key classic Settings edits is editable in the new Settings", () => {
  const covered = new Set(Object.values(SECTION_KEYS).flat());
  const missing = [...classic].filter(
    (k) => !covered.has(k) && !DROPPED.includes(k) && !WINDOWS_ONLY.includes(k)
  );
  assert.deepEqual(missing, []);
});

test("every Pony Assistant key is registered in SECTION_KEYS.ai", () => {
  const aiKeys = new Set(SECTION_KEYS.ai ?? []);
  const required = [
    "ponyName",
    "ponyPersona",
    "ponyPersonaText",
    "ponySkillsOff",
    "ponyFace",
    "ponyPeek",
    "ponyShape",
    "ponyColor",
  ];
  const missing = required.filter((k) => !aiKeys.has(k));
  assert.deepEqual(missing, []);
});

test("every Voice key is registered in SECTION_KEYS.voice", () => {
  const voiceKeys = new Set(SECTION_KEYS.voice ?? []);
  const required = Object.keys(defaults).filter((k) => k.startsWith("voice"));
  assert.ok(required.length >= 14, `expected >= 14 voice* keys in defaults, got ${required.length}`);
  const missing = required.filter((k) => !voiceKeys.has(k));
  assert.deepEqual(missing, []);
});

test("the dropped and Windows-only lists name classic keys the new Settings doesn't edit", () => {
  const covered = new Set(Object.values(SECTION_KEYS).flat());
  for (const k of [...DROPPED, ...WINDOWS_ONLY]) {
    if (!ALSO_DROPPED_IN_CLASSIC.has(k)) {
      assert.ok(classic.has(k), `expected "${k}" to be in classic`);
    }
    assert.ok(!covered.has(k), `expected "${k}" not to be in covered`);
  }
});
