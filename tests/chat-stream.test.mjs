// /api/chat/stream + JEV Reflex (advisory) + citações preservadas (meta.citations).
// Idêntico em espírito ao conversations.test.mjs: banco TEMPORÁRIO (JARVIS_DATA_DIR), provedor
// stub via globalThis.fetch, nenhum segredo real. O stream deve: manter as regras do /api/chat
// (persistência, idempotência, dono), emitir eventos de progresso/reflex e terminar em `final`.
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { randomUUID } from "node:crypto";

const dir = mkdtempSync(join(tmpdir(), "jarvis-stream-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";

const { auth, db, now } = await import("../server/db.js");
const { tx } = await import("../server/ownership.js");
const { updateSettings } = await import("../server/settings.js");
const { createApp } = await import("../server/index.js");

const PW = "senha-muito-forte-1";
const ORIGIN = "http://localhost:8080";
let server, base, SA, adminA;
let agentCalls = 0,
  mode = { reflex: "ok", agent: "echo" };

// Stub: rotas JEV (system contém "roteador JEV") → JSON estruturado; demais → eco do agente.
const realFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = typeof input === "string" ? input : input.url;
  if (!url.includes("/chat/completions")) return realFetch(input, init);
  const body = init?.body ? JSON.parse(String(init.body)) : {};
  const isReflex = String(body.messages?.[0]?.content || "").includes("roteador JEV");
  if (isReflex) {
    if (mode.reflex === "ok")
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '```json\n{"route":"task","complete":true,"addressed":true,"action":false,"coverage":"já abordado","confidence":0.86}\n```',
              },
            },
          ],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    return new Response("reflex fora do ar", { status: 500 });
  }
  agentCalls++;
  if (mode.agent === "fail") return new Response("falha simulada do provedor", { status: 500 });
  if (mode.agent === "tool:document_search" && agentCalls % 2 === 1)
    return new Response(
      JSON.stringify({
        choices: [
          {
            message: {
              role: "assistant",
              content: "",
              tool_calls: [
                {
                  id: `call_${agentCalls}`,
                  type: "function",
                  function: {
                    name: "document_search",
                    arguments: JSON.stringify({ query: "orchestrador alfa" }),
                  },
                },
              ],
            },
          },
        ],
      }),
      { status: 200, headers: { "content-type": "application/json" } },
    );
  return new Response(
    JSON.stringify({ choices: [{ message: { role: "assistant", content: `eco-${agentCalls}` } }] }),
    { status: 200, headers: { "content-type": "application/json" } },
  );
};

