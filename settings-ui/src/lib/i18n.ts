export function t(s: string, vars?: Record<string, unknown>): string {
  if (typeof window !== "undefined" && typeof window._t === "function") {
    return window._t(s, vars);
  }
  let out = s.split("|")[0];
  if (vars) {
    out = out.replace(/\{(\w+)\}/g, (m, k: string) =>
      vars[k] === undefined || vars[k] === null ? m : String(vars[k])
    );
  }
  return out;
}
