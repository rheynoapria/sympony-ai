// A local mock OpenAI-compatible AI router with OAuth PKCE loopback so
// Pony's engine can be tested end-to-end without a remote server.
//   bun tools/mock-ai-router.ts [port]        → Settings → Pony Assistant → An AI server → http://127.0.0.1:<port>
// The sign-in page approves at once. Chat answers are canned: "ingat …" / "remember …" makes a remember tool call,
// "tugas …" / "todo …" an add_todo call, "skill <name>" a read_skill call, "jalankan <cmd>" a run_command call, "baca <path>" a read_file call, "obrolan <words>" a recall call, "tool <name> {json}" that call; "panggil saya X" is learned after the chat; a tool result gets a one-line confirmation; anything else is echoed.
// UPSTREAM_URL + UPSTREAM_KEY (+ UPSTREAM_MODEL): chats go to a real OpenAI-compatible server instead.
import { createHash, randomBytes } from "node:crypto";

const port = Number(process.argv[2] || 8799);
const codes = new Map<string, { challenge: string; redirect: string; device: string; at: number }>();
const keys = new Map<string, { device: string; plan: string }>();
const MODELS = [
  // (one model and a daily quota, as the owner's router has now)
  { id: "pony", object: "model", display_name: "Pony", description: "Sympony AI", context_window: 128000, max_output_tokens: 8192, capabilities: { tools: true, vision: false, streaming: true }, default: true },
];
let used = 0;
const web = { searches: 0, fetches: 0 };

const json = (v: unknown, status = 200) => Response.json(v, { status });
const fail = (status: number, code: string, message: string) => json({ error: { code, message } }, status);
const b64url = (b: Buffer) => b.toString("base64url");
const loopback = (u: string) => /^http:\/\/(127\.0\.0\.1|\[::1\]):\d+\/callback$/.test(u);

function canned(messages: any[]) {
  const last = messages[messages.length - 1];
  const call = (name: string, args: object) => ({
    role: "assistant", content: null,
    tool_calls: [{ id: "call_" + b64url(randomBytes(6)), type: "function", function: { name, arguments: JSON.stringify(args) } }],
  });
  if (last.role === "tool") {
    console.log(`  tool result: ${String(last.content).slice(0, 120)}`);
    if (String(last.content).startsWith("[1]")) return { role: "assistant", content: "Ini beritanya: harga kopi naik [1], dan ekspor naik [2]." };
    return { role: "assistant", content: `Beres: ${String(last.content).slice(0, 300)}` };
  }
  const text = String(last.content || "");
  // (Pony's memory upkeep: learning ("panggil saya …" → a note) and a chat's notes)
  const sys = String(messages[0]?.content || "");
  if (sys.startsWith("You decide what an assistant should remember")) {
    const n = /panggil saya (\S+)/i.exec(text);
    return { role: "assistant", content: JSON.stringify({ remember: n ? [`Ingin dipanggil ${n[1]}`] : [] }) };
  }
  if (sys.startsWith("You keep short running notes")) return { role: "assistant", content: `Catatan: ${text.length} huruf percakapan sebelumnya.` };
  const ask = text.split(/(?:^|\n)User: /).pop()!.replace(/\n+Assistant:\s*$/, "").trim();
  let m = /^(?:ingat|remember)\s+(.+)/i.exec(ask);
  if (m) return call("remember", { text: m[1] });
  m = /^(?:tugas|todo)\s+(.+)/i.exec(ask);
  if (m) return call("add_todo", { what: m[1] });
  // (commands & files, when Settings turned them on: "jalankan <cmd>" / "run <cmd>", "baca <path>" / "read <path>")
  m = /^(?:jalankan|run)\s+(.+)/i.exec(ask);
  if (m) return call("run_command", { command: m[1] });
  m = /^(?:baca|read)\s+(\S+)/i.exec(ask);
  if (m) return call("read_file", { path: m[1] });
  m = /^(?:berita|cari|search)\s+(.+)/i.exec(ask);
  if (m) return call("web_search", { query: m[1], news: true, recency: "day" });
  // ("tool <name> {json}": that exact call, for end-to-end tests of outside tools and the agent bridge)
  m = /^tool\s+(\S+)\s+(\{[\s\S]*\})\s*$/i.exec(ask);
  if (m) { try { return call(m[1], JSON.parse(m[2])); } catch { /* not JSON: echo */ } }
  m = /^(?:recall|obrolan)\s+(.+)/i.exec(ask);
  if (m) return call("recall", { query: m[1] });
  m = /^skill\s+([a-z0-9-]+)/i.exec(ask);
  if (m) return call("read_skill", { name: m[1] });
  return { role: "assistant", content: `Halo dari router tiruan. Kamu bilang: “${ask.slice(0, 200)}”` };
}

