import { describe, expect, test } from 'bun:test';

// modules/data.js against a stand-in `api`: the agent list the notch's chat and Translate answer through (#66)
const calls = [];
let answering = false;
globalThis._t = (s) => s;
globalThis.N = {
  st: { settings: { chatAgent: 'claude' } },
  api: {
    on: () => {},
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
  });
});
