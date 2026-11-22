import { useMemo, useRef, useState } from "react";
import { Download, Play, Plus, Search, Trash2, Upload } from "@/components/icons";
import { Badge } from "@/components/ui/knowns/badge";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import {
  MAX_DICT_ENTRIES,
  PROMPT_CAP,
  previewImport,
  promptSlotsUsed,
  type UserDict,
} from "./dictionary";

interface TestResult {
  text: string;
  corrections: { from: string; to: string; category: string }[];
}

export function DictionaryManager({
  dict,
  jargon,
  onSave,
}: {
  dict: UserDict;
  jargon: boolean;
  onSave: (next: UserDict) => Promise<void>;
}) {
  const [query, setQuery] = useState("");
  const [newTerm, setNewTerm] = useState("");
  const [newTermPrompt, setNewTermPrompt] = useState(true);
  const [newFrom, setNewFrom] = useState("");
  const [newTo, setNewTo] = useState("");
  const [importMsg, setImportMsg] = useState("");
  const [tryInput, setTryInput] = useState("");
  const [tryResult, setTryResult] = useState<TestResult | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);

  const slotsUsed = useMemo(
    () => promptSlotsUsed(dict.terms, jargon),
    [dict.terms, jargon]
  );

  const q = query.trim().toLowerCase();
  const filteredTerms = useMemo(
    () => (q ? dict.terms.filter((x) => x.text.toLowerCase().includes(q)) : dict.terms),
    [dict.terms, q]
  );
  const filteredReps = useMemo(
    () =>
      q
        ? dict.replacements.filter(
            (r) => r.from.toLowerCase().includes(q) || r.to.toLowerCase().includes(q)
          )
        : dict.replacements,
    [dict.replacements, q]
  );

  const addTerm = async () => {
    const text = newTerm.trim();
    if (!text || dict.terms.length >= MAX_DICT_ENTRIES) return;
    if (dict.terms.some((x) => x.text.toLowerCase() === text.toLowerCase())) {
      setNewTerm("");
      return;
    }
    const next: UserDict = {
      ...dict,
      terms: [{ text, prompt: newTermPrompt }, ...dict.terms],
    };
    setNewTerm("");
    await onSave(next);
  };

  const toggleTermPrompt = async (text: string, prompt: boolean) => {
    const next: UserDict = {
      ...dict,
      terms: dict.terms.map((x) => (x.text === text ? { ...x, prompt } : x)),
    };
    await onSave(next);
  };

  const deleteTerm = async (text: string) => {
    const next: UserDict = {
      ...dict,
      terms: dict.terms.filter((x) => x.text !== text),
    };
    await onSave(next);
  };

  const addReplacement = async () => {
    const from = newFrom.trim();
    const to = newTo.trim();
    if (!from || !to || dict.replacements.length >= MAX_DICT_ENTRIES) return;
    if (dict.replacements.some((r) => r.from.toLowerCase() === from.toLowerCase())) {
      setNewFrom("");
      setNewTo("");
      return;
    }
    const next: UserDict = {
      ...dict,
      replacements: [{ from, to }, ...dict.replacements],
    };
    setNewFrom("");
    setNewTo("");
    await onSave(next);
  };

  const deleteReplacement = async (from: string) => {
    const next: UserDict = {
      ...dict,
      replacements: dict.replacements.filter((r) => r.from !== from),
    };
    await onSave(next);
  };

  const handleFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const text = await file.text();
    const kind: "csv" | "txt" = file.name.toLowerCase().endsWith(".txt") ? "txt" : "csv";
    const preview = previewImport(dict, kind, text);
    try {
      const res = (await notch.svc("voice", "dictImport", kind, text)) as {
        report?: { added_terms?: number; added_replacements?: number; skipped?: number };
        dict?: UserDict;
      };
      const added =
        (res?.report?.added_terms ?? preview.addedTerms) +
        (res?.report?.added_replacements ?? preview.addedReplacements);
      const skipped = res?.report?.skipped ?? preview.skipped;
      setImportMsg(t("{added} added, {skipped} skipped", { added, skipped }));
      if (res?.dict) {
        await onSave(res.dict);
      }
    } catch {
      const added = preview.addedTerms + preview.addedReplacements;
      setImportMsg(t("{added} added, {skipped} skipped", { added, skipped: preview.skipped }));
    }
    e.target.value = "";
  };

  const handleExport = async () => {
    const csv = (await notch.svc("voice", "dictExport")) as string;
    const blob = new Blob([typeof csv === "string" ? csv : "type,text,to,prompt\n"], {
      type: "text/csv;charset=utf-8",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "sympony-dictionary.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  const handleTry = async () => {
    const raw = tryInput.trim();
    if (!raw) return;
    const res = (await notch.svc("voice", "test", raw)) as TestResult;
    if (res && typeof res.text === "string") {
      setTryResult({ text: res.text, corrections: res.corrections ?? [] });
    }
  };

  return (
    <div className="flex flex-col gap-4">
      {/* Search, prompt slot meter, import/export */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <input
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder={t("Search dictionary…")}
            className="h-8 w-full rounded-md border border-input bg-background pr-3 pl-8 text-[12.5px] text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-ring"
          />
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="outline" className="tabular-nums text-[11px]">
            {t("Prompt slots")}: {slotsUsed} / {PROMPT_CAP}
          </Badge>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,.txt"
            className="hidden"
            onChange={handleFile}
          />
          <Button size="sm" variant="secondary" icon={<Upload />} onClick={() => fileRef.current?.click()}>
            {t("Import CSV / TXT")}
          </Button>
          <Button size="sm" variant="secondary" icon={<Download />} onClick={handleExport}>
            {t("Export CSV")}
          </Button>
        </div>
      </div>

      {importMsg && (
        <div className="text-[12px] text-emerald-600 dark:text-emerald-400">{importMsg}</div>
      )}

      {/* Terms */}
      <div className="flex flex-col gap-2">
        <div className="flex items-center justify-between">
          <span className="text-[12.5px] font-medium text-foreground">
            {t("Terms")} ({filteredTerms.length})
          </span>
          <span className="text-[11.5px] text-muted-foreground">{t("Send to engine")}</span>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newTerm}
            onChange={(e) => setNewTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addTerm()}
            placeholder={t("Add term")}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[12.5px]"
          />
          <label className="flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
            <Switch checked={newTermPrompt} onCheckedChange={setNewTermPrompt} />
            {t("Send to engine")}
          </label>
          <Button size="sm" icon={<Plus />} onClick={addTerm} disabled={!newTerm.trim()}>
            {t("Add term")}
          </Button>
        </div>
        {filteredTerms.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-md border border-border/80 divide-y divide-border/60">
            {filteredTerms.slice(0, 200).map((item) => (
              <div
                key={item.text}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12.5px]"
              >
                <span className="truncate font-medium text-foreground">{item.text}</span>
                <div className="flex shrink-0 items-center gap-2">
                  <Switch
                    checked={item.prompt}
                    onCheckedChange={(v) => toggleTermPrompt(item.text, v)}
                    aria-label={t("Send to engine")}
                  />
                  <Button
                    size="sm"
                    variant="ghost"
                    aria-label={t("Delete")}
                    icon={<Trash2 className="text-muted-foreground hover:text-destructive" />}
                    onClick={() => deleteTerm(item.text)}
                  />
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Replacements */}
      <div className="flex flex-col gap-2">
        <span className="text-[12.5px] font-medium text-foreground">
          {t("Replacements")} ({filteredReps.length})
        </span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={newFrom}
            onChange={(e) => setNewFrom(e.target.value)}
            placeholder={t("From")}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[12.5px]"
          />
          <span className="text-muted-foreground">→</span>
          <input
            type="text"
            value={newTo}
            onChange={(e) => setNewTo(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && addReplacement()}
            placeholder={t("To")}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[12.5px]"
          />
          <Button
            size="sm"
            icon={<Plus />}
            onClick={addReplacement}
            disabled={!newFrom.trim() || !newTo.trim()}
          >
            {t("Add replacement")}
          </Button>
        </div>
        {filteredReps.length > 0 && (
          <div className="max-h-40 overflow-y-auto rounded-md border border-border/80 divide-y divide-border/60">
            {filteredReps.slice(0, 200).map((r) => (
              <div
                key={r.from}
                className="flex items-center justify-between gap-2 px-3 py-1.5 text-[12.5px]"
              >
                <div className="flex min-w-0 items-center gap-2">
                  <span className="truncate text-muted-foreground">{r.from}</span>
                  <span className="text-muted-foreground">→</span>
                  <span className="truncate font-medium text-foreground">{r.to}</span>
                </div>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={t("Delete")}
                  icon={<Trash2 className="text-muted-foreground hover:text-destructive" />}
                  onClick={() => deleteReplacement(r.from)}
                />
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Try it box */}
      <div className="flex flex-col gap-2 rounded-lg border border-border/80 bg-muted/20 p-3">
        <span className="text-[12.5px] font-medium text-foreground">{t("Try it")}</span>
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={tryInput}
            onChange={(e) => setTryInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleTry()}
            placeholder={t("Type a test phrase (e.g. kasa belangka dua puluh ribu rupiah)…")}
            className="h-8 flex-1 rounded-md border border-input bg-background px-2.5 text-[12.5px]"
          />
          <Button size="sm" icon={<Play />} onClick={handleTry} disabled={!tryInput.trim()}>
            {t("Run")}
          </Button>
        </div>
        {tryResult && (
          <div className="flex flex-col gap-1 rounded-md bg-background/80 px-2.5 py-2 text-[12.5px]">
            <div className="font-medium text-foreground">{tryResult.text}</div>
            {tryResult.corrections.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {tryResult.corrections.map((c, idx) => (
                  <Badge key={idx} variant="soft" tone="accent" className="text-[11px]">
                    {c.from} → {c.to}
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
