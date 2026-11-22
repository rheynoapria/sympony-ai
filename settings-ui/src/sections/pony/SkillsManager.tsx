import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import {
  AlertTriangle,
  BookOpen,
  ChevronRight,
  Download,
  File,
  FileCode2,
  FileImage,
  FilePlus,
  FileText,
  Folder,
  FolderOpen,
  FolderPlus,
  Image,
  Plus,
  RotateCcw,
  Search,
  Sparkles,
  SquareTerminal,
  Trash2,
  Upload,
} from "@/components/icons";
import { Button } from "@/components/ui/knowns/button";
import { Switch } from "@/components/ui/knowns/switch";
import { Tooltip } from "@/components/ui/knowns/tooltip";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import type { CustomPartProps } from "@/rows/types";
import { Markdown } from "./Markdown";
import { SkillForm, type SkillDraft } from "./SkillForm";

export interface SkillSummary {
  name: string;
  description: string;
  enabled: boolean;
  problems: string[];
  hasScripts: boolean;
  bodyLines: number;
  extra: Record<string, unknown>;
}

/** One entry of a skill folder (`pony.tree`): `path` is relative to the skill folder. */
export interface TreeEntry {
  path: string;
  dir: boolean;
  size: number;
}

/** What the right pane shows: a new skill, a skill's SKILL.md, another file, or a folder inside a skill. */
type Sel =
  | { kind: "new" }
  | { kind: "skill"; skill: string }
  | { kind: "file"; skill: string; path: string }
  | { kind: "dir"; skill: string; path: string };

type Res = { ok?: boolean; error?: string; [k: string]: unknown } | null;
const call = (method: string, ...args: unknown[]) =>
  notch.svc("pony", method, ...args).catch((e) => ({ ok: false, error: String(e) })) as Promise<Res>;

const parentOf = (p: string) => (p.includes("/") ? p.slice(0, p.lastIndexOf("/")) : "");
const baseOf = (p: string) => p.slice(p.lastIndexOf("/") + 1);

/** The entries whose folders are all open (the tree is flat and ordered by `pony.tree`). */
export function visibleEntries(entries: TreeEntry[], open: Set<string>): TreeEntry[] {
  return entries.filter((e) => {
    let p = parentOf(e.path);
    while (p) {
      if (!open.has(p)) return false;
      p = parentOf(p);
    }
    return true;
  });
}

/** The icon and tint an entry gets: the Agent Skills folders each have a role colour. */
export function entryLook(path: string, dir: boolean, open = false): { icon: ReactNode; tint: string } {
  const top = path.split("/")[0];
  if (path === "SKILL.md") return { icon: <Sparkles />, tint: "text-primary" };
  if (dir && path === "references") return { icon: <BookOpen />, tint: "text-sky-500" };
  if (dir && path === "assets") return { icon: <Image />, tint: "text-violet-500" };
  if (dir && path === "scripts") return { icon: <SquareTerminal />, tint: "text-amber-500" };
  if (dir) return { icon: open ? <FolderOpen /> : <Folder />, tint: "text-muted-foreground" };
  const ext = path.slice(path.lastIndexOf(".") + 1).toLowerCase();
  const roleTint =
    top === "references" ? "text-sky-500/80" : top === "assets" ? "text-violet-500/80" : top === "scripts" ? "text-amber-500/80" : "text-muted-foreground";
  if (["md", "txt", "markdown"].includes(ext)) return { icon: <FileText />, tint: roleTint };
  if (["png", "jpg", "jpeg", "gif", "svg", "webp"].includes(ext)) return { icon: <FileImage />, tint: roleTint };
  if (["py", "sh", "js", "ts", "rb", "json", "yaml", "yml", "toml"].includes(ext)) return { icon: <FileCode2 />, tint: roleTint };
  return { icon: <File />, tint: roleTint };
}

const fmtSize = (n: number) => (n < 1024 ? `${n} B` : n < 1024 * 1024 ? `${(n / 1024).toFixed(1)} KB` : `${(n / 1048576).toFixed(1)} MB`);

