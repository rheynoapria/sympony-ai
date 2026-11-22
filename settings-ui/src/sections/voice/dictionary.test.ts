import assert from "node:assert/strict";
import test from "node:test";
import {
  previewImport,
  promptSlotsUsed,
  PROMPT_CAP,
  type UserDict,
} from "./dictionary.ts";

test("CSV and TXT import preview matches Rust duplicate-skipping rules", () => {
  const existing: UserDict = {
    version: 1,
    terms: [{ text: "Rheyno", prompt: true }],
    replacements: [{ from: "kemipnya", to: "commit-nya" }],
  };
  const csv = [
    "type,text,to,prompt",
    "term,rheyno,,true",
    "term,Sympony,,true",
    'term,"PT, Tbk",,false',
    "replacement,KEMIPNYA,commit-nya,",
    "replacement,kasablanka,Kasablanka,",
  ].join("\n");

  const rep = previewImport(existing, "csv", csv);
  assert.equal(rep.addedTerms, 2);
  assert.equal(rep.addedReplacements, 1);
  assert.equal(rep.skipped, 2);

  const txtRep = previewImport(existing, "txt", "# comment\nRheyno\nPaseo\nAntigravity\n");
  assert.equal(txtRep.addedTerms, 2);
  assert.equal(txtRep.addedReplacements, 0);
  assert.equal(txtRep.skipped, 1);
});

test("prompt slot meter caps at 150 and accounts for work jargon boost", () => {
  const few = [
    { text: "Rheyno", prompt: true },
    { text: "rheyno", prompt: true },
    { text: "Hidden", prompt: false },
  ];
  assert.equal(promptSlotsUsed(few, false), 1);
  assert.equal(promptSlotsUsed(few, true), 51);

  const many = Array.from({ length: 200 }, (_, i) => ({
    text: `Term${i}`,
    prompt: true,
  }));
  assert.equal(promptSlotsUsed(many, false), PROMPT_CAP);
  assert.equal(promptSlotsUsed(many, true), PROMPT_CAP);
});
