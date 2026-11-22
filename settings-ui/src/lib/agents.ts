import { useEffect, useState } from "react";
import { notch } from "@/lib/notch";
import type { AgentInfo } from "@/sections/ai";

// The AI agents on this Mac (svc ai.agents), shared by Pony Assistant and Integrations and fetched as Settings
// opens, so neither page waits for the CLIs: they show what's known at once and update when a check comes back.
let cache: AgentInfo[] | null = null;
let inflight: Promise<AgentInfo[]> | null = null;
const subs = new Set<(a: AgentInfo[]) => void>();

export function loadAgents(force = false): Promise<AgentInfo[]> {
  if (inflight && !force) return inflight;
  const p = (notch.svc("ai", "agents", force) as Promise<unknown>)
    .catch(() => [])
    .then((res) => {
      const list = Array.isArray(res) ? (res as AgentInfo[]) : [];
      cache = list;
      if (inflight === p) inflight = null;
      subs.forEach((f) => f(list));
      return list;
    });
  inflight = p;
  return p;
}

/** The agents (null until the first answer) and whether a check is running; `refresh` checks the CLIs again. */
export function useAgents(): { agents: AgentInfo[] | null; loading: boolean; refresh: () => void } {
  const [agents, setAgents] = useState<AgentInfo[] | null>(cache);
  const [loading, setLoading] = useState(cache === null);
  useEffect(() => {
    const on = (a: AgentInfo[]) => {
      setAgents(a);
      setLoading(false);
    };
    subs.add(on);
    // (the cache is shown at once; a fresh answer replaces it)
    void loadAgents(false);
    return () => {
      subs.delete(on);
    };
  }, []);
  return {
    agents,
    loading,
    refresh: () => {
      setLoading(true);
      void loadAgents(true);
    },
  };
}
