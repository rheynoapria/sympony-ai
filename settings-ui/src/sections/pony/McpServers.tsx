import { useCallback, useEffect, useState } from "react";
import { Check, ChevronRight, CircleAlert, Download, Globe, Pencil, Plug, Plus, RefreshCw, ShieldCheck, TerminalSquare, Trash2 } from "@/components/icons";
import { PanelCard } from "@/components/shell/PanelCard";
import { groupIcon } from "@/components/shell/groupIcons";
import { Button } from "@/components/ui/knowns/button";
import { SegmentedControl } from "@/components/ui/knowns/segmented-control";
import { StatusDot } from "@/components/ui/knowns/status-dot";
import { Switch } from "@/components/ui/knowns/switch";
import { Skeleton } from "@/components/ui/knowns/skeleton";
import { t } from "@/lib/i18n";
import { notch } from "@/lib/notch";
import { cn } from "@/lib/knowns/utils";
import type { CustomPartProps } from "@/rows/types";

/** An outside MCP server as Settings sees it (mcp_out.rs `listing`). */
interface Server {
  id: string;
  name: string;
  on: boolean;
  kind: "stdio" | "http";
  command?: string;
  args?: string[];
  url?: string;
  mode: "ask" | "allow";
  allowTools?: string[];
  envNames?: string[];
  headerNames?: string[];
  state: "idle" | "starting" | "ready" | "failed";
  error?: string;
  tools: { name: string; description?: string }[];
}
interface Found {
  name: string;
  kind: string;
  from: string;
  ok: boolean;
  what: string;
  added: boolean;
}

const input =
  "h-8 w-full rounded-[var(--control-radius)] border border-input bg-background px-2.5 text-[12.5px] text-foreground outline-none focus:border-ring focus:ring-2 focus:ring-ring/25";

/** "npx -y pkg 'a b'" → ["npx", "-y", "pkg", "a b"] */
export function splitCommand(line: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"|'([^']*)'|(\S+)/g;
  for (const m of line.matchAll(re)) out.push(m[1] ?? m[2] ?? m[3]);
  return out;
}

/** "A=1\nB = two" → {A: "1", B: "two"}; "Authorization: Bearer x" → {Authorization: "Bearer x"} */
export function pairs(text: string, sep: "=" | ":"): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of text.split("\n")) {
    const i = line.indexOf(sep);
    if (i <= 0) continue;
    const k = line.slice(0, i).trim();
    if (k) out[k] = line.slice(i + 1).trim();
  }
  return out;
}

const tone = (s: Server) =>
  !s.on ? "neutral" : s.state === "ready" ? "success" : s.state === "failed" ? "danger" : s.state === "starting" ? "warning" : "neutral";
const stateLabel = (s: Server) =>
  !s.on
    ? t("Off")
    : s.state === "ready"
      ? t("{n} tools", { n: s.tools.length })
      : s.state === "failed"
        ? t("Couldn’t connect")
        : s.state === "starting"
          ? t("Starting…")
          : t("Starts when Pony needs it");

