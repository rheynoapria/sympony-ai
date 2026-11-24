import { Rows } from "@/rows/Rows";
import type { SectionBody } from "@/rows/types";
import { FEED_ROWS } from "./feed.rows";
import { FeedCustomUrlsPart, FeedGoogleTopicsPart, FeedSourcesPart } from "./parts/FeedParts";
import { ModuleStyleCard } from "./parts/ModuleStyleCard";

const CUSTOMS = {
  feedSources: FeedSourcesPart,
  feedGoogleTopics: FeedGoogleTopicsPart,
  feedCustomUrls: FeedCustomUrlsPart,
};

export const feed: SectionBody = {
  id: "feed",
  rows: [...FEED_ROWS],
  customs: CUSTOMS,
  render: (props) => (
    <div className="flex flex-col gap-4">
      <ModuleStyleCard moduleId="feed" settings={props.settings} set={props.set} />
      <Rows
        sectionId="feed"
        rows={FEED_ROWS}
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
