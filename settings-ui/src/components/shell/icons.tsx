import { BrandIcon } from "@/components/icons";

/** A section's icon in the sidebar and its page header: Fluent Color (or its filled glyph in colour). */
export function SectionIcon({ name, className = "size-4" }: { name: string; className?: string }) {
  return <BrandIcon name={name} className={className} />;
}
