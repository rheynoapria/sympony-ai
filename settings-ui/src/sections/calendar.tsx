import { Rows } from "@/rows/Rows";
import type { SectionBody } from "@/rows/types";
import { CALENDAR_ROWS } from "./features.rows";
import { CalendarFeedsPart } from "./parts/CalendarFeeds";
import { GoogleCalendarPart } from "./parts/GoogleCalendar";
import { LocalEventsPart } from "./parts/LocalEventsPart";
import { ModuleStyleCard } from "./parts/ModuleStyleCard";

const CUSTOMS = {
  googleCalendar: GoogleCalendarPart,
  icsFeeds: CalendarFeedsPart,
  localEvents: LocalEventsPart,
};

export const calendar: SectionBody = {
  id: "calendar",
  rows: [...CALENDAR_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <div className="flex flex-col gap-4">
      <ModuleStyleCard moduleId="calendar" settings={props.settings} set={props.set} />
      <Rows
        sectionId="calendar"
        rows={CALENDAR_ROWS}
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
