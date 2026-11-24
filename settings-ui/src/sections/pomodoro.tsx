import { Rows } from "@/rows/Rows";
import type { SectionBody } from "@/rows/types";
import { POMODORO_ROWS } from "./features.rows";
import { ModuleStyleCard } from "./parts/ModuleStyleCard";
import { TimerPresetsPart } from "./parts/TimerPresets";

const CUSTOMS = { timerPresets: TimerPresetsPart };

export const pomodoro: SectionBody = {
  id: "pomodoro",
  rows: [...POMODORO_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <div className="flex flex-col gap-4">
      <ModuleStyleCard moduleId="pomodoro" settings={props.settings} set={props.set} />
      <Rows
        sectionId="pomodoro"
        rows={POMODORO_ROWS}
        customs={CUSTOMS}
        settings={props.settings}
        set={props.set}
        os={props.os}
        part={props.part}
        onNavigate={props.onNavigate}
      />
    </div>
  ),
};