function ServerForm({ server, onDone }: { server?: Server; onDone: (saved: boolean) => void }) {
  const [name, setName] = useState(server?.name ?? "");
  const [kind, setKind] = useState<"stdio" | "http">(server?.kind ?? "stdio");
  const [cmd, setCmd] = useState(server ? [server.command, ...(server.args ?? [])].filter(Boolean).join(" ") : "");
  const [url, setUrl] = useState(server?.url ?? "");
  const [env, setEnv] = useState("");
  const [header, setHeader] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const secretNames = kind === "http" ? server?.headerNames : server?.envNames;

  const save = async () => {
    setBusy(true);
    setErr("");
    const parts = splitCommand(cmd);
    const typed = kind === "http" ? header.trim() : env.trim();
    // (secrets go only when typed: editing a server keeps the saved ones otherwise)
    const secret = !server || typed ? { env: kind === "stdio" ? pairs(env, "=") : {}, headers: kind === "http" ? pairs(header, ":") : {} } : null;
    const r = (await notch
      .svc("pony", "mcpSave", { ...server, id: server?.id, name, kind, command: parts[0] ?? "", args: parts.slice(1), url, on: server?.on ?? true, mode: server?.mode ?? "ask" }, secret)
      .catch(() => null)) as { ok?: boolean; error?: string; id?: string } | null;
    setBusy(false);
    if (!r?.ok) {
      setErr(r?.error || t("Couldn’t save"));
      return;
    }
    if (r.id) void notch.svc("pony", "mcpConnect", r.id);
    onDone(true);
  };

  return (
    <div className="flex flex-col gap-3 rounded-[12px] border border-border bg-muted/30 p-3.5">
      <div className="grid grid-cols-[110px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5 text-[12.5px]">
        <label className="text-muted-foreground" htmlFor="mcp-name">{t("Name")}</label>
        <input id="mcp-name" className={input} value={name} maxLength={40} placeholder="Notion" onChange={(e) => setName(e.target.value)} />
        <span className="text-muted-foreground">{t("Connects by")}</span>
        <SegmentedControl
          size="sm"
          aria-label={t("Connects by")}
          value={kind}
          onValueChange={(v) => setKind(v as "stdio" | "http")}
          options={[
            { value: "stdio", label: t("Command") },
            { value: "http", label: t("Address (URL)") },
          ]}
          className="w-fit"
        />
        {kind === "stdio" ? (
          <>
            <label className="text-muted-foreground" htmlFor="mcp-cmd">{t("Command")}</label>
            <input id="mcp-cmd" className={cn(input, "font-mono text-[12px]")} value={cmd} placeholder="npx -y @modelcontextprotocol/server-filesystem ~/Documents" onChange={(e) => setCmd(e.target.value)} />
            <label className="self-start pt-1.5 text-muted-foreground" htmlFor="mcp-env">{t("Environment")}</label>
            <textarea
              id="mcp-env"
              rows={2}
              className={cn(input, "h-auto py-1.5 font-mono text-[12px]")}
              value={env}
              placeholder={secretNames?.length ? t("Saved: {names}. Type to replace.", { names: secretNames.join(", ") }) : "API_KEY=…"}
              onChange={(e) => setEnv(e.target.value)}
            />
          </>
        ) : (
          <>
            <label className="text-muted-foreground" htmlFor="mcp-url">{t("Address")}</label>
            <input id="mcp-url" className={cn(input, "font-mono text-[12px]")} value={url} placeholder="https://mcp.example.com/mcp" onChange={(e) => setUrl(e.target.value)} />
            <label className="text-muted-foreground" htmlFor="mcp-head">{t("Header")}</label>
            <input
              id="mcp-head"
              className={cn(input, "font-mono text-[12px]")}
              value={header}
              placeholder={secretNames?.length ? t("Saved: {names}. Type to replace.", { names: secretNames.join(", ") }) : "Authorization: Bearer …"}
              onChange={(e) => setHeader(e.target.value)}
            />
          </>
        )}
      </div>
      <p className="text-[11.5px] leading-relaxed text-muted-foreground">
        {t("Keys and headers are kept encrypted on this Mac and never go to the AI.")}
      </p>
      {err && <p className="text-[12px] text-destructive">{err}</p>}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={() => onDone(false)}>{t("Cancel")}</Button>
        <Button size="sm" variant="primary" disabled={busy || !name.trim()} onClick={() => void save()}>
          {server ? t("Save") : t("Add server")}
        </Button>
      </div>
    </div>
  );
}

