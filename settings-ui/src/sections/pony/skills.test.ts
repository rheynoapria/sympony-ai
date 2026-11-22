import assert from "node:assert/strict";
import test from "node:test";
import { canSaveSkill, validateSkillName } from "./skill-validation.ts";

test("validateSkillName matches Rust validate_name cases", () => {
  // Valid names
  for (const ok of ["a", "plan-my-day", "skill-2", "x1-y2-z3", "a".repeat(64)]) {
    assert.equal(validateSkillName(ok), null, `expected "${ok}" to be valid`);
  }

  // Invalid names (same table as crates/services/tests/pony.rs)
  const invalid = [
    "",
    "a".repeat(65),
    "Plan",
    "my_skill",
    "my skill",
    "-abc",
    "abc-",
    "a--b",
    "../evil",
    "a/b",
    "UPPER",
    "skill.name",
  ];
  for (const bad of invalid) {
    assert.ok(validateSkillName(bad) !== null, `expected "${bad}" to be rejected`);
  }
});

test("canSaveSkill keeps Save disabled on invalid name or empty description", () => {
  assert.equal(canSaveSkill({ name: "", description: "Valid desc" }), false);
  assert.equal(canSaveSkill({ name: "Bad_Name", description: "Valid desc" }), false);
  assert.equal(canSaveSkill({ name: "plan-my-day", description: "" }), false);
  assert.equal(canSaveSkill({ name: "plan-my-day", description: "   " }), false);
  assert.equal(canSaveSkill({ name: "plan-my-day", description: "a".repeat(1025) }), false);
  assert.equal(canSaveSkill({ name: "plan-my-day", description: "Plan my day cleanly" }), true);
});

test("visibleEntries hides children of closed folders", async () => {
  const { visibleEntries } = await import("./SkillsManager.tsx");
  const e = (path: string, dir = false) => ({ path, dir, size: 0 });
  const tree = [e("SKILL.md"), e("references", true), e("references/deep", true), e("references/deep/c.md"), e("references/b.md"), e("a.txt")];
  const paths = (open: string[]) => visibleEntries(tree, new Set(open)).map((x) => x.path);
  assert.deepEqual(paths([]), ["SKILL.md", "references", "a.txt"]);
  assert.deepEqual(paths(["references"]), ["SKILL.md", "references", "references/deep", "references/b.md", "a.txt"]);
  assert.deepEqual(paths(["references", "references/deep"]), tree.map((x) => x.path));
  assert.deepEqual(paths(["references/deep"]), ["SKILL.md", "references", "a.txt"]);
});
