import { t } from "@/lib/i18n";
import { PanelCard } from "./PanelCard";

export function Placeholder() {
  return (
    <PanelCard>
      <p className="text-[13px] leading-relaxed text-muted-foreground">
        {t(
          "This section moves to the new Settings soon. Use the classic Settings for now."
        )}
      </p>
    </PanelCard>
  );
}
