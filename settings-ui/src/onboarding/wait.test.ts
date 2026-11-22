import assert from "node:assert/strict";
import test from "node:test";
import { waitOutcome } from "./wait.ts";

test("waitOutcome returns granted whenever now is granted", () => {
  assert.equal(waitOutcome("notAsked", "granted", 0, "dialog"), "granted");
  assert.equal(waitOutcome("denied", "granted", 12000, "pane"), "granted");
  assert.equal(waitOutcome("notRunning", "granted", 500, "dialog"), "granted");
});

test("waitOutcome returns denied when dialog transitions from notAsked to denied", () => {
  assert.equal(waitOutcome("notAsked", "denied", 500, "dialog"), "denied");
  assert.equal(waitOutcome("notAsked", "denied", 7000, "dialog"), "denied");
});

test("waitOutcome returns noDialog when dialog stays notAsked at or past 6000ms", () => {
  assert.equal(waitOutcome("notAsked", "notAsked", 5999, "dialog"), "wait");
  assert.equal(waitOutcome("notAsked", "notAsked", 6000, "dialog"), "noDialog");
  assert.equal(waitOutcome("notAsked", "notAsked", 9500, "dialog"), "noDialog");
});

test("waitOutcome returns wait for pane action until granted", () => {
  assert.equal(waitOutcome("denied", "denied", 0, "pane"), "wait");
  assert.equal(waitOutcome("denied", "denied", 10000, "pane"), "wait");
  assert.equal(waitOutcome("notAsked", "notAsked", 10000, "pane"), "wait");
  assert.equal(waitOutcome("notAsked", "denied", 2000, "pane"), "wait");
});

test("waitOutcome returns wait for other non-terminal transitions", () => {
  assert.equal(waitOutcome("denied", "denied", 2000, "dialog"), "wait");
  assert.equal(waitOutcome("notRunning", "notRunning", 8000, "dialog"), "wait");
});
