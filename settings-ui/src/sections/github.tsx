import type { SectionBody } from "@/rows/types";
import { GITHUB_ROWS } from "./core.rows";
import { GithubTokenPart } from "./parts/GithubToken";

export const github: SectionBody = {
  id: "github",
  rows: [...GITHUB_ROWS],
  customs: { githubToken: GithubTokenPart },
};
