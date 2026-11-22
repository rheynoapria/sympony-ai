export interface UserTerm {
  text: string;
  prompt: boolean;
}

export interface Replacement {
  from: string;
  to: string;
}

export interface UserDict {
  version: number;
  terms: UserTerm[];
  replacements: Replacement[];
}

export interface ImportPreview {
  addedTerms: number;
  addedReplacements: number;
  skipped: number;
}

export const PROMPT_CAP = 150;
export const CORE_PROMPT_COUNT = 50;
export const MAX_DICT_ENTRIES = 5000;

function parseCsvRow(line: string): string[] {
  const cols: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"' && cur.length === 0) {
      inQuotes = true;
    } else if (ch === ",") {
      cols.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  cols.push(cur);
  return cols;
}

export function previewImport(
  dict: UserDict,
  kind: "csv" | "txt",
  text: string
): ImportPreview {
  const seenTerms = new Set(dict.terms.map((x) => x.text.trim().toLowerCase()));
  const seenReps = new Set(dict.replacements.map((x) => x.from.trim().toLowerCase()));
  let addedTerms = 0;
  let addedReplacements = 0;
  let skipped = 0;

  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const trimmed = lines[i].trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    if (kind === "txt") {
      const low = trimmed.toLowerCase();
      if (seenTerms.has(low) || seenTerms.size >= MAX_DICT_ENTRIES) {
        skipped++;
      } else {
        seenTerms.add(low);
        addedTerms++;
      }
      continue;
    }
    const cols = parseCsvRow(trimmed);
    const colKind = (cols[0] ?? "").trim().toLowerCase();
    if (i === 0 && colKind === "type") continue;
    const colText = (cols[1] ?? "").trim();
    const colTo = (cols[2] ?? "").trim();

    if (colKind === "term") {
      const low = colText.toLowerCase();
      if (!colText || seenTerms.has(low) || seenTerms.size >= MAX_DICT_ENTRIES) {
        skipped++;
      } else {
        seenTerms.add(low);
        addedTerms++;
      }
    } else if (colKind === "replacement") {
      const low = colText.toLowerCase();
      if (!colText || !colTo || seenReps.has(low) || seenReps.size >= MAX_DICT_ENTRIES) {
        skipped++;
      } else {
        seenReps.add(low);
        addedReplacements++;
      }
    } else {
      skipped++;
    }
  }

  return { addedTerms, addedReplacements, skipped };
}

export function promptSlotsUsed(terms: readonly UserTerm[], jargon: boolean): number {
  const seen = new Set<string>();
  for (const item of terms) {
    if (!item.prompt) continue;
    const low = item.text.trim().toLowerCase();
    if (low) seen.add(low);
  }
  const total = seen.size + (jargon ? CORE_PROMPT_COUNT : 0);
  return Math.min(PROMPT_CAP, total);
}
