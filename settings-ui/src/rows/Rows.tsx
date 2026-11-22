import { Fragment, useEffect, useState, type ReactNode } from "react";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { Slider } from "@/components/ui/knowns/slider";
import { Switch } from "@/components/ui/knowns/switch";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { t } from "@/lib/i18n";
import type { Settings } from "@/lib/notch";
import { cn } from "@/lib/knowns/utils";
import type { OS } from "@/sections/registry";
import { commitValue, leadNodes, patchFor, plainText, rowValue } from "./logic";
import { applyOs, optionsFor } from "./os";
import type { CustomPart, FieldRow, Row } from "./types";

const INPUT_CLASS =
  "h-8 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none transition-colors focus:border-ring focus:ring-2 focus:ring-ring/25";

export function RichInline({ html }: { html: string }) {
  const parts = leadNodes(t(html));
  return (
    <>
      {parts.map((p, i) => {
        if (typeof p === "string") return <Fragment key={i}>{p}</Fragment>;
        if ("b" in p) {
          return (
            <strong key={i} className="font-semibold text-foreground">
              {p.b}
            </strong>
          );
        }
        if ("i" in p) {
          return (
            <em key={i} className="italic">
              {p.i}
            </em>
          );
        }
        if ("code" in p) {
          return (
            <code
              key={i}
              className="rounded bg-muted px-1 py-0.5 font-mono text-[11.5px] text-foreground"
            >
              {p.code}
            </code>
          );
        }
        return <br key={i} />;
      })}
    </>
  );
}

export function LeadText({ html }: { html: string }) {
  return (
    <p className="text-[13px] leading-relaxed text-muted-foreground">
      <RichInline html={html} />
    </p>
  );
}

function NumberInput({
  row,
  settings,
  set,
}: {
  row: FieldRow;
  settings: Settings;
  set: (patch: Settings) => Promise<unknown>;
}) {
  const saved = rowValue(row, settings);
  const savedStr = saved === undefined || saved === null ? "" : String(saved);
  const [draft, setDraft] = useState(savedStr);

  useEffect(() => {
    setDraft(savedStr);
  }, [savedStr]);

  const commit = () => {
    const res = commitValue(row, draft, settings);
    if (!res.ok) {
      setDraft(savedStr);
      return;
    }
    setDraft(String(res.v));
    if (res.v !== saved) {
      void set(patchFor(settings, row.k, res.v));
    }
  };

  return (
    <div className="inline-flex items-center gap-2" data-k={row.k}>
      <input
        type="number"
        aria-label={t(row.label)}
        min={row.min}
        max={row.max}
        step={row.step ?? 1}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(INPUT_CLASS, "w-24 tabular-nums")}
      />
      {row.unit && (
        <span className="text-[12.5px] text-muted-foreground">{t(row.unit)}</span>
      )}
    </div>
  );
}

function TextInput({
  row,
  settings,
  set,
}: {
  row: FieldRow;
  settings: Settings;
  set: (patch: Settings) => Promise<unknown>;
}) {
  const saved = rowValue(row, settings);
  const savedStr =
    row.t === "list"
      ? Array.isArray(saved)
        ? saved.join(", ")
        : ""
      : saved === undefined || saved === null
        ? ""
        : String(saved);
  const [draft, setDraft] = useState(savedStr);

  useEffect(() => {
    setDraft(savedStr);
  }, [savedStr]);

  const commit = (val: string) => {
    const res = commitValue(row, val, settings);
    if (!res.ok) return;
    void set(patchFor(settings, row.k, res.v));
  };

  return (
    <div data-k={row.k}>
      <input
        type={row.t === "time" ? "time" : "text"}
        aria-label={t(row.label)}
        value={draft}
        placeholder={row.placeholder ? t(row.placeholder) : undefined}
        onChange={(e) => {
          setDraft(e.target.value);
          if (row.t === "time") commit(e.target.value);
        }}
        onBlur={() => commit(draft)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(draft);
            (e.target as HTMLInputElement).blur();
          }
        }}
        className={cn(
          INPUT_CLASS,
          row.t === "time"
            ? "w-32 tabular-nums"
            : row.short
              ? "w-36"
              : "w-64 max-w-full"
        )}
      />
    </div>
  );
}

