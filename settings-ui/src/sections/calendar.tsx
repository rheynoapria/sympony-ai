import type { SectionBody } from "@/rows/types";
import { CALENDAR_ROWS } from "./features.rows";
import { CalendarFeedsPart } from "./parts/CalendarFeeds";
import { LocalEventsPart } from "./parts/LocalEventsPart";

export const calendar: SectionBody = {
  id: "calendar",
  rows: [...CALENDAR_ROWS],
  customs: {
    icsFeeds: CalendarFeedsPart,
    localEvents: LocalEventsPart,
  },
};
