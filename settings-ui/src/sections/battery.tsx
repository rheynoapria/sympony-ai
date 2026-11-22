import type { SectionBody } from "@/rows/types";
import { BatteryInfoPart } from "./parts/BatteryInfo";
import { BATTERY_ROWS } from "./system.rows";

export const battery: SectionBody = {
  id: "battery",
  rows: [...BATTERY_ROWS],
  customs: { batteryInfo: BatteryInfoPart },
};
