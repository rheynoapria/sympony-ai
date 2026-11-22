import type { Settings } from "../lib/mock.ts";
import type { FieldRow, Row } from "./types.ts";

export function getK(s: Settings, k: string): unknown {
  if (!k) return undefined;
  return k
    .split(".")
    .reduce<unknown>(
      (o, p) => (o != null && typeof o === "object" ? (o as Record<string, unknown>)[p] : undefined),
      s
    );
}

export function rowValue(row: FieldRow, s: Settings): unknown {
  return getK(s, row.k) ?? row.unset;
}

export function patchFor(s: Settings, k: string, v: unknown): Settings {
  const parts = k.split(".");
  if (parts.length === 1) return { [k]: v };
  const cur = s[parts[0]];
  const top: Record<string, unknown> =
    cur && typeof cur === "object" && !Array.isArray(cur)
      ? { ...(cur as Record<string, unknown>) }
      : {};
  top[parts[1]] = v;
  return { [parts[0]]: top };
}

export function commitValue(
  row: Row,
  raw: string | boolean,
  s: Settings
): { ok: true; v: unknown } | { ok: false } {
  if (row.t === "toggle") {
    return { ok: true, v: Boolean(raw) };
  }
  if (row.t === "range") {
    const n = Number(raw);
    return Number.isFinite(n) ? { ok: true, v: n } : { ok: false };
  }
  if (row.t === "number") {
    const str = String(raw);
    if (str.trim() === "") return { ok: false };
    const n = Math.round(Number(str));
    if (!Number.isFinite(n)) return { ok: false };
    const min = row.min ?? -Infinity;
    const max = row.max ?? Infinity;
    return { ok: true, v: Math.min(max, Math.max(min, n)) };
  }
  if (row.t === "list") {
    const arr = String(raw)
      .split(",")
      .map((x) => x.trim().toLowerCase())
      .filter(Boolean);
    return { ok: true, v: arr };
  }
  if (row.t === "select") {
    let v: string | number = String(raw);
    const opts =
      typeof row.options === "function" ? row.options(s) : row.options ?? [];
    if (opts.length > 0 && typeof opts[0][0] === "number") {
      v = Number(v);
    }
    if (row.k === "display" && typeof v === "string" && /^\d+$/.test(v)) {
      v = Number(v);
    }
    return { ok: true, v };
  }
  if (row.t === "text" || row.t === "time") {
    return { ok: true, v: String(raw) };
  }
  return { ok: false };
}

export type LeadNode =
  | string
  | { b: string }
  | { i: string }
  | { code: string }
  | { br: true };

export function leadNodes(html: string): LeadNode[] {
  const out: LeadNode[] = [];
  const re = /<(b|i|code)>([\s\S]*?)<\/\1>|<br\s*\/?>/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) {
    if (m.index > last) out.push(html.slice(last, m.index));
    const tag = m[1];
    if (tag === "b") out.push({ b: m[2] });
    else if (tag === "i") out.push({ i: m[2] });
    else if (tag === "code") out.push({ code: m[2] });
    else out.push({ br: true });
    last = m.index + m[0].length;
  }
  if (last < html.length) out.push(html.slice(last));
  return out;
}

export function plainText(s: string | undefined): string {
  return String(s ?? "")
    .replace(/<[^>]+>/g, " ")
    .replace(/&[a-z#0-9]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}
