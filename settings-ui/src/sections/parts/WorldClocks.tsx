import { useState } from "react";
import { ChevronDown, ChevronUp, Clock, Moon, Sun, X } from "@/components/icons";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import type { ClockPlace } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";

export function WorldClocksPart({ settings, set, row }: CustomPartProps) {
  const W = typeof window !== "undefined" ? window.SymponyClock : undefined;
  const [query, setQuery] = useState("");
  const [focused, setFocused] = useState(false);

  if (!W) return null;

  const list: ClockPlace[] = W.places(settings);
  const full = list.length >= W.MAX;
  const now = Date.now();
  const h24 = settings.clock24h !== false;

  const save = (next: ClockPlace[]) =>
    void set({ worldClocks: next.slice(0, W.MAX) });

  const add = (z: ClockPlace | undefined) => {
    setQuery("");
    if (z && !list.some((p) => p.tz === z.tz && p.name === z.name)) {
      save([...list, { name: z.name, tz: z.tz }]);
    }
  };

  const suggestions = query.trim() ? W.search(query, 6) : [];
  const label = row && "label" in row && row.label ? t(row.label) : t("World clock");
  const sub = full
    ? t("Up to {n}. Remove one to add another.", { n: W.MAX })
    : row && "sub" in row && row.sub
      ? t(row.sub)
      : "";

  return (
    <div className="flex flex-col gap-2" data-k="worldClocks">
      <SettingsRow label={label} description={sub}>
        {!full ? (
          <div className="relative">
            <input
              type="text"
              value={query}
              autoComplete="off"
              spellCheck={false}
              placeholder={t("Add a city…")}
              onFocus={() => setFocused(true)}
              onBlur={() => window.setTimeout(() => setFocused(false), 150)}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const first = W.search(query, 1)[0];
                  if (first) add(first);
                }
              }}
              className="h-8 w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
            />
            {focused && suggestions.length > 0 && (
              <div className="absolute end-0 top-9 z-20 w-72 overflow-hidden rounded-[10px] border border-border bg-popover p-1 shadow-lg">
                {suggestions.map((z) => (
                  <button
                    key={`${z.name}:${z.tz}`}
                    type="button"
                    onMouseDown={(e) => {
                      e.preventDefault();
                      add(z);
                    }}
                    className="flex w-full cursor-pointer items-center justify-between gap-2 rounded-[7px] px-2.5 py-1.5 text-start text-[12.5px] text-popover-foreground hover:bg-muted"
                  >
                    <span className="flex min-w-0 items-center gap-1.5">
                      <Clock className="size-3.5 shrink-0 opacity-60" aria-hidden="true" />
                      <span className="truncate font-medium">{z.name}</span>
                    </span>
                    <span className="shrink-0 text-[11px] tabular-nums text-muted-foreground">
                      {z.tz.replace(/_/g, " ")} · {W.time(z.tz, now, h24)}
                    </span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}
      </SettingsRow>

      {list.length > 0 && (
        <div className="divide-y divide-border/70 rounded-[10px] border border-border bg-muted/25 ps-3 pe-2">
          {list.map((p, i) => {
            const inf = W.info(p.tz, now);
            return (
              <div
                key={`${p.tz}-${i}`}
                className="flex items-center justify-between gap-3 py-2"
              >
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    {inf.night ? (
                      <Moon className="size-3.5 shrink-0 text-indigo-400" aria-hidden="true" />
                    ) : (
                      <Sun className="size-3.5 shrink-0 text-amber-400" aria-hidden="true" />
                    )}
                    <input
                      type="text"
                      defaultValue={p.name}
                      maxLength={30}
                      aria-label={t("City name")}
                      onBlur={(e) => {
                        const nextName = e.target.value.trim() || W.cityOf(p.tz);
                        if (nextName === p.name) return;
                        const next = list.map((item, idx) =>
                          idx === i ? { ...item, name: nextName } : item
                        );
                        save(next);
                      }}
                      className="h-7 w-44 rounded-[6px] border border-input bg-background px-2 text-[12.5px] text-foreground outline-none focus:border-ring"
                    />
                  </div>
                  <div className="mt-0.5 ps-5.5 text-[11.5px] tabular-nums text-muted-foreground">
                    {p.tz.replace(/_/g, " ")} · {W.time(p.tz, now, h24)} ·{" "}
                    {W.diffLine(inf)}
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-0.5">
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<ChevronUp />}
                    disabled={i === 0}
                    title={t("Move up")}
                    aria-label={t("Move up")}
                    onClick={() => {
                      const next = list.slice();
                      [next[i - 1], next[i]] = [next[i], next[i - 1]];
                      save(next);
                    }}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<ChevronDown />}
                    disabled={i === list.length - 1}
                    title={t("Move down")}
                    aria-label={t("Move down")}
                    onClick={() => {
                      const next = list.slice();
                      [next[i + 1], next[i]] = [next[i], next[i + 1]];
                      save(next);
                    }}
                  />
                  <Button
                    size="xs"
                    variant="ghost"
                    icon={<X />}
                    title={t("Remove")}
                    aria-label={t("Remove")}
                    onClick={() => save(list.filter((_, idx) => idx !== i))}
                  />
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
