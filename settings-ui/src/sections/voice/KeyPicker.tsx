import { t } from "@/lib/i18n";

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

export function KeyPicker({
  value,
  mode,
  onChange,
}: {
  value: string;
  mode: "dictate" | "command";
  onChange: (next: string) => void;
}) {
  const options = mode === "command" ? COMMAND_KEYS : DICTATE_KEYS;
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
