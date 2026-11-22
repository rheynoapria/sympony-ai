import { SecretField } from "@/components/shell/SecretField";
import { SettingsRow } from "@/components/ui/knowns/blocks/settings/settings-layout";
import { t } from "@/lib/i18n";
import type { CustomPartProps } from "@/rows/types";
import { keptHow } from "./logic";

export function GithubTokenPart({ settings, os }: CustomPartProps) {
  const hasToken = Boolean(settings.has_githubToken);

  return (
    <SettingsRow
      label={t("Personal access token")}
      description={
        hasToken ? (
          <>
            <span className="font-medium text-emerald-600 dark:text-emerald-400">
              ● {t("Saved")}
            </span>{" "}
            {keptHow(os)}
          </>
        ) : (
          t(
            "github.com → Settings → Developer settings → Fine-grained tokens. Read-only access to Pull requests is enough."
          )
        )
      }
    >
      <SecretField
        secretKey="githubToken"
        hasValue={hasToken}
        placeholder="github_pat_…"
        ariaLabel={t("Personal access token")}
      />
    </SettingsRow>
  );
}
