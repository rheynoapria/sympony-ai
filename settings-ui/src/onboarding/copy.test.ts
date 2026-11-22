import assert from "node:assert/strict";
import test from "node:test";
import { COPY_EN, COPY_ID, copy, echo } from "./copy.ts";

test("every key in COPY_EN exists in COPY_ID and vice versa with non-empty values", () => {
  const enKeys = Object.keys(COPY_EN).sort();
  const idKeys = Object.keys(COPY_ID).sort();
  assert.deepEqual(enKeys, idKeys);
  for (const k of idKeys) {
    assert.ok(COPY_ID[k as keyof typeof COPY_ID].trim().length > 0, `empty id copy for ${k}`);
    assert.ok(COPY_EN[k as keyof typeof COPY_EN].trim().length > 0, `empty en copy for ${k}`);
  }
});

test("copy renders Indonesian table with variables when lang is id, and echo shows English only when non-en", () => {
  assert.equal(copy("turnOn", { name: "Kalender" }, "id"), "Aktifkan Kalender untuk Sympony");
  assert.equal(copy("turnOn", { name: "Calendars" }, "en"), "Turn on Calendars for Sympony");
  assert.equal(copy("permIsOn", { name: "Lokasi" }, "id"), "Lokasi sudah aktif");
  assert.equal(copy("ready", undefined, "id"), "Sympony siap");
  assert.equal(copy("ready", undefined, "en"), "Sympony is ready");
  assert.equal(echo("introSub", "id"), "Your notch, brought to life.");
  assert.equal(echo("introSub", "en"), "");
  assert.equal(copy("stepOf", { n: 2 }, "id"), "Langkah 2 / 4");
  assert.equal(copy("stagePick", { n: 4 }, "id"), "4 modul dipilih");
  assert.equal(copy("stagePerms", { a: 2, b: 3 }, "id"), "2 dari 3 izin aktif");
  assert.equal(copy("noDialog", undefined, "id"), "Dialog izin tidak muncul.");
  assert.equal(copy("tryAgain", undefined, "en"), "Try again");
});
