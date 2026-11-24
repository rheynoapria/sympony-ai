import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { GROUP_META, SECTIONS, sectionRows } from "../sections/registry.ts";
import { MODULE_META, WELCOME_CARDS } from "../sections/modules.meta.ts";
import { optionsFor } from "../rows/os.ts";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "../../..");

/**
 * Brand names, technical symbols, and intentionally English keys that do not
 * need a separate Indonesian translation.
 */
const ALLOW_ENGLISH = new Set([
  "Sympony",
  "GitHub",
  "HUD",
  "Pomodoro",
  "Claude Code",
  "Codex",
  "Paseo",
  "Microsoft To Do",
  "Google Tasks",
  "Google Calendar",
  "VLC",
  "HEX · #4A90E2",
  "RGB · rgb(74, 144, 226)",
  "HSL · hsl(212, 72%, 59%)",
  "80 %",
  "90 %",
  "95 %",
  "°C, km/h",
  "°F, mph",
  "px",
  "ms",
  "%",
  "s",
]);

function loadExtraId(): Record<string, string> {
  const src = fs.readFileSync(path.join(REPO_ROOT, "frontend/i18n.js"), "utf8");
  const m = src.match(/const EXTRA_ID = (\{[\s\S]*?\n  \});/);
  assert.ok(m, "EXTRA_ID table must exist in frontend/i18n.js");
  return new Function(`return ${m[1]}`)() as Record<string, string>;
}

function walkSourceFiles(dir: string, out: string[] = []): string[] {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) walkSourceFiles(p, out);
    else if (/\.(ts|tsx)$/.test(ent.name) && !/\.test\.tsx?$/.test(ent.name)) out.push(p);
  }
  return out;
}

function unescapeLiteral(quote: string, raw: string): string {
  try {
    if (quote === '"') return JSON.parse(`"${raw}"`) as string;
    return new Function(`return ${quote}${raw}${quote}`)() as string;
  } catch {
    return raw;
  }
}

function collectSettingsUiKeys(): string[] {
  const found = new Set<string>();
  const add = (k: unknown) => {
    if (typeof k === "string" && k.trim()) found.add(k);
  };

  for (const file of walkSourceFiles(path.join(REPO_ROOT, "settings-ui/src"))) {
    const txt = fs.readFileSync(file, "utf8");
    const callRe = /(?<![\w.$])_?t\(\s*(["'])((?:\\.|(?!\1)[^\\])*?)\1/gs;
    for (const hit of txt.matchAll(callRe)) add(unescapeLiteral(hit[1], hit[2]));
    const htmlRe = /<(?:LeadText|RichInline)\s+html=(["'])((?:\\.|(?!\1)[^\\])*?)\1/gs;
    for (const hit of txt.matchAll(htmlRe)) add(unescapeLiteral(hit[1], hit[2]));
  }

  const defaults = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "crates/contract/defaults/settings.json"), "utf8")
  ) as Record<string, unknown>;
  for (const label of ["Light", "Dark", "System"]) add(label);

  for (const s of SECTIONS) {
    add(s.title);
    add(s.subtitle);
    for (const osName of ["macos", "windows", "linux"] as const) {
      for (const r of sectionRows(s.id, osName)) {
        if (r.t === "h2") add(r.text);
        else if (r.t === "lead") add(r.html);
        else if (r.t === "custom") {
          add(r.label);
          add(r.sub);
        } else {
          add(r.label);
          add(r.sub);
          add(r.unit);
          add(r.placeholder);
          if (r.t === "select" && r.k !== "lyricsTranslateTo" && r.k !== "display") {
            for (const [, lbl] of optionsFor(r, defaults, osName)) add(lbl);
          }
        }
      }
    }
  }
  for (const g of Object.values(GROUP_META)) add(g.label);
  for (const c of WELCOME_CARDS) {
    add(c.title);
    add(c.desc);
  }
  for (const m of Object.values(MODULE_META)) {
    add(m.title);
    add(m.sub);
    add(m.macTitle);
    add(m.macSub);
  }
  return [...found];
}

test("every settings-ui core i18n key has an Indonesian entry in EXTRA_ID", () => {
  const extraId = loadExtraId();

  const hasId = (key: string): boolean => {
    if (ALLOW_ENGLISH.has(key)) return true;
    return Object.prototype.hasOwnProperty.call(extraId, key);
  };

  const keys = collectSettingsUiKeys();
  assert.ok(keys.length > 500, `expected > 500 keys collected, got ${keys.length}`);

  const coreMissing = SECTIONS.flatMap((s) => [s.title, s.subtitle]).filter((k) => !hasId(k));
  assert.deepEqual(coreMissing, [], `Missing core Indonesian entries in EXTRA_ID: ${coreMissing.join(", ")}`);
});

test("frontend/i18n.js resolves SYMPONY_STRINGS, EXTRA_ID, and {var} interpolation", () => {
  const src = fs.readFileSync(path.join(REPO_ROOT, "frontend/i18n.js"), "utf8");
  const win: Record<string, unknown> = {
    SYMPONY_LANG: "id",
    SYMPONY_STRINGS: {
      "What the closed Sympony shows": "Yang ditampilkan Sympony saat tertutup",
      "Hello {name}": "Halo {name}",
    },
  };
  const doc = {
    documentElement: { lang: "", dir: "" },
    head: { appendChild() {} },
    querySelectorAll: () => [],
  };
  new Function("window", "document", src)(win, doc);
  const _t = win._t as (s: string, vars?: Record<string, unknown>) => string;
  assert.equal(_t("What the closed Sympony shows"), "Yang ditampilkan Sympony saat tertutup");
  assert.equal(_t("Hello {name}", { name: "Sympony" }), "Halo Sympony");
  assert.equal(_t("About & Updates"), "Tentang & Pembaruan");
  assert.equal(_t("A product by Enlabs"), "Produk dari Enlabs");
});