function FieldControl({
  row,
  settings,
  set,
  os,
}: {
  row: FieldRow;
  settings: Settings;
  set: (patch: Settings) => Promise<unknown>;
  os: OS;
}) {
  const val = rowValue(row, settings);

  if (row.t === "toggle") {
    return (
      <div data-k={row.k}>
        <Switch
          checked={Boolean(val)}
          aria-label={t(row.label)}
          onCheckedChange={(checked) => {
            const res = commitValue(row, checked, settings);
            if (res.ok) void set(patchFor(settings, row.k, res.v));
          }}
        />
      </div>
    );
  }

  if (row.t === "range") {
    const num = typeof val === "number" ? val : Number(val ?? row.min ?? 0);
    return (
      <div className="flex w-52 items-center gap-3" data-k={row.k}>
        <Slider
          value={num}
          min={row.min ?? 0}
          max={row.max ?? 100}
          step={row.step ?? 1}
          size="sm"
          hideValue
          aria-label={t(row.label)}
          onValueChange={(next) => {
            const res = commitValue(row, String(next), settings);
            if (res.ok) void set(patchFor(settings, row.k, res.v));
          }}
          className="flex-1"
        />
        <span className="min-w-14 shrink-0 rounded-[7px] border border-border bg-muted/60 px-2 py-0.5 text-center text-[12px] font-medium tabular-nums text-foreground">
          {num}
          {row.unit ? ` ${t(row.unit)}` : ""}
        </span>
      </div>
    );
  }

  if (row.t === "select") {
    const opts = optionsFor(row, settings, os);
    const curStr = val === undefined || val === null ? "" : String(val);
    const useSegmented =
      row.k !== "display" &&
      opts.length >= 2 &&
      opts.length <= 4 &&
      opts.every(([, lbl]) => t(lbl).length <= 18);

    if (useSegmented) {
      return (
        <div data-k={row.k}>
          <SegmentedControl
            tone="neutral"
            size="sm"
            aria-label={t(row.label)}
            value={curStr}
            options={opts.map(([v, l]) => ({ value: String(v), label: t(l) }))}
            onValueChange={(next) => {
              const res = commitValue(row, next, settings);
              if (res.ok) void set(patchFor(settings, row.k, res.v));
            }}
          />
        </div>
      );
    }

    return (
      <div data-k={row.k}>
        <select
          aria-label={t(row.label)}
          value={curStr}
          onChange={(e) => {
            const res = commitValue(row, e.target.value, settings);
            if (res.ok) void set(patchFor(settings, row.k, res.v));
          }}
          className={cn(INPUT_CLASS, "min-w-44 max-w-72 pe-8")}
        >
          {opts.map(([v, l]) => (
            <option key={String(v)} value={String(v)}>
              {t(l)}
            </option>
          ))}
        </select>
      </div>
    );
  }

  if (row.t === "number") {
    return <NumberInput row={row} settings={settings} set={set} />;
  }

  return <TextInput row={row} settings={settings} set={set} />;
}

interface Block {
  kind: "lead" | "group";
  title?: string;
  leads?: string[];
  html?: string;
  rows?: Row[];
}

function groupRows(rows: Row[]): Block[] {
  const blocks: Block[] = [];
  let cur: { title?: string; leads: string[]; rows: Row[] } | null = null;

  const flush = () => {
    if (cur && (cur.rows.length > 0 || cur.leads.length > 0)) {
      blocks.push({
        kind: "group",
        title: cur.title,
        leads: cur.leads.length > 0 ? cur.leads : undefined,
        rows: cur.rows,
      });
    }
    cur = null;
  };

  for (const r of rows) {
    if (r.t === "lead") {
      if (cur && cur.title && cur.rows.length === 0) {
        cur.leads.push(r.html);
      } else {
        flush();
        blocks.push({ kind: "lead", html: r.html });
      }
    } else if (r.t === "h2") {
      flush();
      cur = { title: r.text, leads: [], rows: [] };
    } else {
      if (!cur) cur = { leads: [], rows: [] };
      cur.rows.push(r);
    }
  }
  flush();
  return blocks;
}

export function Rows({
  sectionId,
  rows,
  customs,
  settings,
  set,
  os,
  part,
  onNavigate,
}: {
  sectionId: string;
  rows: readonly Row[];
  customs?: Record<string, CustomPart>;
  settings: Settings;
  set: (patch: Settings) => Promise<unknown>;
  os: OS;
  part?: string | null;
  onNavigate?: (target: string) => void;
}) {
  const filtered = applyOs(sectionId, rows, os);
  const blocks = groupRows(filtered);

  return (
    <div className="flex flex-col gap-4">
      {blocks.map((b, bi) => {
        if (b.kind === "lead" && b.html) {
          return <LeadText key={`lead-${bi}`} html={b.html} />;
        }
        const items: ReactNode[] = [];
        for (let ri = 0; ri < (b.rows?.length ?? 0); ri++) {
          const r = b.rows![ri];
          if (r.t === "custom") {
            const Comp = customs?.[r.id];
            if (!Comp) continue;
            const rendered = (
              <div
                key={`c-${r.id}-${ri}`}
                data-spot={r.spot}
                data-row-label={r.label ? plainText(t(r.label)) : undefined}
                className="py-3 first:pt-0 last:pb-0 empty:hidden"
              >
                <Comp
                  settings={settings}
                  set={set}
                  row={r}
                  os={os}
                  part={part}
                  onNavigate={onNavigate}
                />
              </div>
            );
            items.push(rendered);
            continue;
          }
          if (r.t === "h2" || r.t === "lead") continue;
          items.push(
            <div
              key={`f-${r.k}-${ri}`}
              data-spot={r.spot}
              data-row-label={plainText(t(r.label))}
              className="py-3 first:pt-0 last:pb-0"
            >
              <SettingsRow
                label={t(r.label)}
                description={r.sub ? <RichInline html={r.sub} /> : undefined}
              >
                <FieldControl row={r} settings={settings} set={set} os={os} />
              </SettingsRow>
            </div>
          );
        }
        if (items.length === 0 && (!b.leads || b.leads.length === 0)) return null;
        return (
          <PanelCard
            key={`grp-${bi}`}
            title={b.title ? t(b.title) : undefined}
            icon={groupIcon(b.title)}
          >
            {b.leads && b.leads.length > 0 && (
              <div className="mb-3 space-y-1">
                {b.leads.map((html, li) => (
                  <LeadText key={`gl-${li}`} html={html} />
                ))}
              </div>
            )}
            {items.length > 0 && (
              <div className="divide-y divide-border/80">{items}</div>
            )}
          </PanelCard>
        );
      })}
    </div>
  );
}
