import { test, expect } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { GROUP_ICON_TITLES } from "./groupIcons";

// every card title in Settings (rows' h2 and PanelCard titles) has an icon of its own, not the neutral fallback
test("every settings card title has its icon", () => {
  const dir = join(import.meta.dir, "../../sections");
  const titles = new Set<string>();
  for (const f of readdirSync(dir).filter((f) => /\.(ts|tsx)$/.test(f) && !f.includes(".test."))) {
    const src = readFileSync(join(dir, f), "utf8");
    for (const m of src.matchAll(/t: "h2", text: "([^"]+)"/g)) titles.add(m[1]);
    for (const m of src.matchAll(/<PanelCard title=\{t\("([^"]+)"\)\}/g)) titles.add(m[1]);
  }
  const missing = [...titles].filter((x) => !GROUP_ICON_TITLES.includes(x));
  expect(titles.size).toBeGreaterThan(30);
  expect(missing).toEqual([]);
});
