import { useCallback, useEffect, useState } from "react";
import { Check, FolderOpen, Pencil, Trash2, X } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";

export interface MemoryFact {
  id: string;
  text: string;
  added: number;
  learned?: boolean;
}

export function MemoryList() {
  const [facts, setFacts] = useState<MemoryFact[]>([]);
  const [loading, setLoading] = useState(true);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editText, setEditText] = useState("");
  const [confirmAll, setConfirmAll] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await notch.svc("pony", "memory").catch(() => []);
    setFacts(Array.isArray(res) ? (res as MemoryFact[]) : []);
    setLoading(false);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const saveEdit = async (id: string) => {
    const trimmed = editText.trim();
    if (!trimmed) return;
    await notch.svc("pony", "editFact", id, trimmed).catch(() => null);
    setEditingId(null);
    await load();
  };

  const removeOne = async (id: string) => {
    await notch.svc("pony", "forget", id).catch(() => null);
    await load();
  };

  const removeAll = async () => {
    setConfirmAll(false);
    await notch.svc("pony", "forget", "all").catch(() => null);
    await load();
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-[12px] tabular-nums text-muted-foreground">
          {t("{n} of 100", { n: facts.length })}
        </span>
        <div className="flex items-center gap-1.5">
          <Button
            size="xs"
            variant="secondary"
            icon={<FolderOpen />}
            onClick={() => void notch.svc("pony", "openHome")}
          >
            {t("Open ~/.sympony")}
          </Button>
          {facts.length > 0 &&
            (confirmAll ? (
              <>
                <Button
                  size="xs"
                  variant="destructive"
                  onClick={() => void removeAll()}
                  data-testid="memory-confirm-forget-all"
                >
                  {t("Forget everything")}
                </Button>
                <Button
                  size="xs"
                  variant="secondary"
                  onClick={() => setConfirmAll(false)}
                >
                  {t("Cancel")}
                </Button>
              </>
            ) : (
              <Button
                size="xs"
                variant="secondary"
                icon={<Trash2 />}
                onClick={() => setConfirmAll(true)}
                data-testid="memory-forget-all"
              >
                {t("Forget everything")}
              </Button>
            ))}
        </div>
      </div>

      {facts.length >= 100 && (
        <p className="text-[12px] text-amber-600 dark:text-amber-400" data-testid="memory-full-note">
          {t("Memory is full (100 facts). Saving a new fact drops the oldest one.")}
        </p>
      )}

      {loading ? (
        <p className="text-[12.5px] text-muted-foreground">{t("Loading memory…")}</p>
      ) : facts.length === 0 ? (
        <p className="text-[12.5px] text-muted-foreground">
          {t("Nothing remembered yet. Tell Pony “remember …” in chat.")}
        </p>
      ) : (
        <div className="divide-y divide-border/80">
          {facts.map((f) => (
            <div
              key={f.id}
              data-fact-row={f.id}
              className="flex items-center gap-2 py-2 first:pt-0 last:pb-0"
            >
              {editingId === f.id ? (
                <>
                  <input
                    type="text"
                    value={editText}
                    maxLength={300}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void saveEdit(f.id);
                      else if (e.key === "Escape") setEditingId(null);
                    }}
                    className="h-8 flex-1 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[12.5px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
                    data-fact-input={f.id}
                  />
                  <Button
                    size="xs"
                    variant="primary"
                    icon={<Check />}
                    aria-label={t("Save")}
                    onClick={() => void saveEdit(f.id)}
                    data-fact-save={f.id}
                  />
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={<X />}
                    aria-label={t("Cancel")}
                    onClick={() => setEditingId(null)}
                  />
                </>
              ) : (
                <>
                  <span className="min-w-0 flex-1 text-[12.5px] leading-snug text-foreground">
                    {f.text}
                    {f.learned && (
                      <span
                        className="ml-1.5 inline-flex translate-y-[-1px] items-center rounded-full bg-violet-500/12 px-1.5 py-px align-middle text-[10.5px] font-medium text-violet-600 dark:text-violet-300"
                        title={t("Pony learned this from a chat")}
                      >
                        {t("Learned")}
                      </span>
                    )}
                  </span>
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={<Pencil />}
                    title={t("Edit")}
                    aria-label={t("Edit")}
                    onClick={() => {
                      setEditingId(f.id);
                      setEditText(f.text);
                    }}
                    data-fact-edit={f.id}
                  />
                  <Button
                    size="xs"
                    variant="secondary"
                    icon={<Trash2 />}
                    title={t("Forget")}
                    aria-label={t("Forget")}
                    onClick={() => void removeOne(f.id)}
                    data-fact-delete={f.id}
                  />
                </>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
