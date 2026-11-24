import { describe, expect, test } from "bun:test";
import { mergeDownloadProgress } from "./voice";
import { fmtModelSize } from "./voice/ModelCard";

describe("voice download progress anti-glitch helpers", () => {
  test("mergeDownloadProgress keeps done monotonic for the same model and falls back to catalog size", () => {
    const start = mergeDownloadProgress(
      null,
      { id: "0.6b", done: 0, total: 0, status: "downloading", seq: 1 },
      589_560_480
    );
    expect(start.total).toBe(589_560_480);
    expect(start.done).toBe(0);

    const mid = mergeDownloadProgress(
      start,
      { id: "0.6b", done: 150_000_000, total: 589_560_480, status: "downloading", seq: 2 },
      589_560_480
    );
    expect(mid.done).toBe(150_000_000);

    // Out-of-order stale byte count must never jump the bar backwards.
    const stale = mergeDownloadProgress(
      mid,
      { id: "0.6b", done: 120_000_000, total: 589_560_480, status: "downloading", seq: 3 },
      589_560_480
    );
    expect(stale.done).toBe(150_000_000);

    // Switching to the next queued model resets done cleanly for the new model ID.
    const nextModel = mergeDownloadProgress(
      stale,
      { id: "zf-id", done: 1_048_576, total: 70_908_694, status: "downloading", seq: 4 },
      70_908_694
    );
    expect(nextModel.id).toBe("zf-id");
    expect(nextModel.done).toBe(1_048_576);
  });

  test("fmtModelSize formats sub-10MB, MB, and GB cleanly without 0 MB flicker", () => {
    expect(fmtModelSize(0)).toBe("0 MB");
    expect(fmtModelSize(2.5 * 1024 * 1024)).toBe("2.5 MB");
    expect(fmtModelSize(589_560_480)).toBe("562 MB");
    expect(fmtModelSize(1_319_830_496)).toBe("1.23 GB");
  });
});
