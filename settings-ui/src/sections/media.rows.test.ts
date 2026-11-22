import assert from "node:assert/strict";
import test from "node:test";
import type { FieldRow } from "../rows/types.ts";
import { MEDIA_ROWS } from "./media.rows.ts";

test("Media has the YouTube video mode rows before Lyrics", () => {
  const i = (pred: (r: (typeof MEDIA_ROWS)[number]) => boolean) => MEDIA_ROWS.findIndex(pred);
  const yt = i((r) => r.t === "h2" && "text" in r && r.text === "YouTube");
  const video = i((r) => "k" in r && (r as FieldRow).k === "ytVideo");
  const fill = i((r) => "k" in r && (r as FieldRow).k === "ytVideoFill");
  const status = i((r) => r.t === "custom" && "id" in r && r.id === "ytStatus");
  const lyrics = i((r) => r.t === "h2" && "text" in r && r.text === "Lyrics");
  assert.ok(yt >= 0 && yt < video && video < fill && fill < status && status < lyrics, `${yt} ${video} ${fill} ${status} ${lyrics}`);
});
