import type { Row } from "../rows/types.ts";

export const AI_KEYS = [
  "chatAgent",
  "translateAgent",
  "agentModels",
  "ponyBrain",
  "brainUrl",
  "brainModel",
  "symponyModel",
  "symponyAccount",
  "symponyWeb",
  "chatWebSearch",
  "chatContext",
  "chatBriefs",
  "ponyName",
  "ponyPersona",
  "ponyPersonaText",
  "ponySkillsOff",
  "ponyFace",
  "ponyPeek",
  "ponyShape",
  "ponyColor",
] as const;

/** Search entries for Pony Assistant's tabs (the page itself is drawn by ai.tsx): a hit opens its tab. */
export const AI_ROWS: readonly Row[] = [
  { t: "custom", id: "brain", tab: "brain", label: "Brain", sub: "Where Pony thinks, and with which account", words: "otak model account akun sign in masuk quota kuota claude codex gemini server api key" },
  { t: "custom", id: "abilities", tab: "abilities", label: "Abilities", sub: "What Pony may use while it answers", words: "kemampuan web search cari internet commands files perintah file exec yolo terminal share my day context tools mcp eyes mata layar screen accessibility aksesibilitas baca jendela code mode kode ask other ai tanya ai lain chatgpt gemini claude browser profil profile" },
  { t: "custom", id: "persona", tab: "persona", label: "Persona", sub: "Pony’s name and how it talks to you", words: "nama name style gaya template instructions instruksi" },
  { t: "custom", id: "look", tab: "look", label: "Appearance", sub: "How Pony looks in the notch", words: "tampilan look eyes mata peek mengintip shape bentuk color warna" },
  { t: "custom", id: "skills", tab: "skills", label: "Skills", sub: "Instructions Pony follows for a kind of task", words: "skill import export folder SKILL.md" },
  { t: "custom", id: "memory", tab: "memory", label: "Memory", sub: "What Pony remembers about you between chats", words: "memori ingatan remember forget lupakan learn belajar facts fakta" },
  { t: "custom", id: "briefs", tab: "briefs", label: "Scheduled briefs", sub: "A message Pony answers by itself on the days you pick", words: "ringkasan terjadwal brief schedule jadwal pagi morning" },
];

export const AIUSAGE_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "How much of your Claude and Codex plan limits you’ve used, in a tab of its own: the 5-hour session and the week. Sympony reads them on this PC. For Claude it asks Anthropic with Claude Code’s own sign-in, as Claude Code’s /usage does; Codex’s come from its logs, offline. Nothing else is sent anywhere.",
  },
  {
    t: "custom",
    id: "claude",
    label: "Claude Code",
    sub: "Reads Claude Code’s sign-in on this PC",
  },
  {
    t: "custom",
    id: "codex",
    label: "Codex",
    sub: "Reads Codex CLI’s logs on this PC",
  },
  {
    t: "toggle",
    k: "aiUsageMark",
    label: "Show in the closed Sympony",
    sub: "A small ring at the left with the busiest 5-hour session: green, amber from 70 %, red from 90 %",
  },
  {
    t: "select",
    k: "aiUsageWarn",
    label: "Warn at",
    sub: "Once per 5-hour session, in the closed Sympony, with when it resets",
    options: [
      [0, "Off"],
      [80, "80 %"],
      [90, "90 %"],
      [95, "95 %"],
    ],
  },
];

export const INTEGRATIONS_ROWS: readonly Row[] = [
  {
    t: "lead",
    html: "When an AI agent needs a permission, has a question or is done, Sympony shows it under the closed notch and you answer there. Every connection to another app is set up here.",
  },
  { t: "custom", id: "overview" },
  { t: "h2", text: "Requests under the notch" },
  {
    t: "toggle",
    k: "claudeHooks",
    label: "Show the agents’ requests",
    sub: "Permissions, questions and “done” from the agents connected below",
  },
  {
    t: "toggle",
    k: "claudeAnswer",
    label: "Answer permissions from Sympony",
    sub: "Allow, Deny or pick an answer right in Sympony. Without a click within a minute, the agent asks in its own window as usual; Open does that at once and brings that window forward. A command too long to show whole can only be opened.",
  },
  {
    t: "toggle",
    k: "claudeDone",
    label: "Tell me when an agent is done",
    sub: "With the start of its last message and a soft sound",
  },
  { t: "h2", text: "Claude Code" },
  { t: "custom", id: "claudeHooksCtrl" },
  { t: "h2", text: "Paseo" },
  {
    t: "toggle",
    k: "paseoEnabled",
    label: "Show Paseo’s permission requests",
    sub: "The agents you run in Paseo (Claude Code, Antigravity, Codex…): Sympony asks Paseo’s app on this Mac every second, with the command or the question in full. Allow, Deny and your answers go back to Paseo; a plan opens Paseo.",
  },
  { t: "custom", id: "paseoState" },
];
