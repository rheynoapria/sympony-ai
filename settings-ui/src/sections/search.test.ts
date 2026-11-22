import assert from "node:assert/strict";
import test from "node:test";
import { t } from "../lib/i18n.ts";
import { plainText } from "../rows/logic.ts";
import { resolveSection, searchAll, sectionRows, sectionsFor, type OS } from "./registry.ts";

const R4 = [
  "todo",
  "calendar",
  "weather",
  "prayer",
  "pomodoro",
  "health",
  "screentime",
  "dayprogress",
  "bluetooth",
  "dock",
  "dropactions",
  "snap",
  "hud",
  "battery",
  "mirror",
  "stats",
  "live",
  "cursor",
  "effects",
  "wallpaper",
  "github",
] as const;

for (const os of ["macos", "linux", "windows"] as OS[]) {
  test(`⌘K finds every row of every R4 section on ${os}`, () => {
    const visible = new Set(sectionsFor(os).map((s) => s.id));
    for (const id of R4.filter((x) => visible.has(x))) {
      const rows = sectionRows(id, os);
      assert.ok(rows.length > 0, `${id} has no registered rows`);
      for (const r of rows) {
        if (r.t === "h2" || r.t === "lead" || !("label" in r) || !r.label) continue;
        const label = plainText(t(r.label));
        assert.ok(
          searchAll(label, os).some((h) => h.section === id && h.label === label),
          `${os} ${id}: "${label}"`
        );
        for (const [also, part] of r.also ?? []) {
          const alsoLabel = plainText(t(also));
          assert.ok(
            searchAll(alsoLabel, os).some(
              (h) => h.section === id && h.part === part
            ),
            `${os} ${id}: also "${also}"`
          );
        }
      }
    }
  });
}

test("⌘K Indonesian queries find the expected sections and rows on macOS", () => {
  const expectHit = (query: string, section: string, rowHint?: string) => {
    const hits = searchAll(query, "macos");
    assert.ok(
      hits.some(
        (h) =>
          h.section === section &&
          (!rowHint || h.label.toLowerCase().includes(rowHint.toLowerCase()))
      ),
      `query "${query}" should match section "${section}"${rowHint ? ` (row containing "${rowHint}")` : ""}; got ${JSON.stringify(hits.slice(0, 8))}`
    );
  };

  expectHit("sholat", "prayer", "Prayer");
  expectHit("adzan", "prayer", "Adhan");
  expectHit("cuaca", "weather", "Weather");
  expectHit("pengingat", "prayer", "reminder");
  expectHit("pengingat", "calendar", "reminder");
  expectHit("notch", "general", "Notch");
  expectHit("ombak", "media", "Wave style");
  expectHit("ombak", "pomodoro");
  expectHit("modul", "modules");
});

test("⌘K finds Pony Assistant via pony, chat, ai chat, persona, skill, memori, ingatan, and obrolan", () => {
  for (const query of ["pony", "chat", "ai chat", "obrolan", "persona", "skill", "memori", "ingatan"]) {
    const hits = searchAll(query, "macos");
    assert.ok(
      hits.some((h) => h.section === "ai"),
      `query "${query}" should find Pony Assistant ("ai"); got ${JSON.stringify(hits.slice(0, 8))}`
    );
  }
});

test("⌘K finds Voice via dikte, kamus, suara, and stt", () => {
  for (const query of ["dikte", "kamus", "suara", "stt"]) {
    const hits = searchAll(query, "macos");
    assert.ok(
      hits.some((h) => h.section === "voice"),
      `query "${query}" should find Voice ("voice"); got ${JSON.stringify(hits.slice(0, 8))}`
    );
  }
});

test("deep links resolve section and spot ids after the default switch", () => {
  assert.equal(resolveSection("pomodoro/timer", "macos"), "pomodoro/timer");
  assert.equal(resolveSection("weather", "macos"), "weather");
  assert.equal(resolveSection("modules", "macos"), "modules");
  assert.equal(resolveSection("dock/style", "macos"), "general");
  assert.equal(resolveSection("unknown/spot", "macos"), "general");
});