function ImportPanel({ onDone }: { onDone: () => void }) {
  const [found, setFound] = useState<Found[] | null>(null);
  const [picked, setPicked] = useState<string[]>([]);
  useEffect(() => {
    void (notch.svc("pony", "mcpFound") as Promise<Found[]>).then((f) => {
      const list = Array.isArray(f) ? f : [];
      setFound(list);
      setPicked(list.filter((x) => x.ok && !x.added).map((x) => x.name));
    });
  }, []);
  const go = async () => {
    await notch.svc("pony", "mcpImport", picked).catch(() => null);
    onDone();
  };
  return (
    <div className="flex flex-col gap-2.5 rounded-[12px] border border-border bg-muted/30 p-3.5">
      <span className="text-[12.5px] font-medium text-foreground">{t("From Claude Desktop and Claude Code")}</span>
      {found === null ? (
        <Skeleton className="h-16 w-full" />
      ) : found.length === 0 ? (
        <p className="text-[12px] text-muted-foreground">{t("No MCP servers found in Claude’s settings on this Mac.")}</p>
      ) : (
        <div className="flex flex-col divide-y divide-border/70">
          {found.map((f) => {
            const can = f.ok && !f.added;
            return (
              <label key={f.name} className={cn("flex items-center gap-3 py-2", can ? "cursor-pointer" : "opacity-55")}>
                <input
                  type="checkbox"
                  disabled={!can}
                  checked={can && picked.includes(f.name)}
                  onChange={(e) => setPicked((p) => (e.target.checked ? [...p, f.name] : p.filter((x) => x !== f.name)))}
                  className="size-3.5 accent-[var(--primary)]"
                />
                <span className="min-w-0 flex-1">
                  <span className="block text-[12.5px] font-medium text-foreground">{f.name}</span>
                  <span className="block truncate font-mono text-[11px] text-muted-foreground">{f.what}</span>
                </span>
                <span className="shrink-0 text-[11px] text-muted-foreground">
                  {f.added ? t("Added") : !f.ok ? t("Not supported") : f.from}
                </span>
              </label>
            );
          })}
        </div>
      )}
      <div className="flex justify-end gap-2">
        <Button size="sm" variant="ghost" onClick={onDone}>{t("Cancel")}</Button>
        <Button size="sm" variant="primary" disabled={!picked.length} onClick={() => void go()}>
          {t("Add {n}", { n: picked.length })}
        </Button>
      </div>
    </div>
  );
}

function ServerIcon({ s }: { s: Server }) {
  const Icon = s.kind === "http" ? Globe : TerminalSquare;
  return (
    <span className="relative grid size-8 shrink-0 place-items-center rounded-[9px] border border-border bg-background text-muted-foreground">
      <Icon className="size-4" aria-hidden="true" />
      <span className="absolute -right-0.5 -bottom-0.5 grid size-2.5 place-items-center rounded-full bg-card">
        <StatusDot tone={tone(s)} pulse={s.state === "starting"} className="size-2" label={false} />
      </span>
    </span>
  );
}

