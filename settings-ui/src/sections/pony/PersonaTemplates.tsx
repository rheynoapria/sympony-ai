import { useState } from "react";
import { Briefcase, Code2, GraduationCap, PenLine, Smile, Target, Undo2 } from "@/components/icons";
import { t } from "@/lib/i18n";
import { cn } from "@/lib/knowns/utils";

/** Ready personas for people who don't know what to write: a style and its instructions, in the UI's language. */
export const PERSONA_TEMPLATES = [
  {
    id: "work",
    icon: Briefcase,
    title: "Work assistant",
    sub: "Polite, short, ready-to-send drafts",
    style: "focused",
    text: "Use polite, standard language and address me formally.\nKeep answers short and to the point; use bullet points for steps or lists.\nWhen I ask for a draft (email, message, report), write it ready to send.\nAt the end of a plan, tell me the next step to take.",
  },
  {
    id: "friend",
    icon: Smile,
    title: "Casual friend",
    sub: "Relaxed chat, light jokes, cheers you on",
    style: "playful",
    text: "Talk casually, like a close friend.\nLight jokes and an emoji now and then are fine, but don't overdo it.\nKeep it short unless I ask for detail.\nCheer me on when I finish something.",
  },
  {
    id: "teacher",
    icon: GraduationCap,
    title: "Patient teacher",
    sub: "Step by step, simple words, examples",
    style: "friendly",
    text: "Explain things step by step in simple words, as if I'm new to the topic.\nGive one short, everyday example.\nEnd with a short question to check I understood.\nAvoid jargon; when a technical term is needed, explain it in one sentence.",
  },
  {
    id: "coach",
    icon: Target,
    title: "Focus coach",
    sub: "Top 3 tasks, Pomodoro, gentle nudges",
    style: "friendly",
    text: "Help me stay focused and finish what matters today.\nWhen I share many tasks, help me pick the top 3.\nSuggest a Pomodoro or a break when I've been working for long.\nRemind me gently, never nag.",
  },
  {
    id: "writer",
    icon: PenLine,
    title: "Writing partner",
    sub: "Captions, posts, emails, natural language",
    style: "friendly",
    text: "Help me write captions, posts, emails and stories.\nMatch the tone I ask for; when I don't say, offer 2 short options.\nUse natural, everyday language, not stiff translations.\nFix spelling and grammar when I ask you to check a text.",
  },
  {
    id: "dev",
    icon: Code2,
    title: "Developer buddy",
    sub: "Technical, precise, code blocks",
    style: "focused",
    text: "I'm a programmer: answer technically and precisely.\nShow code in code blocks, only the parts that change.\nKeep technical terms in English.\nPoint out risks (security, performance) briefly when they matter.",
  },
] as const;

/** The template cards: one click sets the style and the instructions; Undo brings back what was there. */
export function PersonaTemplates({
  persona,
  text,
  onApply,
}: {
  persona: string;
  text: string;
  onApply: (style: string, text: string) => void;
}) {
  const [undo, setUndo] = useState<{ style: string; text: string } | null>(null);
  return (
    <div className="flex flex-col gap-2" data-testid="persona-templates">
      <div className="flex items-baseline justify-between gap-3">
        <span className="text-[13px] font-medium text-foreground">{t("Start from a template")}</span>
        {undo ? (
          <button
            type="button"
            onClick={() => {
              onApply(undo.style, undo.text);
              setUndo(null);
            }}
            className="flex cursor-pointer items-center gap-1 text-[12px] text-primary hover:underline"
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            {t("Undo")}
          </button>
        ) : (
          <span className="text-[11.5px] text-muted-foreground">{t("One click fills the style and the instructions; you can still change them")}</span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {PERSONA_TEMPLATES.map((tp) => {
          const body = t(tp.text);
          const on = text.trim() === body;
          const Icon = tp.icon;
          return (
            <button
              key={tp.id}
              type="button"
              aria-pressed={on}
              data-testid={`persona-tpl-${tp.id}`}
              onClick={() => {
                if (on) return;
                setUndo({ style: persona, text });
                onApply(tp.style, body);
              }}
              className={cn(
                "flex cursor-pointer items-start gap-2.5 rounded-[10px] border p-2.5 text-start outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/40",
                on ? "border-primary bg-primary/[0.06] ring-1 ring-primary/30" : "border-border hover:bg-muted/40"
              )}
            >
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-[8px]", on ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                <Icon className="size-3.5" aria-hidden="true" />
              </span>
              <span className="min-w-0">
                <span className="block text-[12.5px] font-semibold text-foreground">{t(tp.title)}</span>
                <span className="mt-0.5 block text-[11.5px] leading-snug text-muted-foreground">{t(tp.sub)}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
