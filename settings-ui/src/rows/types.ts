import type { ReactElement } from "react";
import type { Settings } from "../lib/mock.ts";
import type { OS } from "../sections/registry.ts";

export type Opt = [string | number, string];

export type FieldRow = {
  t: "toggle" | "range" | "select" | "text" | "time" | "number" | "list";
  k: string;
  label: string;
  sub?: string;
  min?: number;
  max?: number;
  step?: number;
  unit?: string;
  options?: Opt[] | ((s: Settings) => Opt[]);
  placeholder?: string;
  short?: boolean;
  spot?: string;
  words?: string;
  also?: [string, string][];
  unset?: string | number | boolean;
  /** Optional versioned key to display a dismissible "New" badge until seen */
  newKey?: string;
};

export type Row =
  | { t: "h2"; text: string }
  | { t: "lead"; html: string }
  | FieldRow
  | {
      t: "custom";
      id: string;
      label?: string;
      sub?: string;
      also?: [string, string][];
      words?: string;
      windowsOnly?: boolean;
      spot?: string;
      /** a search hit on it opens this part of its page (its `part`), e.g. Pony Assistant's tab */
      tab?: string;
      /** Optional versioned key to display a dismissible "New" badge until seen */
      newKey?: string;
    };

export interface CustomPartProps {
  settings: Settings;
  set: (patch: Settings) => Promise<unknown>;
  row?: Row;
  os: OS;
  part?: string | null;
  onNavigate?: (target: string) => void;
}

export type CustomPart = (p: CustomPartProps) => ReactElement | null;

export interface SectionBody {
  id: string;
  rows?: Row[];
  customs?: Record<string, CustomPart>;
  render?: CustomPart;
}