function Details({ s, editing, onEdit, onChange, onDone }: {
  s: Server;
  editing: boolean;
  onEdit: () => void;
  onChange: (patch: Partial<Server>) => void;
  onDone: () => void;
}) {
  const allowed = s.allowTools ?? [];
  const label = "text-[11.5px] text-muted-foreground";
  return (
    <div className="flex flex-col gap-3 border-t border-border/70 bg-muted/25 px-4 py-3.5">
      {s.state === "failed" && s.error && (
        <div className="flex items-start gap-2 rounded-[9px] bg-red-500/[0.07] px-3 py-2 text-[12px] text-red-700 dark:text-red-300">
          <CircleAlert className="mt-px size-3.5 shrink-0" aria-hidden="true" />
          <span>{s.error}</span>
        </div>
      )}
      <div className="grid grid-cols-[88px_minmax(0,1fr)] items-center gap-x-3 gap-y-2.5">
        <span className={label}>{s.kind === "http" ? t("Address") : t("Command")}</span>
        <code className="truncate font-mono text-[11.5px] text-foreground" title={s.kind === "http" ? s.url : [s.command, ...(s.args ?? [])].join(" ")}>
          {s.kind === "http" ? s.url : [s.command, ...(s.args ?? [])].join(" ")}
        </code>
        <span className={label}>{t("Mode")}</span>
        <SegmentedControl
          size="sm"
          aria-label={t("When Pony uses it")}
          value={s.mode}
          onValueChange={(v) => onChange({ mode: v as "ask" | "allow" })}
          options={[
            { value: "ask", label: t("Ask first") },
            { value: "allow", label: t("Allow") },
          ]}
          className="w-fit"
        />
        <span className={cn(label, "self-start pt-1")}>{t("Tools")}</span>
        {s.tools.length ? (
          <div className="flex flex-wrap gap-1.5">
            {s.tools.map((tl) => (
              <span
                key={tl.name}
                title={tl.description || tl.name}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-1.5 py-0.5 font-mono text-[11px] text-foreground"
              >
                {allowed.includes(tl.name) && <Check className="size-3 text-emerald-600 dark:text-emerald-400" aria-label={t("always allowed")} />}
                {tl.name}
              </span>
            ))}
            {allowed.length > 0 && (
              <button type="button" onClick={() => onChange({ allowTools: [] })} className="cursor-pointer text-[11px] text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
                {t("Forget always-allowed tools")}
              </button>
            )}
          </div>
        ) : (
          <span className="pt-0.5 text-[12px] text-muted-foreground">{s.state === "failed" ? "—" : t("Connect to see its tools.")}</span>
        )}
      </div>
      {editing ? (
        <ServerForm server={s} onDone={onDone} />
      ) : (
        <div className="flex items-center gap-1.5">
          <Button size="xs" variant="secondary" icon={<RefreshCw className={s.state === "starting" ? "animate-spin" : undefined} />}
            disabled={!s.on || s.state === "starting"} onClick={() => void notch.svc("pony", "mcpConnect", s.id).then(onDone)}>
            {s.state === "failed" ? t("Try again") : t("Connect")}
          </Button>
          <Button size="xs" variant="secondary" icon={<Pencil />} onClick={onEdit}>
            {t("Edit")}
          </Button>
          <Button size="xs" variant="quiet" icon={<Trash2 />} className="ms-auto hover:text-red-600" onClick={() => void notch.svc("pony", "mcpRemove", s.id).then(onDone)}>
            {t("Remove")}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Settings → Pony Assistant → Abilities → Outside tools (MCP): a card of its own. */
/** Outside tools. `api`: Pony thinks with its own engine, the only one with code mode (`ponyMcpCode`). */
export function McpServers({ settings, set, api }: Pick<CustomPartProps, "settings" | "set"> & { api: boolean }) {
  const codeMode = settings.ponyMcpCode === "on" || settings.ponyMcpCode === "off" ? settings.ponyMcpCode : "auto";
  const [list, setList] = useState<Server[] | null>(null);
  const [open, setOpen] = useState<string | null>(null);
  const [panel, setPanel] = useState<"add" | "import" | null>(null);
  const [editing, setEditing] = useState<string | null>(null);

  const load = useCallback(() => {
    void (notch.svc("pony", "mcpList") as Promise<Server[]>).then((l) => setList(Array.isArray(l) ? l : []));
  }, []);
  useEffect(() => {
    load();
    // (a server starting, ready or failing: the row follows)
    const off = notch.on("pony:mcp", load);
    return () => {
      if (typeof off === "function") off();
    };
  }, [load]);

  const save = async (s: Server, patch: Partial<Server>) => {
    setList((l) => l?.map((x) => (x.id === s.id ? { ...x, ...patch } : x)) ?? l);
    await notch.svc("pony", "mcpSave", { ...s, ...patch }, null).catch(() => null);
    load();
  };
  const closePanel = () => {
    setPanel(null);
    load();
  };

  return (
    <PanelCard
      title={t("Outside tools (MCP)")}
      icon={groupIcon("Outside tools (MCP)")}
      description={t("GitHub, Notion, a database or your own server, as more tools for Pony")}
      action={
        <div className="flex gap-1.5">
          <Button size="xs" variant="secondary" icon={<Download />} onClick={() => setPanel(panel === "import" ? null : "import")}>
            {t("Import")}
          </Button>
          <Button size="xs" variant="secondary" icon={<Plus />} onClick={() => setPanel(panel === "add" ? null : "add")}>
            {t("Add")}
          </Button>
        </div>
      }
    >
      <div className="flex flex-col gap-3">
        {panel === "import" && <ImportPanel onDone={closePanel} />}
        {panel === "add" && <ServerForm onDone={closePanel} />}

        {list === null ? (
          <div className="flex flex-col gap-2">
            <Skeleton className="h-12 w-full" rounded="rounded-[12px]" />
            <Skeleton className="h-12 w-full" rounded="rounded-[12px]" />
          </div>
        ) : list.length === 0 ? (
          !panel && (
            <div className="flex flex-col items-center gap-2.5 rounded-[12px] border border-dashed border-border px-4 py-6 text-center">
              <span className="grid size-9 place-items-center rounded-[10px] bg-sky-500/10 text-sky-600 dark:text-sky-400">
                <Plug className="size-4.5" aria-hidden="true" />
              </span>
              <p className="max-w-[340px] text-[12.5px] leading-relaxed text-muted-foreground">
                {t("No servers yet. Import the ones you use in Claude, or add one.")}
              </p>
              <div className="flex gap-1.5">
                <Button size="xs" variant="secondary" icon={<Download />} onClick={() => setPanel("import")}>{t("Import from Claude")}</Button>
                <Button size="xs" variant="secondary" icon={<Plus />} onClick={() => setPanel("add")}>{t("Add server")}</Button>
              </div>
            </div>
          )
        ) : (
          <div className="overflow-hidden rounded-[12px] border border-border">
            {list.map((s, i) => {
              const expanded = open === s.id;
              return (
                <div key={s.id} className={cn(i > 0 && "border-t border-border/80")}>
                  <div className="flex items-center gap-3 px-3.5 py-2.5">
                    <button
                      type="button"
                      aria-expanded={expanded}
                      aria-label={s.name}
                      onClick={() => {
                        setOpen(expanded ? null : s.id);
                        setEditing(null);
                      }}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 rounded-[8px] text-start outline-none focus-visible:ring-2 focus-visible:ring-ring/40"
                    >
                      <ServerIcon s={s} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-medium text-foreground">{s.name}</span>
                        <span className={cn("block truncate text-[11.5px]", s.on && s.state === "failed" ? "text-red-600 dark:text-red-400" : "text-muted-foreground")}>
                          {stateLabel(s)}
                          {s.on && s.state !== "failed" ? ` · ${s.mode === "allow" ? t("Allowed") : t("Asks first")}` : ""}
                        </span>
                      </span>
                      <ChevronRight className={cn("size-3.5 shrink-0 text-muted-foreground transition-transform", expanded && "rotate-90")} aria-hidden="true" />
                    </button>
                    <Switch checked={s.on} aria-label={s.name} onCheckedChange={(on) => void save(s, { on })} />
                  </div>
                  {expanded && (
                    <Details
                      s={s}
                      editing={editing === s.id}
                      onEdit={() => setEditing(s.id)}
                      onChange={(patch) => void save(s, patch)}
                      onDone={() => {
                        setEditing(null);
                        load();
                      }}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}
        {api && list && list.length > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-3" data-k="ponyMcpCode">
            <span className="min-w-0 flex-1 text-[12px] leading-snug text-muted-foreground">
              {codeMode === "on"
                ? t("Pony reaches these tools through short code: far fewer tokens, and many calls in one step.")
                : codeMode === "off"
                  ? t("Every tool's description goes with each message: simplest, but uses the most tokens.")
                  : t("Pony switches to code when the tools are many, to save tokens.")}
            </span>
            <SegmentedControl
              aria-label={t("How Pony uses these tools")}
              size="sm"
              value={codeMode}
              options={[
                { value: "auto", label: t("Auto") },
                { value: "off", label: t("Direct") },
                { value: "on", label: t("Code") },
              ]}
              onValueChange={(v) => void set({ ponyMcpCode: v })}
            />
          </div>
        )}
        <p className="flex items-start gap-1.5 text-[11.5px] leading-relaxed text-muted-foreground">
          <ShieldCheck className="mt-0.5 size-3.5 shrink-0 opacity-70" aria-hidden="true" />
          {t("Ask first shows each call on a card. Tools that delete always ask; what a tool returns is never taken as an instruction.")}
        </p>
      </div>
    </PanelCard>
  );
}
