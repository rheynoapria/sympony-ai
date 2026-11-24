import assert from "node:assert/strict";
import test from "node:test";
import {
  cleanPresets,
  defaultEventStart,
  keptHow,
  locateMessage,
  locateSub,
  locationSettingsUrl,
  moveTile,
  nextIndex,
  placeName,
  shortFeedUrl,
  showKemenag,
  syncIdFields,
  tileList,
  toggleTile,
  validFeedUrl,
} from "./logic.ts";

test("nextIndex wraps ArrowDown and ArrowUp across suggestion items", () => {
  assert.equal(nextIndex(-1, 3, "ArrowDown"), 0);
  assert.equal(nextIndex(2, 3, "ArrowDown"), 0);
  assert.equal(nextIndex(-1, 3, "ArrowUp"), 2);
  assert.equal(nextIndex(0, 3, "ArrowUp"), 2);
  assert.equal(nextIndex(1, 3, "ArrowUp"), 0);
});

test("placeName joins present place parts", () => {
  assert.equal(
    placeName({ name: "Bekasi", admin: "Jawa Barat", country: "Indonesia" }),
    "Bekasi, Jawa Barat, Indonesia"
  );
  assert.equal(placeName({ name: "Tokyo", country: "Japan" }), "Tokyo, Japan");
});

test("locateMessage maps detect results and locateSub reflects busy/current city", () => {
  assert.deepEqual(
    locateMessage({
      ok: true,
      named: true,
      place: { name: "Bekasi", country: "Indonesia", lat: 1, lon: 2 },
    }),
    { at: "1,2", text: "Found: Bekasi, Indonesia" }
  );
  assert.equal(locateMessage({ reason: "off" }).settings, true);
  assert.ok(
    locateMessage({ reason: "denied" }).text.startsWith(
      "macOS doesn’t let Sympony use your location."
    )
  );
  assert.equal(
    locateMessage(null).text,
    "This Mac couldn’t find its location right now. Try again in a moment, or search for your city."
  );

  const st = { busy: "", msg: { weather: { at: "1,2", text: "Found: X" } } };
  assert.equal(locateSub(st, "weather", { lat: 1, lon: 2 }), "Found: X");
  assert.equal(
    locateSub(st, "weather", { lat: 5, lon: 2 }),
    "Uses Location Services to find where this Mac is, once, and picks the city there"
  );
  assert.equal(
    locateSub({ busy: "weather", msg: {} }, "weather", null),
    "Finding your location…"
  );
});

test("locateMessage and locateSub speak of Windows on Windows", () => {
  assert.ok(
    locateMessage({ reason: "denied" }, "windows").text.startsWith(
      "Windows doesn’t let Sympony use your location."
    )
  );
  assert.ok(locateMessage({ reason: "off" }, "windows").text.startsWith("Location services is off on this PC."));
  assert.equal(locateMessage({ reason: "off" }, "windows").settings, true);
  assert.equal(
    locateMessage(null, "windows").text,
    "This PC couldn’t find its location right now. Try again in a moment, or search for your city."
  );
  assert.ok(locateSub({ busy: "", msg: {} }, "weather", null, "windows").startsWith("Uses Windows’ location service"));
  assert.equal(locationSettingsUrl("windows"), "ms-settings:privacy-location");
  assert.ok(locationSettingsUrl("macos").startsWith("x-apple.systempreferences:"));
});

test("keptHow returns per-OS secret storage hint", () => {
  assert.equal(keptHow("macos"), "(encrypted, in a file only your account can read)");
  assert.equal(keptHow("linux"), "(kept on this PC only)");
  assert.equal(keptHow("windows"), "(encrypted with Windows DPAPI)");
});

test("cleanPresets normalizes, deduplicates, sorts, and caps timer presets", () => {
  assert.deepEqual(
    cleanPresets([25, "5", 5, 0, 601, 7.6, 50, 1, 2, 3, 4, 9]),
    [1, 2, 3, 4, 5, 8, 9, 25]
  );
  assert.deepEqual(cleanPresets(null), []);
});

test("syncIdFields decides when OAuth client ID inputs are shown", () => {
  assert.deepEqual(syncIdFields({ builtIn: { google: true } }, "google", {}), []);
  assert.deepEqual(syncIdFields({ ready: { google: true } }, "google", {}), []);
  assert.deepEqual(
    syncIdFields({ ready: { google: true } }, "google", { todoSyncGoogleClientId: "x" }),
    ["todoSyncGoogleClientId", "todoSyncGoogleClientSecret"]
  );
  assert.deepEqual(syncIdFields({ ready: {} }, "microsoft", {}), ["todoSyncMsClientId"]);
});

test("calendar feed URL helpers, defaultEventStart, and showKemenag", () => {
  assert.equal(validFeedUrl("webcal://p01.icloud.com/x"), true);
  assert.equal(validFeedUrl("ftp://x"), false);
  assert.equal(
    shortFeedUrl("https://calendar.google.com/calendar/ical/abcdefghijk/basic.ics"),
    "https://calendar.google.com/calendar/ical/abcdef…/basic.ics"
  );
  assert.equal(defaultEventStart(new Date(2026, 10, 20, 14, 35)), "2026-11-20T15:00");
  assert.equal(showKemenag({ country: "Indonesia" }, "auto"), true);
  assert.equal(showKemenag({ country: "Indonesia" }, "20"), false);
  assert.equal(showKemenag(null, "auto"), false);
});

test("tileList, moveTile, and toggleTile preserve enabled order", () => {
  const cat = ["shelf", "share", "zip", "eject"];
  assert.deepEqual(tileList(cat, ["zip", "shelf"]), ["zip", "shelf", "share", "eject"]);
  assert.deepEqual(
    moveTile(["zip", "shelf", "share", "eject"], ["zip", "shelf"], 1, -1),
    ["shelf", "zip"]
  );
  assert.deepEqual(
    moveTile(["zip", "shelf", "share", "eject"], ["zip", "shelf"], 1, 1),
    ["zip", "shelf"]
  );
  assert.deepEqual(toggleTile(["zip"], "share", true), ["zip", "share"]);
  assert.deepEqual(toggleTile(["zip", "share"], "zip", false), ["share"]);
});
