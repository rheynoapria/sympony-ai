import { useEffect, useState } from "react";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { t } from "@/lib/i18n";
import { Markdown } from "./Markdown";
import { canSaveSkill, validateSkillDescription, validateSkillName } from "./skill-validation";

export interface SkillDraft {
  name: string;
  description: string;
  body: string;
  /** Frontmatter keys other than name/description (license, metadata…): kept as they are, not edited here. */
  extra: Record<string, unknown>;
  renameFrom?: string;
}

/** SKILL.md as a form, inline in the skills pane: name (the folder), description, and the instructions. */
export function SkillForm({
  initial,
  isNew,
  onSave,
  onCancel,
}: {
  initial: SkillDraft;
  isNew: boolean;
  onSave: (draft: SkillDraft) => Promise<string | null>;
  onCancel?: () => void;
}) {
  const [name, setName] = useState(initial.name);
  const [description, setDescription] = useState(initial.description);
  const [body, setBody] = useState(initial.body);
  const [tab, setTab] = useState<"edit" | "preview">("edit");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  // another skill picked in the tree: start over from its file
  useEffect(() => {
    setName(initial.name);
    setDescription(initial.description);
    setBody(initial.body);
    setErr(null);
    setSaved(false);
  }, [initial]);

  const trimmed = name.trim();
  const nameErr = validateSkillName(trimmed);
  const descErr = validateSkillDescription(description);
  const valid = canSaveSkill({ name: trimmed, description });
  const dirty = isNew || trimmed !== initial.name || description !== initial.description || body !== initial.body;

  const save = async () => {
    if (!valid || saving) return;
    setSaving(true);
    setErr(null);
    const e = await onSave({
      name: trimmed,
      description: description.trim(),
      body,
      extra: initial.extra,
      renameFrom: initial.renameFrom,
    });
    setSaving(false);
    if (e) setErr(e);
    else setSaved(true);
  };

  const input =
    "w-full rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

  return (
    <div className="flex flex-col gap-3" data-testid="skill-form">
      <div className="flex flex-col gap-1">
        <label htmlFor="skill-name" className="text-[12px] font-medium text-foreground">
          {t("Skill name")}
        </label>
        <input
          id="skill-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            setSaved(false);
          }}
          placeholder="plan-my-day"
          spellCheck={false}
          className={`${input} h-8 font-mono text-[12.5px]`}
        />
        {name !== "" && nameErr && (
          <p className="text-[11.5px] text-destructive" data-testid="skill-name-error">
            {t(nameErr)}
          </p>
        )}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <label htmlFor="skill-desc" className="text-[12px] font-medium text-foreground">
            {t("Description")}
          </label>
          <span className="text-[11px] tabular-nums text-muted-foreground">{[...description].length} / 1024</span>
        </div>
        <textarea
          id="skill-desc"
          rows={2}
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setSaved(false);
          }}
          placeholder={t("When Pony should use this skill and what it does")}
          className={`${input} resize-none py-1.5 text-[12.5px]`}
        />
        {description !== "" && descErr && <p className="text-[11.5px] text-destructive">{t(descErr)}</p>}
      </div>

      <div className="flex flex-col gap-1">
        <div className="flex items-center justify-between">
          <span className="text-[12px] font-medium text-foreground">{t("Instructions")}</span>
          <SegmentedControl
            size="sm"
            aria-label={t("Editor mode")}
            value={tab}
            onValueChange={(v) => setTab(v as "edit" | "preview")}
            options={[
              { value: "edit", label: t("Edit") },
              { value: "preview", label: t("Preview") },
            ]}
          />
        </div>
        {tab === "edit" ? (
          <textarea
            id="skill-body"
            value={body}
            onChange={(e) => {
              setBody(e.target.value);
              setSaved(false);
            }}
            placeholder={t("Write step-by-step instructions in Markdown…")}
            spellCheck={false}
            className={`${input} h-[220px] resize-y py-2 font-mono text-[12px] leading-relaxed`}
          />
        ) : (
          <div className="h-[220px] overflow-auto rounded-[var(--control-radius)] border border-border px-4 py-3">
            {body.trim() ? <Markdown source={body} /> : <p className="text-[12px] text-muted-foreground">{t("No instructions yet.")}</p>}
          </div>
        )}
      </div>

      {err && (
        <p className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">
          {err}
        </p>
      )}

      <div className="flex items-center justify-end gap-2">
        {saved && <span className="me-auto text-[11.5px] text-emerald-600 dark:text-emerald-400">{t("Saved")}</span>}
        {onCancel && (
          <Button size="sm" variant="secondary" onClick={onCancel}>
            {t("Cancel")}
          </Button>
        )}
        <Button
          size="sm"
          variant="primary"
          disabled={!valid || saving || !dirty}
          onClick={() => void save()}
          data-testid="skill-save-btn"
        >
          {isNew ? t("Create skill") : t("Save")}
        </Button>
      </div>
    </div>
  );
}
