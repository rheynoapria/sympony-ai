import type { CustomPartProps, SectionBody } from "@/rows/types";
import { CustomModulesStudio, useCustomModules } from "./parts/CustomModules";

function CustomModulesSection(_props: CustomPartProps) {
  const { items, templates, refresh } = useCustomModules();
  return <CustomModulesStudio items={items} templates={templates} onChanged={refresh} />;
}

export const custommodules: SectionBody = {
  id: "custommodules",
  render: CustomModulesSection,
};
