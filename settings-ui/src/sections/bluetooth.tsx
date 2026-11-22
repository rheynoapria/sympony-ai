import type { SectionBody } from "@/rows/types";
import { BLUETOOTH_ROWS } from "./features.rows";
import { BtDevicesPart } from "./parts/BtDevices";

export const bluetooth: SectionBody = {
  id: "bluetooth",
  rows: [...BLUETOOTH_ROWS],
  customs: { btDevices: BtDevicesPart },
};