Bun.serve({
  port,
  hostname: "127.0.0.1",
  async fetch(req) {
    const url = new URL(req.url);
    const p = url.pathname;

    if (p === "/oauth/authorize") {
      const q = url.searchParams;
      const redirect = q.get("redirect_uri") || "";
      if (q.get("client_id") !== "sympony-desktop" || !loopback(redirect)) return new Response("bad client or redirect", { status: 400 });
      if (q.get("code_challenge_method") !== "S256" || !q.get("code_challenge")) return new Response("PKCE S256 required", { status: 400 });
      const code = b64url(randomBytes(16));
      codes.set(code, { challenge: q.get("code_challenge")!, redirect, device: q.get("device_name") || "", at: Date.now() });
      return Response.redirect(`${redirect}?code=${code}&state=${encodeURIComponent(q.get("state") || "")}`, 302);
    }

    if (p === "/oauth/token" && req.method === "POST") {
      const f = new URLSearchParams(await req.text());
      const c = codes.get(f.get("code") || "");
      codes.delete(f.get("code") || ""); // single use
      if (!c || Date.now() - c.at > 60_000 || f.get("redirect_uri") !== c.redirect) return fail(400, "invalid_grant", "Sign-in expired; try again");
      if (b64url(createHash("sha256").update(f.get("code_verifier") || "").digest()) !== c.challenge) return fail(400, "invalid_grant", "PKCE check failed");
      const key = "sk-sym-" + b64url(randomBytes(24));
      keys.set(key, { device: c.device, plan: "free" });
      console.log(`signed in: ${c.device}`);
      return json({ api_key: key, key_id: "key_" + b64url(randomBytes(6)), account: { id: "acc_mock", email: "tester@example.com", name: "Tester", plan: "free" } });
    }

    const key = (req.headers.get("authorization") || "").replace(/^Bearer /, "");
    if (!keys.has(key) && key !== process.env.MOCK_KEY) return fail(401, "invalid_api_key", "Sign in again");

    if (p === "/v1/models") return json({ object: "list", data: MODELS });
    if (p === "/v1/me") return json({ account: { id: "acc_mock", email: "tester@example.com", plan: "free" }, plan: "free", quota: { unit: "tokens", used, limit: 200_000, resets_at: new Date(new Date().setHours(24, 0, 0, 0)).toISOString() }, dashboard_url: `http://127.0.0.1:${port}/`, features: { web_search: true, web_fetch: true }, web: { searches_used: web.searches, searches_limit: 100, fetches_used: web.fetches, fetches_limit: 200 } });
    if (p === "/v1/search" && req.method === "POST") {
      const b = await req.json();
      console.log(`search: ${b.query} news=${b.news} recency=${b.recency}`);
      web.searches++;
      return json({ query: b.query, answer: null, results: [
        { title: "Harga kopi naik pekan ini", url: "https://contoh.co.id/kopi", snippet: "Harga kopi arabika naik 8%.", published_at: new Date().toISOString(), source: "contoh.co.id" },
        { title: "Ekspor kopi Indonesia", url: "https://berita.id/ekspor", snippet: "Ekspor naik.", published_at: null, source: "berita.id" },
      ] });
    }
    if (p === "/v1/fetch" && req.method === "POST") {
      const b = await req.json();
      if (!/^https?:\/\//.test(b.url) || /127\.0\.0\.1|localhost|169\.254/.test(b.url)) return fail(400, "url_not_allowed", "Alamat itu tidak boleh dibuka.");
      web.fetches++;
      return json({ url: b.url, title: "Halaman contoh", text: "# Isi halaman\n\nTeks contoh.", published_at: null, truncated: false });
    }
    if (p === "/v1/keys/current" && req.method === "DELETE") { keys.delete(key); return new Response(null, { status: 204 }); }

    if (p === "/v1/chat/completions" && req.method === "POST") {
      const body = await req.json();
      if (!MODELS.some((m) => m.id === body.model)) return fail(403, "model_not_allowed", `${body.model} isn’t on your plan`);
      console.log(`chat ${body.model}: ${body.messages.length} messages, ${(body.tools || []).length} tools`);
      if (process.env.UPSTREAM_URL) {
        const r = await fetch(process.env.UPSTREAM_URL.replace(/\/$/, "") + "/v1/chat/completions", {
          method: "POST",
          headers: { "content-type": "application/json", authorization: `Bearer ${process.env.UPSTREAM_KEY || ""}` },
          body: JSON.stringify({ ...body, model: process.env.UPSTREAM_MODEL || body.model, stream: false }),
        });
        return new Response(await r.text(), { status: r.status, headers: { "content-type": "application/json" } });
      }
      used += 100;
      const msg = canned(body.messages);
      if (body.stream) {
        // (as the router streams: the text a few characters at a time, a tool call's arguments in two pieces, usage last)
        const enc = new TextEncoder();
        const chunk = (delta: object) => enc.encode(`data: ${JSON.stringify({ id: "chatcmpl-mock", object: "chat.completion.chunk", choices: [{ index: 0, delta }] })}\n\n`);
        return new Response(new ReadableStream({
          async start(c) {
            const text = String(msg.content || "");
            for (let i = 0; i < text.length; i += 4) {
              c.enqueue(chunk({ content: text.slice(i, i + 4) }));
              await Bun.sleep(30);
            }
            (msg.tool_calls || []).forEach((t: any, index: number) => {
              const a = t.function.arguments;
              c.enqueue(chunk({ tool_calls: [{ index, id: t.id, type: "function", function: { name: t.function.name, arguments: a.slice(0, 5) } }] }));
              c.enqueue(chunk({ tool_calls: [{ index, function: { arguments: a.slice(5) } }] }));
            });
            c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [], usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 } })}\n\ndata: [DONE]\n\n`));
            c.close();
          },
        }), { headers: { "content-type": "text/event-stream" } });
      }
      return json({ id: "chatcmpl-mock", object: "chat.completion", model: body.model, choices: [{ index: 0, message: msg, finish_reason: "stop" }], usage: { prompt_tokens: 80, completion_tokens: 20, total_tokens: 100 } });
    }
    return new Response("not found", { status: 404 });
  },
});
console.log(`mock AI router on http://127.0.0.1:${port}`);
