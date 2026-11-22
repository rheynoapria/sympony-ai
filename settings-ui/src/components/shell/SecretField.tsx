import { useState } from "react";
import { Trash2 } from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";

export interface SecretFieldProps {
  secretKey: string;
  hasValue: boolean;
  placeholder?: string;
  ariaLabel?: string;
}

/**
 * Password/token field matching settings.js `bindSecret`:
 * saves immediately on blur, Enter, or Save via notch.setSecret and never displays the secret value back.
 */
export function SecretField({
  secretKey,
  hasValue,
  placeholder = "",
  ariaLabel,
}: SecretFieldProps) {
  const [draft, setDraft] = useState("");
  const [justSaved, setJustSaved] = useState(false);

  const save = () => {
    const v = draft.trim();
    if (!v) return;
    setDraft("");
    setJustSaved(true);
    void notch.setSecret(secretKey, v);
  };

  return (
    <div className="flex items-center gap-2" data-secret={secretKey}>
      <input
        type="password"
        value={draft}
        aria-label={ariaLabel || secretKey}
        placeholder={
          justSaved
            ? `•••••••••••• ${t("(saved)")}`
            : hasValue
              ? "••••••••••••"
              : placeholder
        }
        onChange={(e) => {
          setJustSaved(false);
          setDraft(e.target.value);
        }}
        onBlur={save}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            save();
            (e.target as HTMLInputElement).blur();
          }
        }}
        className="h-8 w-44 rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[13px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25"
      />
      <Button size="sm" variant="secondary" onClick={save}>
        {t("Save")}
      </Button>
      {hasValue && (
        <Button
          size="sm"
          variant="destructive"
          icon={<Trash2 />}
          aria-label={t("Remove")}
          title={t("Remove")}
          onClick={() => {
            setJustSaved(false);
            void notch.setSecret(secretKey, "");
          }}
        />
      )}
    </div>
  );
}
