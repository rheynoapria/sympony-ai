import type { SectionBody } from "@/rows/types";
import { POMODORO_ROWS } from "./features.rows";
import { TimerPresetsPart } from "./parts/TimerPresets";

export const pomodoro: SectionBody = {
  id: "pomodoro",
  rows: [...POMODORO_ROWS],
  customs: { timerPresets: TimerPresetsPart },
};
