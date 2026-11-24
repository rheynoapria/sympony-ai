import assert from "node:assert/strict";
import test from "node:test";
import {
  effectiveWatchBeta,
  formatBytes,
  hasPendingBadge,
  isPrereleaseVersion,
  normalizeUpdateState,
  parseReleaseBullets,
  shouldShowBanner,
  type UpdateState,
} from "./update.ts";

function sampleState(overrides: Partial<UpdateState> = {}): UpdateState {
  return {
    status: "available",
    currentVersion: "0.1.0",
    currentChannel: "stable",
    watchBeta: false,
    availableVersion: "0.2.0",
    availableChannel: "stable",
    notes: "- New: Auto-updater\n- Fixed: Clock alignment",
    pubDate: null,
    downloaded: 0,
    total: null,
    percent: null,
    dismissedVersion: "",
    lastChecked: 1700000000000,
    error: null,
    preview: false,
    ...overrides,
  };
}

test("isPrereleaseVersion detects beta/rc tags and ignores stable", () => {
  assert.equal(isPrereleaseVersion("0.2.0-beta.1"), true);
  assert.equal(isPrereleaseVersion("v0.2.0-rc.2"), true);
  assert.equal(isPrereleaseVersion("0.2.0"), false);
  assert.equal(isPrereleaseVersion(""), false);
  assert.equal(isPrereleaseVersion(null), false);
});

test("effectiveWatchBeta defaults to build channel and respects explicit override", () => {
  assert.equal(effectiveWatchBeta({ updateBeta: null }, "0.2.0-beta.1"), true);
  assert.equal(effectiveWatchBeta({ updateBeta: null }, "0.2.0"), false);
  assert.equal(effectiveWatchBeta({ updateBeta: true }, "0.2.0"), true);
  assert.equal(effectiveWatchBeta({ updateBeta: false }, "0.2.0-beta.1"), false);
});

test("shouldShowBanner respects dismissal while always showing downloading/ready/error", () => {
  assert.equal(shouldShowBanner(sampleState()), true);
  assert.equal(
    shouldShowBanner(sampleState({ dismissedVersion: "0.2.0" })),
    false
  );
  assert.equal(
    shouldShowBanner(sampleState({ dismissedVersion: "0.1.9" })),
    true
  );
  assert.equal(
    shouldShowBanner(
      sampleState({ status: "ready", dismissedVersion: "0.2.0" })
    ),
    true
  );
  assert.equal(
    shouldShowBanner(
      sampleState({ status: "downloading", dismissedVersion: "0.2.0" })
    ),
    true
  );
  assert.equal(
    shouldShowBanner(sampleState({ status: "error", error: "Network error" })),
    true
  );
  assert.equal(
    shouldShowBanner(sampleState({ status: "upToDate", availableVersion: null })),
    false
  );
});

test("hasPendingBadge distinguishes beta vs stable and suppresses dismissed", () => {
  assert.equal(hasPendingBadge(sampleState()), "stable");
  assert.equal(
    hasPendingBadge(
      sampleState({
        availableVersion: "0.2.0-beta.1",
        availableChannel: "beta",
      })
    ),
    "beta"
  );
  assert.equal(
    hasPendingBadge(sampleState({ dismissedVersion: "0.2.0" })),
    null
  );
  assert.equal(
    hasPendingBadge(sampleState({ status: "upToDate", availableVersion: null })),
    null
  );
});

test("parseReleaseBullets and formatBytes handle edge cases cleanly", () => {
  assert.deepEqual(
    parseReleaseBullets("## Highlights\n- New: Dual channel\n* Fixed: Dot badge"),
    ["New: Dual channel", "Fixed: Dot badge"]
  );
  assert.equal(formatBytes(512 * 1024), "512 KB");
  assert.equal(formatBytes(25.6 * 1024 * 1024), "25.6 MB");
  assert.equal(formatBytes(0), "");
});

test("normalizeUpdateState safely maps raw IPC payloads", () => {
  const s = normalizeUpdateState({
    status: "available",
    currentVersion: "0.1.0",
    availableVersion: "0.2.0-beta.1",
  });
  assert.ok(s);
  assert.equal(s.availableChannel, "beta");
  assert.equal(s.currentChannel, "stable");
});
