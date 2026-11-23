import { useCallback, useEffect, useState } from "react";
import { notch, type Settings } from "./notch.ts";

export type UpdateStatus =
  | "idle"
  | "checking"
  | "upToDate"
  | "available"
  | "downloading"
  | "ready"
  | "installing"
  | "error";

export type UpdateChannel = "stable" | "beta";

export interface UpdateState {
  status: UpdateStatus;
  currentVersion: string;
  currentChannel: UpdateChannel;
  watchBeta: boolean;
  availableVersion: string | null;
  availableChannel: UpdateChannel | null;
  notes: string;
  pubDate: string | null;
  downloaded: number;
  total: number | null;
  percent: number | null;
  dismissedVersion: string;
  lastChecked: number | null;
  error: string | null;
  preview: boolean;
}

export function isPrereleaseVersion(version?: string | null): boolean {
  if (!version) return false;
  return version.trim().replace(/^v/i, "").includes("-");
}

export function effectiveWatchBeta(
  settings: Settings,
  currentVersion?: string | null
): boolean {
  if (typeof settings.updateBeta === "boolean") {
    return settings.updateBeta;
  }
  return isPrereleaseVersion(currentVersion);
}

export function normalizeUpdateState(raw: unknown): UpdateState | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const currentVersion =
    typeof r.currentVersion === "string"
      ? r.currentVersion
      : typeof r.version === "string"
        ? r.version
        : "";
  const status = (
    typeof r.status === "string"
      ? r.status
      : typeof r.state === "string"
        ? r.state
        : "idle"
  ) as UpdateStatus;
  const currentChannel: UpdateChannel =
    r.currentChannel === "beta" || isPrereleaseVersion(currentVersion)
      ? "beta"
      : "stable";
  const availableVersion =
    typeof r.availableVersion === "string" && r.availableVersion.trim()
      ? r.availableVersion.trim()
      : null;
  const availableChannel: UpdateChannel | null = availableVersion
    ? r.availableChannel === "beta" || isPrereleaseVersion(availableVersion)
      ? "beta"
      : "stable"
    : null;

  return {
    status,
    currentVersion,
    currentChannel,
    watchBeta:
      typeof r.watchBeta === "boolean"
        ? r.watchBeta
        : currentChannel === "beta",
    availableVersion,
    availableChannel,
    notes: typeof r.notes === "string" ? r.notes : "",
    pubDate: typeof r.pubDate === "string" ? r.pubDate : null,
    downloaded: typeof r.downloaded === "number" ? r.downloaded : 0,
    total: typeof r.total === "number" ? r.total : null,
    percent: typeof r.percent === "number" ? r.percent : null,
    dismissedVersion:
      typeof r.dismissedVersion === "string" ? r.dismissedVersion : "",
    lastChecked: typeof r.lastChecked === "number" ? r.lastChecked : null,
    error: typeof r.error === "string" && r.error ? r.error : null,
    preview: Boolean(r.preview),
  };
}

export function shouldShowBanner(u: UpdateState | null): boolean {
  if (!u) return false;
  if (u.status === "downloading" || u.status === "installing" || u.status === "ready") {
    return true;
  }
  if (u.status === "error" && u.error) {
    return true;
  }
  if (u.status === "available" && u.availableVersion) {
    return u.availableVersion !== u.dismissedVersion;
  }
  return false;
}

export function hasPendingBadge(u: UpdateState | null): UpdateChannel | null {
  if (!u || !u.availableVersion) return null;
  if (
    u.status === "available" &&
    u.availableVersion === u.dismissedVersion
  ) {
    return null;
  }
  if (
    u.status === "available" ||
    u.status === "downloading" ||
    u.status === "ready" ||
    u.status === "installing"
  ) {
    return u.availableChannel ?? (isPrereleaseVersion(u.availableVersion) ? "beta" : "stable");
  }
  return null;
}

export function formatBytes(n?: number | null): string {
  if (n == null || !Number.isFinite(n) || n <= 0) return "";
  if (n < 1024 * 1024) return `${Math.max(1, Math.round(n / 1024))} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function parseReleaseBullets(md?: string): string[] {
  if (!md) return [];
  const lines = md
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
    .filter((l) => !l.startsWith("#"));
  const bullets = lines
    .filter((l) => /^[-*•]\s+/.test(l))
    .map((l) => l.replace(/^[-*•]\s+/, "").trim());
  if (bullets.length > 0) return bullets;
  return lines.slice(0, 4);
}

export function useUpdateState() {
  const [update, setUpdate] = useState<UpdateState | null>(null);

  useEffect(() => {
    let alive = true;
    notch
      .updateState()
      .then((res) => {
        if (alive) {
          const norm = normalizeUpdateState(res);
          if (norm) setUpdate(norm);
        }
      })
      .catch(() => {});

    const handle = (payload: unknown) => {
      if (!alive) return;
      const norm = normalizeUpdateState(payload);
      if (norm) setUpdate(norm);
    };

    const unsub =
      typeof notch.onUpdate === "function"
        ? notch.onUpdate(handle)
        : notch.on("update:state", handle);

    return () => {
      alive = false;
      unsub();
    };
  }, []);

  const check = useCallback(async (install = false) => {
    const res = await notch.updateCheck(install).catch(() => null);
    const norm = normalizeUpdateState(res);
    if (norm) setUpdate(norm);
    return norm;
  }, []);

  const install = useCallback(async () => {
    const res = await notch.svc("update", "install").catch(() => null);
    const norm = normalizeUpdateState(res);
    if (norm) setUpdate(norm);
    return norm;
  }, []);

  const dismiss = useCallback(async () => {
    const res = await notch.svc("update", "dismiss").catch(() => null);
    const norm = normalizeUpdateState(res);
    if (norm) setUpdate(norm);
    return norm;
  }, []);

  const openPage = useCallback(async () => {
    await notch.updatePage().catch(() => {});
  }, []);

  return { update, check, install, dismiss, openPage };
}
