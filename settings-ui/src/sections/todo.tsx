import type { SectionBody } from "@/rows/types";
import { TODO_ROWS } from "./features.rows";
import { TodoSyncPart } from "./parts/TodoSync";

export const todo: SectionBody = {
  id: "todo",
  rows: [...TODO_ROWS],
  customs: { todoSync: TodoSyncPart },
};