const req = (path, { method = "GET", body, s, csrf = true } = {}) =>
  fetch(base + path, {
    method,
    headers: {
      origin: ORIGIN,
      ...(body !== undefined ? { "content-type": "application/json" } : {}),
      ...(s ? { cookie: s.cookie, ...(csrf ? { "x-jarvis-csrf": s.csrf } : {}) } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

const login = async (username, password) => {
  const r = await req("/api/auth/login", { method: "POST", body: { username, password } });
  const j = await r.json();
  return {
    cookie: (r.headers.get("set-cookie") || "").split(";")[0],
    csrf: j.csrf,
    id: j.admin.id,
  };
};

/** Uma troca via stream → lista de eventos NDJSON + corpo bruto. */
const stream = async (s, body) => {
  const r = await req("/api/chat/stream", { method: "POST", body, s });
  const text = await r.text();
  const events = text
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return { type: "non_json" };
      }
    });
  return { status: r.status, ctype: r.headers.get("content-type") || "", events, text };
};

const getConv = (s, id) => req(`/api/conversations/${id}`, { s });

before(async () => {
  server = createApp();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${server.address().port}`;
  auth.setupFirstAdmin({ token: auth.ensureBootstrap().token, username: "ana", password: PW });
  SA = await login("ana", PW);
  adminA = SA.id;
  updateSettings(
    { providers: { ollama: { enabled: false, model: "stub-model" } } },
    { adminId: adminA },
  );
});
after(async () => {
  await new Promise((r) => server.close(r));
});

// ---------- rota /api/chat/stream ----------

test("stream sem sessão: 401 (choke-point)", async () => {
  assert.equal(
    (await req("/api/chat/stream", { method: "POST", body: { message: "oi" } })).status,
    401,
  );
});

test("stream: formato legado (messages) é recusado com 400 dedicado", async () => {
  const r = await req("/api/chat/stream", {
    method: "POST",
    body: { messages: [{ role: "user", content: "oi" }] },
    s: SA,
  });
  const j = await r.json();
  assert.equal(r.status, 400);
  assert.equal(j.error, "stream_unsupported_legacy");
});

test("stream: validação pós-stream preserva o status HTTP correto (mensagem vazia → 400)", async () => {
  const r = await req("/api/chat/stream", { method: "POST", body: { message: "   " }, s: SA });
  assert.equal(r.status, 400);
  const j = await r.json();
  assert.equal(j.error, "empty_message");
});

test("stream echo: progresso de step, evento final completo e persistência igual ao /api/chat", async () => {
  const cmid = randomUUID();
  const { status, ctype, events } = await stream(SA, {
    message: "olá teste de stream",
    clientMsgId: cmid,
  });
  assert.equal(status, 200);
  assert.equal(ctype, "application/x-ndjson");
  const last = events.at(-1);
  assert.equal(last.type, "final");
  assert.equal(last.exchange.reply, "eco-1");
  assert.equal(last.exchange.reflex, null); // Reflex desativado por padrão (opt-in)
  assert.ok(events.some((e) => e.type === "progress" && typeof e.step === "number"));
  // Persistência idêntica: conversa + duas mensagens, assistant apontando para a user (reply_to).
  const convId = last.exchange.conversation.id;
  const g = await getConv(SA, convId);
  const gj = await g.json();
  assert.equal(gj.messages.length, 2);
  assert.equal(gj.messages[0].role, "user");
  assert.equal(gj.messages[1].role, "assistant");
  assert.equal(gj.messages[1].content, "eco-1");
  // Reenvio do mesmo clientMsgId via stream: idempotência (só `final`, sem nova chamada de modelo).
  const calls0 = agentCalls;
  const again = await stream(SA, { message: "olá teste de stream", clientMsgId: cmid });
  assert.equal(again.events.at(-1).exchange.duplicate, true);
  assert.equal(agentCalls, calls0);
});

test("stream reflex ok: evento reflex (source jev) + meta.reflex persistida na mensagem", async () => {
  updateSettings({ reflex: { enabled: true, model: "stub-jev" } }, { adminId: adminA });
  const { events } = await stream(SA, {
    message: "crie uma tarefa de componentes de teste spec alpha",
    clientMsgId: randomUUID(),
  });
  const reflexEv = events.find((e) => e.type === "reflex");
  assert.ok(reflexEv, "evento reflex deve existir");
  assert.equal(reflexEv.reflex.source, "jev");
  assert.equal(reflexEv.reflex.route, "task");
  assert.equal(reflexEv.reflex.confidence, 0.86);
  assert.ok(reflexEv.reflex.latencyMs >= 0 && typeof reflexEv.reflex.model === "string");
  const last = events.at(-1);
  assert.equal(last.type, "final");
  assert.equal(last.exchange.reflex.route, "task");
  // Persistência em meta.reflex (sobrevive à recarga da conversa):
  const g = await req(`/api/conversations/${last.exchange.conversation.id}`, { s: SA });
  const meta = (await g.json()).messages.at(-1).meta;
  assert.equal(meta.reflex.route, "task");
  assert.equal(meta.reflex.source, "jev");
  // Falha do roteador com reflex ligado: fallback explícito, chat segue NORMAL (final existe).
  mode.reflex = "fail";
  const fb = await stream(SA, {
    message: "segunda mensagem com reflex caído",
    clientMsgId: randomUUID(),
  });
  const fEv = fb.events.find((e) => e.type === "reflex");
  assert.equal(fEv.reflex.source, "fallback");
  assert.equal(fb.events.at(-1).type, "final");
  assert.equal(fb.events.at(-1).exchange.reflex.source, "fallback");
  mode.reflex = "ok";
  updateSettings({ reflex: { enabled: false } }, { adminId: adminA });
});

test("stream falha do provedor: evento error com código estruturado (sem resposta falsa)", async () => {
  mode.agent = "fail";
  const { events } = await stream(SA, {
    message: "mensagem que vai falhar",
    clientMsgId: randomUUID(),
  });
  assert.equal(events.at(-1).type, "error");
  assert.equal(events.at(-1).code, "provider_error");
  assert.ok(!events.some((e) => e.type === "final"));
  mode.agent = "echo";
});

// ---------- citações preservadas (document_search → meta.citations) ----------

test("document_search registra evidências em ctx.citations e meta.citations persistidas", async () => {
  // Cenário de documento por SQL direto (mesmas tabelas do runtime; seed de teste):
  const docId = randomUUID();
  const chunkId = randomUUID();
  tx(() => {
    db.prepare(
      "INSERT INTO documents (id, name, mime, size, path, content_text, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(
      docId,
      "corr-alfa.md",
      "text/markdown",
      42,
      "/tmp/x",
      "O orchestrador alfa executa tarefas.",
      now(),
    );
    db.prepare(
      "INSERT INTO ownership (resource_type, resource_id, owner_admin_id, assigned_at, origin) VALUES ('document', ?, ?, ?, 'claimed')",
    ).run(docId, adminA, now());
    db.prepare(
      "INSERT INTO document_chunks (id, document_id, admin_id, chunk_index, content, token_estimate, created_at) VALUES (?,?,?,?,?,?,?)",
    ).run(chunkId, docId, adminA, 3, "O orchestrador alfa executa tarefas de BDD.", 20, now());
  });
  // Agente chama document_search na 1ª rodada e finaliza na 2ª:
  mode.agent = "tool:document_search";
  const { events } = await stream(SA, {
    message: "o que os documentos dizem sobre o orchestrador alfa?",
    clientMsgId: randomUUID(),
  });
  mode.agent = "echo";
  const last = events.at(-1);
  assert.equal(last.type, "final");
  assert.ok(Array.isArray(last.exchange.citations));
  const c = last.exchange.citations[0];
  assert.equal(c.documentId, docId);
  assert.equal(c.name, "corr-alfa.md");
  assert.equal(c.chunk_index, 3);
  assert.equal(c.search_mode, "lexical");
  // Persistido (recarga da conversa): meta.citations da mensagem assistant.
  const g = await req(`/api/conversations/${last.exchange.conversation.id}`, { s: SA });
  const msg = (await g.json()).messages.at(-1);
  assert.equal(msg.meta.citations[0].documentId, docId);
  assert.equal(msg.meta.citations[0].chunk_index, 3);
});