export function SkillsManager({
  settings,
  set,
}: {
  settings: CustomPartProps["settings"];
  set: CustomPartProps["set"];
}) {
  const [skills, setSkills] = useState<SkillSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [query, setQuery] = useState("");
  const [openSkills, setOpenSkills] = useState<Set<string>>(new Set());
  const [openDirs, setOpenDirs] = useState<Record<string, Set<string>>>({});
  const [trees, setTrees] = useState<Record<string, TreeEntry[]>>({});
  const [sel, setSel] = useState<Sel | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [clash, setClash] = useState<{ name: string; path: string } | null>(null);

  const offList: string[] = Array.isArray(settings.ponySkillsOff) ? (settings.ponySkillsOff as string[]) : [];

  const load = useCallback(async () => {
    const res = await notch.svc("pony", "skills").catch(() => []);
    setSkills(Array.isArray(res) ? (res as SkillSummary[]) : []);
    setLoading(false);
  }, []);

  const loadTree = useCallback(async (skill: string) => {
    const r = await call("tree", skill);
    setTrees((m) => ({ ...m, [skill]: r && r.ok ? ((r.entries as TreeEntry[]) ?? []) : [] }));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const openSkill = (skill: string, open: boolean) => {
    if (open && !openSkills.has(skill)) void loadTree(skill);
    setOpenSkills((s) => {
      const n = new Set(s);
      if (open) n.add(skill);
      else n.delete(skill);
      return n;
    });
  };
  const setDirOpen = (skill: string, path: string, open?: boolean) =>
    setOpenDirs((m) => {
      const cur = new Set(m[skill] ?? []);
      if (open ?? !cur.has(path)) cur.add(path);
      else cur.delete(path);
      return { ...m, [skill]: cur };
    });

  const toggleEnabled = (name: string, on: boolean) =>
    void set({ ponySkillsOff: on ? offList.filter((x) => x !== name) : [...new Set([...offList, name])] });

  const refresh = async (skill?: string) => {
    await load();
    if (skill) await loadTree(skill);
  };

  const importSkill = async (path?: string, replace?: boolean) => {
    setNotice(null);
    const r = await call("importSkill", ...(path ? [path, replace] : []));
    if (!r || r.cancelled) return;
    if (r.clash && r.path) return setClash({ name: String(r.clash), path: String(r.path) });
    if (!r.ok) return setNotice(r.error || t("Import failed"));
    await load();
    if (r.name) {
      openSkill(String(r.name), true);
      setSel({ kind: "skill", skill: String(r.name) });
    }
  };

  const needle = query.trim().toLowerCase();
  const shown = needle
    ? skills.filter((s) => s.name.includes(needle) || s.description.toLowerCase().includes(needle))
    : skills;
  const onCount = skills.filter((s) => !offList.includes(s.name) && !s.problems?.length).length;

  const iconBtn = (label: string, icon: ReactNode, onClick: () => void, testid?: string) => (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        data-testid={testid}
        onClick={onClick}
        className="grid size-7 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-background hover:text-foreground [&_svg]:size-[15px]"
      >
        {icon}
      </button>
    </Tooltip>
  );

  return (
    <div className="flex flex-col gap-2.5" data-k="ponySkillsOff">
      {clash && (
        <div
          className="flex flex-wrap items-center justify-between gap-2 rounded-[10px] border border-amber-500/40 bg-amber-500/10 px-3 py-2 text-[12.5px]"
          data-testid="skill-clash-bar"
        >
          <span>{t("A skill named “{name}” already exists.", { name: clash.name })}</span>
          <div className="flex items-center gap-1.5">
            <Button size="xs" variant="secondary" onClick={() => { const c = clash; setClash(null); void importSkill(c.path, false); }} data-testid="skill-clash-keep-both">
              {t("Keep both")}
            </Button>
            <Button size="xs" variant="primary" onClick={() => { const c = clash; setClash(null); void importSkill(c.path, true); }} data-testid="skill-clash-replace">
              {t("Replace")}
            </Button>
            <Button size="xs" variant="ghost" onClick={() => setClash(null)}>
              {t("Cancel")}
            </Button>
          </div>
        </div>
      )}
      {notice && (
        <p className="rounded-md border border-destructive/35 bg-destructive/10 px-3 py-1.5 text-[12px] text-destructive">{notice}</p>
      )}

      <div className="grid h-[480px] grid-cols-[minmax(220px,250px)_minmax(0,1fr)] overflow-hidden rounded-[14px] border border-border bg-card">
        {/* the tree */}
        <div className="flex min-h-0 flex-col border-e border-border bg-muted/35">
          <div className="flex items-center gap-1 px-2.5 pt-2.5 pb-1.5">
            <div className="me-auto flex items-center gap-1.5 ps-1">
              <span className="text-[12.5px] font-semibold text-foreground">{t("Skills")}</span>
              <Tooltip content={t("{on} of {n} on", { on: onCount, n: skills.length })}>
                <span className="rounded-full bg-background px-1.5 py-px text-[10.5px] font-medium tabular-nums text-muted-foreground shadow-[0_0_0_1px_var(--border)]">
                  {onCount}/{skills.length}
                </span>
              </Tooltip>
            </div>
            {iconBtn(t("New skill"), <Plus />, () => setSel({ kind: "new" }), "skill-new-btn")}
            {iconBtn(t("Import"), <Upload />, () => void importSkill(), "skill-import-btn")}
            {iconBtn(t("Open folder"), <FolderOpen />, () => void notch.svc("pony", "openHome"))}
            {iconBtn(t("Restore built-ins"), <RotateCcw />, async () => {
              await call("restoreBuiltins");
              await load();
            })}
          </div>
          <div className="relative px-2.5 pb-2">
            <Search className="pointer-events-none absolute top-[14px] left-[18px] size-3.5 -translate-y-1/2 text-muted-foreground" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder={t("Search skills…")}
              aria-label={t("Search skills…")}
              className="h-7 w-full rounded-[8px] border border-border bg-background ps-7 pe-2 text-[12px] text-foreground outline-none placeholder:text-muted-foreground/70 focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto px-1.5 pb-2" role="tree" aria-label={t("Skills")}>
            {loading ? (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">{t("Loading skills…")}</p>
            ) : shown.length === 0 ? (
              <p className="px-2 py-2 text-[12px] text-muted-foreground">{t("No skills found.")}</p>
            ) : (
              shown.map((s) => {
                const isOpen = openSkills.has(s.name);
                const on = !offList.includes(s.name);
                const invalid = s.problems?.length > 0;
                const active = sel?.kind === "skill" && sel.skill === s.name;
                const dirs = openDirs[s.name] ?? new Set<string>();
                const entries = visibleEntries(trees[s.name] ?? [], dirs);
                return (
                  <div key={s.name} role="treeitem" aria-expanded={isOpen} aria-selected={active} data-skill-row={s.name} className="mb-0.5">
                    {/* the skill: a folder with its status and what it's for */}
                    <div
                      onClick={() => {
                        openSkill(s.name, true);
                        setSel({ kind: "skill", skill: s.name });
                      }}
                      className={`group relative flex cursor-pointer items-start gap-1.5 rounded-[9px] py-1.5 pe-2 ps-1 select-none ${
                        active ? "bg-background shadow-[0_0_0_1px_var(--border)]" : "hover:bg-background/60"
                      }`}
                    >
                      <button
                        type="button"
                        aria-label={isOpen ? t("Collapse") : t("Expand")}
                        onClick={(e) => {
                          e.stopPropagation();
                          openSkill(s.name, !isOpen);
                        }}
                        className="mt-1.5 grid size-4 shrink-0 place-items-center text-muted-foreground"
                      >
                        <ChevronRight className={`size-3.5 transition-transform duration-150 ${isOpen ? "rotate-90" : ""}`} />
                      </button>
                      <span className="relative mt-0.5 grid size-6 shrink-0 place-items-center rounded-[7px] bg-background text-muted-foreground shadow-[0_0_0_1px_var(--border)] [&_svg]:size-3.5">
                        {isOpen ? <FolderOpen /> : <Folder />}
                        <span
                          aria-hidden
                          className={`absolute -right-0.5 -bottom-0.5 size-2 rounded-full ring-2 ring-[color:var(--muted)] ${
                            invalid ? "bg-destructive" : on ? "bg-emerald-500" : "bg-muted-foreground/50"
                          }`}
                        />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className={`block truncate font-mono text-[12.5px] font-medium ${on && !invalid ? "text-foreground" : "text-muted-foreground"}`}>
                          {s.name}
                        </span>
                        <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                          {invalid ? t(s.problems[0]) : s.description}
                        </span>
                      </span>
                      {invalid && <AlertTriangle className="mt-1 size-3.5 shrink-0 text-destructive" aria-label={t("Invalid")} />}
                    </div>
                    {isOpen && (
                      <div className="relative ms-[13px] mt-0.5 border-s border-border/80 ps-1">
                        {entries.map((e) => {
                          const depth = e.path.split("/").length - 1;
                          const dirOpen = dirs.has(e.path);
                          const isSkillMd = e.path === "SKILL.md";
                          const isActive =
                            (isSkillMd && active) ||
                            ((sel?.kind === "file" || sel?.kind === "dir") && sel.skill === s.name && sel.path === e.path);
                          const look = entryLook(e.path, e.dir, dirOpen);
                          return (
                            <div
                              key={e.path}
                              onClick={() => {
                                if (isSkillMd) setSel({ kind: "skill", skill: s.name });
                                else if (e.dir) {
                                  setDirOpen(s.name, e.path);
                                  setSel({ kind: "dir", skill: s.name, path: e.path });
                                } else setSel({ kind: "file", skill: s.name, path: e.path });
                              }}
                              className={`relative flex h-[26px] cursor-pointer items-center gap-1.5 rounded-[7px] pe-2 text-[12px] select-none ${
                                isActive ? "bg-[color-mix(in_srgb,var(--primary)_11%,transparent)] text-foreground" : "text-foreground/85 hover:bg-background/60"
                              }`}
                              style={{ paddingInlineStart: 4 + depth * 14 }}
                            >
                              {/* indent guides for nested levels */}
                              {Array.from({ length: depth }, (_, i) => (
                                <span key={i} aria-hidden className="absolute top-0 bottom-0 border-s border-border/60" style={{ insetInlineStart: 11 + i * 14 }} />
                              ))}
                              {e.dir ? (
                                <ChevronRight className={`size-3 shrink-0 text-muted-foreground transition-transform duration-150 ${dirOpen ? "rotate-90" : ""}`} />
                              ) : (
                                <span className="w-3 shrink-0" />
                              )}
                              <span className={`shrink-0 [&_svg]:size-3.5 ${look.tint}`}>{look.icon}</span>
                              <span className={`min-w-0 flex-1 truncate font-mono text-[11.5px] ${isSkillMd ? "font-semibold" : ""}`}>{baseOf(e.path)}</span>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* the pane */}
        <div className="flex min-h-0 flex-col overflow-y-auto px-5 py-4">
          {!sel ? (
            <div className="m-auto flex max-w-[300px] flex-col items-center gap-3 text-center">
              <span className="grid size-11 place-items-center rounded-[12px] bg-muted text-primary [&_svg]:size-5">
                <Sparkles />
              </span>
              <div>
                <div className="text-[13.5px] font-semibold text-foreground">{t("Teach Pony a skill")}</div>
                <p className="mt-1 text-[12px] leading-relaxed text-muted-foreground">
                  {t("A skill is a folder: SKILL.md says when to use it and what to do, references/ and assets/ hold what it needs.")}
                </p>
              </div>
              <Button size="sm" variant="primary" icon={<Plus />} onClick={() => setSel({ kind: "new" })}>
                {t("New skill")}
              </Button>
            </div>
          ) : sel.kind === "new" ? (
            <NewSkillPane
              onCreated={async (name) => {
                await load();
                openSkill(name, true);
                setSel({ kind: "skill", skill: name });
              }}
              onCancel={() => setSel(null)}
            />
          ) : sel.kind === "skill" ? (
            <SkillPane
              key={sel.skill}
              summary={skills.find((x) => x.name === sel.skill)}
              files={(trees[sel.skill] ?? []).filter((e) => !e.dir).length}
              skill={sel.skill}
              enabled={!offList.includes(sel.skill)}
              onToggle={(on) => toggleEnabled(sel.skill, on)}
              onSaved={async (name, from) => {
                if (from && from !== name) {
                  if (offList.includes(from)) void set({ ponySkillsOff: offList.map((x) => (x === from ? name : x)) });
                  setOpenSkills((o) => { const n = new Set(o); n.delete(from); n.add(name); return n; });
                }
                await refresh(name);
                setSel({ kind: "skill", skill: name });
              }}
              onAdded={(path) => void refresh(sel.skill).then(() => path && setSel({ kind: "file", skill: sel.skill, path }))}
              onDeleted={async () => {
                if (offList.includes(sel.skill)) void set({ ponySkillsOff: offList.filter((x) => x !== sel.skill) });
                setSel(null);
                await load();
              }}
              setNotice={setNotice}
            />
          ) : sel.kind === "dir" ? (
            <DirPane
              key={`${sel.skill}/${sel.path}`}
              skill={sel.skill}
              path={sel.path}
              items={(trees[sel.skill] ?? []).filter((e) => parentOf(e.path) === sel.path)}
              onOpen={(e) => {
                if (e.dir) {
                  setDirOpen(sel.skill, e.path, true);
                  setSel({ kind: "dir", skill: sel.skill, path: e.path });
                } else setSel({ kind: "file", skill: sel.skill, path: e.path });
              }}
              onAdded={(path) => {
                setDirOpen(sel.skill, sel.path, true);
                void refresh(sel.skill).then(() => path && setSel({ kind: "file", skill: sel.skill, path }));
              }}
              onDeleted={() => {
                setSel({ kind: "skill", skill: sel.skill });
                void refresh(sel.skill);
              }}
              setNotice={setNotice}
            />
          ) : (
            <FilePane
              key={`${sel.skill}/${sel.path}`}
              skill={sel.skill}
              path={sel.path}
              size={(trees[sel.skill] ?? []).find((e) => e.path === sel.path)?.size ?? 0}
              onDeleted={() => {
                setSel({ kind: "skill", skill: sel.skill });
                void refresh(sel.skill);
              }}
              setNotice={setNotice}
            />
          )}
        </div>
      </div>
    </div>
  );
}

/** `plan-my-day / references / notes.md`, the last part in full colour. */
function Crumbs({ skill, path }: { skill: string; path?: string }) {
  const parts = [skill, ...(path ? path.split("/") : [])];
  return (
    <div className="flex min-w-0 items-center gap-1 font-mono text-[12.5px]">
      {parts.map((p, i) => (
        <span key={i} className="flex min-w-0 items-center gap-1">
          {i > 0 && <ChevronRight className="size-3 shrink-0 text-muted-foreground/60" />}
          <span className={`truncate ${i === parts.length - 1 ? "font-semibold text-foreground" : "text-muted-foreground"}`}>{p}</span>
        </span>
      ))}
    </div>
  );
}

function PaneHeader({ crumbs, meta, actions }: { crumbs: ReactNode; meta?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3 border-b border-border pb-3">
      <div className="min-w-0">
        {crumbs}
        {meta && <div className="mt-1 text-[11.5px] text-muted-foreground">{meta}</div>}
      </div>
      <div className="flex shrink-0 items-center gap-0.5">{actions}</div>
    </div>
  );
}

function ActionIcon({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <Tooltip content={label}>
      <button
        type="button"
        aria-label={label}
        onClick={onClick}
        className="grid size-7 place-items-center rounded-[7px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground [&_svg]:size-[15px]"
      >
        {icon}
      </button>
    </Tooltip>
  );
}

function ConfirmDelete({ label, onConfirm }: { label: string; onConfirm: () => void }) {
  const [ask, setAsk] = useState(false);
  return ask ? (
    <span className="flex items-center gap-1">
      <Button size="xs" variant="destructive" onClick={onConfirm} data-testid="confirm-delete">
        {label}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setAsk(false)}>
        {t("Cancel")}
      </Button>
    </span>
  ) : (
    <ActionIcon label={label} icon={<Trash2 />} onClick={() => setAsk(true)} />
  );
}

/** A "new file / new folder" input for a folder of the skill (`base`, "" for the skill's own folder). */
function AddEntry({
  skill,
  base,
  onAdded,
  setNotice,
}: {
  skill: string;
  base: string;
  onAdded: (path: string | null) => void;
  setNotice: (s: string | null) => void;
}) {
  const [mode, setMode] = useState<"file" | "folder" | null>(null);
  const [name, setName] = useState("");
  const create = async () => {
    const n = name.trim().replace(/^\/+|\/+$/g, "");
    if (!n) return;
    const path = base ? `${base}/${n}` : n;
    const r = mode === "folder" ? await call("newFolder", skill, path) : await call("writeFile", skill, path, "");
    if (!r?.ok) return setNotice(r?.error || t("Could not create it"));
    setNotice(null);
    setMode(null);
    setName("");
    onAdded(mode === "file" ? path : null);
  };
  if (!mode)
    return (
      <div className="flex gap-1.5">
        <Button size="xs" variant="secondary" icon={<FilePlus />} onClick={() => setMode("file")}>
          {t("New file")}
        </Button>
        <Button size="xs" variant="secondary" icon={<FolderPlus />} onClick={() => setMode("folder")}>
          {t("New folder")}
        </Button>
      </div>
    );
  return (
    <div className="flex items-center gap-1.5 rounded-[9px] border border-border bg-muted/40 p-1.5">
      <span className="ps-1 text-muted-foreground [&_svg]:size-3.5">{mode === "folder" ? <FolderPlus /> : <FilePlus />}</span>
      {base && <span className="font-mono text-[11.5px] text-muted-foreground">{base}/</span>}
      <input
        autoFocus
        value={name}
        onChange={(e) => setName(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") void create();
          if (e.key === "Escape") setMode(null);
        }}
        placeholder={mode === "folder" ? "references" : "notes.md"}
        spellCheck={false}
        className="h-7 min-w-0 flex-1 rounded-[7px] border border-input bg-background px-2 font-mono text-[12px] text-foreground outline-none focus:border-ring"
      />
      <Button size="xs" variant="primary" onClick={() => void create()}>
        {t("Create")}
      </Button>
      <Button size="xs" variant="ghost" onClick={() => setMode(null)}>
        {t("Cancel")}
      </Button>
    </div>
  );
}

function NewSkillPane({ onCreated, onCancel }: { onCreated: (name: string) => void; onCancel: () => void }) {
  const initial = useMemo<SkillDraft>(() => ({ name: "", description: "", body: "", extra: {} }), []);
  return (
    <>
      <PaneHeader
        crumbs={<div className="text-[13.5px] font-semibold text-foreground">{t("New skill")}</div>}
        meta={t("Saved as ~/.sympony/skills/<name>/SKILL.md")}
      />
      <SkillForm
        initial={initial}
        isNew
        onCancel={onCancel}
        onSave={async (d) => {
          const r = await call("saveSkill", { ...d, isNew: true });
          if (!r?.ok) return r?.error ? t(r.error) : t("Could not save skill");
          onCreated(d.name);
          return null;
        }}
      />
    </>
  );
}

function SkillPane({
  skill,
  summary,
  files,
  enabled,
  onToggle,
  onSaved,
  onAdded,
  onDeleted,
  setNotice,
}: {
  skill: string;
  summary?: SkillSummary;
  files: number;
  enabled: boolean;
  onToggle: (on: boolean) => void;
  onSaved: (name: string, from?: string) => void;
  onAdded: (path: string | null) => void;
  onDeleted: () => void;
  setNotice: (s: string | null) => void;
}) {
  const [draft, setDraft] = useState<SkillDraft | null>(null);
  useEffect(() => {
    void call("skill", skill).then((r) => {
      if (!r || r.ok === false) return setNotice(r?.error || t("Could not open the skill"));
      setDraft({
        name: String(r.name || skill),
        description: String(r.description || ""),
        body: String(r.body || ""),
        extra: (r.extra as Record<string, unknown>) || {},
        renameFrom: String(r.name || skill),
      });
    });
  }, [skill, setNotice]);
  const problems = summary?.problems ?? [];
  const invalid = problems.length > 0;
  return (
    <>
      <PaneHeader
        crumbs={<Crumbs skill={skill} path="SKILL.md" />}
        meta={
          files === 1
            ? t("{n} file in this skill", { n: files })
            : t("{n} files in this skill", { n: files })
        }
        actions={
          <>
            <ActionIcon label={t("Export")} icon={<Download />} onClick={() => void call("exportSkill", skill)} />
            <ActionIcon label={t("Show in Finder")} icon={<FolderOpen />} onClick={() => void call("revealSkill", skill)} />
            <ConfirmDelete
              label={t("Delete skill")}
              onConfirm={async () => {
                const r = await call("deleteSkill", skill);
                if (!r?.ok) return setNotice(r?.error || t("Could not delete it"));
                onDeleted();
              }}
            />
          </>
        }
      />

      {/* whether Pony may use it */}
      <div
        className={`mb-4 flex items-center gap-3 rounded-[11px] border px-3 py-2.5 ${
          invalid ? "border-destructive/35 bg-destructive/[0.06]" : enabled ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-border bg-muted/40"
        }`}
      >
        <span className={`size-2 shrink-0 rounded-full ${invalid ? "bg-destructive" : enabled ? "bg-emerald-500" : "bg-muted-foreground/50"}`} />
        <div className="min-w-0 flex-1">
          <div className="text-[12.5px] font-medium text-foreground">
            {invalid ? t("Pony can’t use this skill yet") : enabled ? t("Pony can use this skill") : t("Turned off for Pony")}
          </div>
          <div className="text-[11.5px] text-muted-foreground">
            {invalid
              ? problems.map((p) => t(p)).join("; ")
              : summary?.hasScripts
                ? t("Scripts aren’t run by Pony")
                : summary && summary.bodyLines > 500
                  ? t("Long body (>500 lines): move details into references/")
                  : t("Pony reads the description to know when to use it.")}
          </div>
        </div>
        <Switch checked={enabled && !invalid} disabled={invalid} aria-label={t("Use this skill")} onCheckedChange={onToggle} />
      </div>

      {draft && (
        <SkillForm
          initial={draft}
          isNew={false}
          onSave={async (d) => {
            const r = await call("saveSkill", d);
            if (!r?.ok) return r?.error ? t(r.error) : t("Could not save skill");
            onSaved(d.name, d.renameFrom);
            return null;
          }}
        />
      )}

      <div className="mt-4 border-t border-border pt-3">
        <AddEntry skill={skill} base="" onAdded={onAdded} setNotice={setNotice} />
      </div>
    </>
  );
}

function DirPane({
  skill,
  path,
  items,
  onOpen,
  onAdded,
  onDeleted,
  setNotice,
}: {
  skill: string;
  path: string;
  items: TreeEntry[];
  onOpen: (e: TreeEntry) => void;
  onAdded: (path: string | null) => void;
  onDeleted: () => void;
  setNotice: (s: string | null) => void;
}) {
  const role: Record<string, string> = {
    references: t("Documents the instructions point to; Pony reads them only when it needs them."),
    assets: t("Templates, images and data the skill uses."),
    scripts: t("Code that comes with the skill. Pony doesn’t run scripts."),
  };
  return (
    <>
      <PaneHeader
        crumbs={<Crumbs skill={skill} path={path} />}
        meta={role[path] ?? (items.length === 1 ? t("{n} item", { n: items.length }) : t("{n} items", { n: items.length }))}
        actions={
          <>
            <ActionIcon label={t("Show in Finder")} icon={<FolderOpen />} onClick={() => void call("revealFile", skill, path)} />
            <ConfirmDelete
              label={t("Delete folder")}
              onConfirm={async () => {
                const r = await call("deleteFile", skill, path);
                if (!r?.ok) return setNotice(r?.error || t("Could not delete it"));
                onDeleted();
              }}
            />
          </>
        }
      />
      {items.length > 0 ? (
        <div className="mb-4 grid grid-cols-[repeat(auto-fill,minmax(150px,1fr))] gap-2">
          {items.map((e) => {
            const look = entryLook(e.path, e.dir);
            return (
              <button
                key={e.path}
                type="button"
                onClick={() => onOpen(e)}
                className="flex items-center gap-2 rounded-[10px] border border-border bg-background px-2.5 py-2 text-start transition-colors hover:bg-muted/60"
              >
                <span className={`[&_svg]:size-4 ${look.tint}`}>{look.icon}</span>
                <span className="min-w-0">
                  <span className="block truncate font-mono text-[12px] text-foreground">{baseOf(e.path)}</span>
                  <span className="block text-[10.5px] text-muted-foreground">{e.dir ? t("Folder") : fmtSize(e.size)}</span>
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <p className="mb-4 text-[12px] text-muted-foreground">{t("This folder is empty.")}</p>
      )}
      <AddEntry skill={skill} base={path} onAdded={onAdded} setNotice={setNotice} />
    </>
  );
}

function FilePane({
  skill,
  path,
  size,
  onDeleted,
  setNotice,
}: {
  skill: string;
  path: string;
  size: number;
  onDeleted: () => void;
  setNotice: (s: string | null) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  const [orig, setOrig] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const isMd = /\.(md|markdown)$/i.test(path);
  const [preview, setPreview] = useState(false);
  useEffect(() => {
    void call("readFile", skill, path).then((r) => {
      if (r?.ok) {
        setText(String(r.text ?? ""));
        setOrig(String(r.text ?? ""));
      } else setErr(r?.error || t("Could not open the file"));
    });
  }, [skill, path]);
  const save = async () => {
    const r = await call("writeFile", skill, path, text ?? "");
    if (!r?.ok) return setNotice(r?.error || t("Could not save the file"));
    setOrig(text ?? "");
    setSaved(true);
  };
  const lines = text === null ? 0 : text.split("\n").length;
  return (
    <>
      <PaneHeader
        crumbs={<Crumbs skill={skill} path={path} />}
        meta={
          text === null
            ? fmtSize(size)
            : lines === 1
              ? t("{size}, {n} line", { size: fmtSize(size), n: lines })
              : t("{size}, {n} lines", { size: fmtSize(size), n: lines })
        }
        actions={
          <>
            <ActionIcon label={t("Show in Finder")} icon={<FolderOpen />} onClick={() => void call("revealFile", skill, path)} />
            <ConfirmDelete
              label={t("Delete file")}
              onConfirm={async () => {
                const r = await call("deleteFile", skill, path);
                if (!r?.ok) return setNotice(r?.error || t("Could not delete it"));
                onDeleted();
              }}
            />
          </>
        }
      />
      {err ? (
        <p className="text-[12.5px] text-muted-foreground">
          {err === "not a text file" ? t("This file isn’t text, so it can’t be edited here. Use Show in Finder.") : err}
        </p>
      ) : text === null ? null : (
        <div className="flex min-h-0 flex-1 flex-col gap-2">
          {isMd && (
            <div className="flex gap-1 self-start rounded-[8px] bg-muted p-0.5 text-[11.5px]">
              {[false, true].map((p) => (
                <button
                  key={String(p)}
                  type="button"
                  onClick={() => setPreview(p)}
                  className={`rounded-[6px] px-2.5 py-0.5 ${preview === p ? "bg-background font-medium text-foreground shadow-sm" : "text-muted-foreground"}`}
                >
                  {p ? t("Preview") : t("Edit")}
                </button>
              ))}
            </div>
          )}
          {preview ? (
            <div className="min-h-[240px] flex-1 overflow-y-auto rounded-[10px] border border-border px-4 py-3">
              {text.trim() ? <Markdown source={text} /> : <p className="text-[12px] text-muted-foreground">{t("This file is empty.")}</p>}
            </div>
          ) : (
            <textarea
              value={text}
              onChange={(e) => {
                setText(e.target.value);
                setSaved(false);
              }}
              spellCheck={false}
              className="min-h-[240px] flex-1 resize-none rounded-[10px] border border-input bg-background px-3.5 py-2.5 font-mono text-[12px] leading-relaxed text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/20"
            />
          )}
          <div className="flex items-center justify-end gap-2">
            {saved && <span className="me-auto text-[11.5px] text-emerald-600 dark:text-emerald-400">{t("Saved")}</span>}
            {!saved && text !== orig && <span className="me-auto text-[11.5px] text-muted-foreground">{t("Unsaved changes")}</span>}
            <Button size="sm" variant="primary" disabled={text === orig} onClick={() => void save()}>
              {t("Save")}
            </Button>
          </div>
        </div>
      )}
    </>
  );
}
