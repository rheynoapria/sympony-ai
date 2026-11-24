import { t } from "@/lib/i18n";
import type { OS } from "../registry";

const DICTATE_KEYS: readonly [string, string][] = [
  ["right_option", "Right ⌥ (Option)"],
  ["left_option", "Left ⌥ (Option)"],
  ["right_command", "Right ⌘ (Command)"],
  ["right_control", "Right ⌃ (Control)"],
  ["right_shift", "Right ⇧ (Shift)"],
  ["fn", "Fn (Globe)"],
];

const COMMAND_KEYS: readonly [string, string][] = [
  ["", "Off"],
  ["right_option+right_shift", "Right ⌥ + Right ⇧"],
  ["right_command", "Right ⌘ (Command)"],
  ["right_control", "Right ⌃ (Control)"],
];

// Windows: the same keys under their names there (the setting keeps macOS's names)
const WIN_DICTATE_KEYS: readonly [string, string][] = [
  ["right_control", "Right Ctrl"],
  ["right_option", "Right Alt"],
  ["left_option", "Left Alt"],
  ["right_shift", "Right Shift"],
  ["right_command", "Right Windows key"],
];

const WIN_COMMAND_KEYS: readonly [string, string][] = [
  ["", "Off"],
  ["right_option+right_shift", "Right Alt + Right Shift"],
  ["right_command", "Right Windows key"],
  ["right_control", "Right Ctrl"],
];

export function keyOptions(mode: "dictate" | "command", os: OS): readonly [string, string][] {
  const win = os === "windows";
  return mode === "command" ? (win ? WIN_COMMAND_KEYS : COMMAND_KEYS) : win ? WIN_DICTATE_KEYS : DICTATE_KEYS;
}

export function KeyPicker({
  value,
  mode,
  os,
  onChange,
}: {
  value: string;
  mode: "dictate" | "command";
  os: OS;
  onChange: (next: string) => void;
}) {
  const options = keyOptions(mode, os);
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      className="h-8 rounded-md border border-input bg-background px-2.5 text-[12.5px] text-foreground focus:outline-none focus:ring-2 focus:ring-ring"
    >
      {options.map(([val, label]) => (
        <option key={val || "off"} value={val}>
          {t(label)}
        </option>
      ))}
    </select>
  );
}
