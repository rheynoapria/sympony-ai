import { describe, expect, test } from 'bun:test';

// modules/data.js against a stand-in `api`: the agent list the notch's chat and Translate answer through (#66)
const calls = [];
const heard = {}; // the events data.js listens to
let answering = false;
globalThis._t = (s) => s;
globalThis.N = {
  st: { settings: { chatAgent: 'claude' } },
  api: {
    on: (ch, fn) => { heard[ch] = fn; },
    onAgents: (fn) => { heard['agents:list'] = fn; },
    svc: async (name, method, refresh) => {
      calls.push(`${name}.${method}${refresh ? ' (fresh)' : ''}`);
      // (Claude Code installed and signed in, but not answering on the first check, as on a cold first start)
      return [{ id: 'claude', name: 'Claude Code', installed: true, signedIn: true, supported: true, responding: answering }];
    },
  },
};
require('../modules/data.js');

describe('the agents the notch answers through', () => {
  test('an agent that only answered late wakes Pony on the next check, which waits 15 s between tries', async () => {
    await N.loadAgents();
    expect(N.aiAgent('chatAgent')).toBe(null); // asleep: Claude Code didn't answer the first check
    answering = true;
    expect(await N.recheckAgents()).toBe(true); // looked again, forced, and it answers now
    expect(calls.at(-1)).toBe('ai.agents (fresh)');
    expect(N.aiAgent('chatAgent').id).toBe('claude');
    const n = calls.length;
    expect(await N.recheckAgents()).toBe(false); // (not again within 15 s)
    expect(calls.length).toBe(n);
    expect(await N.recheckAgents(true)).toBe(false); // but right away for a message just sent (nothing changed now)
    expect(calls.at(-1)).toBe('ai.agents (fresh)');
    expect(calls.length).toBe(n + 1);
  });

  test('an agent slow to start wakes Pony the moment it answers, with no check from the notch', async () => {
    const claude = { id: 'claude', name: 'Claude Code', installed: true, signedIn: true, supported: true };
    heard['agents:list']([{ ...claude, responding: false }]); // (it failed after all)
    expect(N.aiAgent('chatAgent')).toBe(null);
    let told = 0;
    N.watch('agents', () => { told++; });
    const n = calls.length;
    heard['agents:list']([{ ...claude, responding: true, starting: false, version: '2.1.241 (Claude Code)' }]);
    expect(N.aiAgent('chatAgent').id).toBe('claude');
    expect(told).toBeGreaterThan(0); // (the chat draws itself again)
    expect(calls.length).toBe(n); // nothing asked
    // and one still starting already counts as ready
    heard['agents:list']([{ ...claude, responding: true, starting: true }]);
    expect(N.aiAgent('chatAgent').id).toBe('claude');
  });

  test('two looks at the same time share one check', async () => {
    const n = calls.length;
    const [a, b] = await Promise.all([N.recheckAgents(true), N.recheckAgents(true)]);
    expect([a, b]).toEqual([false, false]);
    expect(calls.length).toBe(n + 1);
  });
});
