import assert from "node:assert/strict";
import test from "node:test";
import { t } from "./i18n.ts";

test("t strips disambiguation after | and fills {name} variables without window._t", () => {
  assert.equal(t("Clear|weather"), "Clear");
  assert.equal(t("{n} new", { n: 3 }), "3 new");
  assert.equal(t("{x} left"), "{x} left");
  assert.equal(t("{a} of {b}", { a: 1, b: undefined }), "1 of {b}");
});
