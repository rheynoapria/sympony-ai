import assert from "node:assert/strict";
import test from "node:test";
import { createMock } from "./mock.ts";

test("createMock merges setSettings and notifies listeners with whole object", async () => {
  const m = createMock({ a: 1 });
  let got: unknown;
  const unsub = m.onSettings((s) => {
    got = s;
  });
  await m.setSettings({ b: 2 });
  assert.deepEqual(got, { a: 1, b: 2 });
  assert.deepEqual(await m.getSettings(), { a: 1, b: 2 });

  unsub();
  await m.setSettings({ c: 3 });
  assert.deepEqual(got, { a: 1, b: 2 });
});

test("createMock emits section navigation and stubs version/svc/appInfo", async () => {
  const m = createMock({});
  let sec = "";
  const unsub = m.onSettingsSection((id) => {
    sec = id;
  });
  m.emitSection("media");
  assert.equal(sec, "media");
  unsub();
  m.emitSection("ai");
  assert.equal(sec, "media");

  assert.equal(await m.version(), "0.0.0-dev");
  assert.equal(await m.svc("store", "get", "todo"), null);
  assert.equal((await m.appInfo()).version, "0.0.0-dev");
});

test("createMock provides helperState and calendar methods", async () => {
  const m = createMock({});
  assert.equal(((await m.helperState()).power as { level: number }).level, 82);
  let errs: Record<string, string> | undefined;
  const unsub = m.onCalendar((p) => {
    errs = p.errors;
  });
  m.emit("calendar", { errors: { "0": "timeout" } });
  assert.deepEqual(errs, { "0": "timeout" });
  unsub();
  await m.refreshCalendar();
  await m.requestCalendar();
});
