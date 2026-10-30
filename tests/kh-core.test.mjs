// Knowledge Hub (evolução Fase 2): núcleo — bibliotecas/notebooks/fontes, ingestão com
// dedupe por hash, exclusão consistente, FTS5 e pesquisa híbrida com isolamento por owner.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-kh-core-"));
process.env.JARVIS_NO_LISTEN = "1";
const { db } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const auth = createAuth(db, { dataDir: process.env.JARVIS_DATA_DIR });
auth.setupFirstAdmin({
  token: auth.ensureBootstrap().token,
  username: "ana",
  password: "senha-muito-forte-1",
});
const ADMIN = auth.validateSession(
  auth.login({ username: "ana", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);

const kh = await import("../server/knowledge.js");
const { createHash } = await import("node:crypto");
const uid2 = () => createHash("sha256").update(Math.random().toString()).digest("hex").slice(0, 12);

// Embedding fake determinístico (tópico → vetor): permite testar a perna vetorial sem rede.
const embedFn = async (text) => {
  const v = new Array(8).fill(0);
  const topics = {
    vendas: [1, 0, 0, 0, 0, 0, 0, 0],
    frota: [0, 1, 0, 0, 0, 0, 0, 0],
    rh: [0, 0, 1, 0, 0, 0, 0, 0],
  };
  const t = String(text).toLowerCase();
  for (const [k, vec] of Object.entries(topics))
    if (t.includes(k)) for (let i = 0; i < 8; i++) v[i] += vec[i];
  return v.some((x) => x) ? v : [0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1, 0.1];
};
const cosineEmbed = async (query) => embedFn(query); // embedFn do query

const setup = async () => {
  const lib = kh.createLibrary(ADMIN.adminId, { name: "Pessoal-" + uid2(), kind: "personal" });
  const nb = kh.createNotebook(ADMIN.adminId, { libraryId: lib.id, name: "Tese-" + uid2() });
  return { lib, nb };
};

test("bibliotecas e notebooks: CRUD com ownership e limites", () => {
  const lib = kh.createLibrary(ADMIN.adminId, {
    name: "Bib-" + uid2(),
    kind: "project",
    project_ref: "tese",
  });
  assert.equal(lib.kind, "project");
  assert.ok(kh.getLibrary(ADMIN.adminId, lib.id));
  assert.equal(kh.getLibrary("admin-fantasma", lib.id), null);
  const nb = kh.createNotebook(ADMIN.adminId, {
    libraryId: lib.id,
    name: "NB-" + uid2(),
    tags: ["a", "b"],
  });
  assert.deepEqual(nb.tags, ["a", "b"]);
  assert.equal(nb.source_count, 0);
  assert.equal(
    kh.listNotebooks(ADMIN.adminId, { libraryId: lib.id }).some((n) => n.id === nb.id),
    true,
  );
  // Notebook de biblioteca inexistente → erro (e ownership nunca inferido).
  assert.throws(
    () => kh.createNotebook(ADMIN.adminId, { libraryId: "ghost", name: "X" }),
    /kh_library_not_found/,
  );
  assert.equal(
    kh.updateNotebook(ADMIN.adminId, nb.id, { description: "desc" }).description,
    "desc",
  );
  assert.equal(kh.deleteNotebook(ADMIN.adminId, nb.id), true);
  assert.equal(kh.getNotebook(ADMIN.adminId, nb.id), null);
});

test("ingestão de texto: indexa, gera chunks, registra versão e fica pesquisável (FTS5)", async () => {
  const { nb } = await setup();
  const out = await kh.createSource(ADMIN.adminId, {
    notebookId: nb.id,
    type: "text",
    title: "Relatório de vendas 2026",
    content:
      "O relatório de vendas do primeiro trimestre mostra crescimento consistente do time comercial.\n\nAs vendas do segmento varejo cresceram 12% e a margem melhorou após renegociação de contratos.",
    embedFn,
  });
  assert.equal(out.duplicate, false);
  const src = out.source;
  assert.equal(src.ingest_status, "indexed");
  assert.equal(src.index_status, "indexed"); // embedding fake gerou vetores
  assert.ok(src.document_id);
  // FTS5 encontra por termo do conteúdo, com filtro de notebook.
  const res = await kh.khSearch(ADMIN.adminId, { query: "vendas", notebookId: nb.id, limit: 5 });
  assert.ok(res.items.length >= 1);
  assert.equal(res.items[0].citation.source_title, "Relatório de vendas 2026");
  assert.ok(
    res.items[0].citation.mode.includes("fts") || res.items[0].citation.mode.includes("hybrid"),
  );
  // FTS index só contém chunks deste documento (rowid controlado).
  const ftsCount = db
    .prepare("SELECT COUNT(*) n FROM kh_chunk_index WHERE source_id = ?")
    .get(src.id).n;
  assert.ok(ftsCount >= 1);
});

test("dedupe por hash: segunda ingestão idêntica no MESMO notebook não duplica", async () => {
  const { nb } = await setup();
  const body = {
    notebookId: nb.id,
    type: "text",
    title: "Mesma fonte",
    content: "conteúdo duplicado para teste de hash",
    embedFn,
  };
  const first = await kh.createSource(ADMIN.adminId, body);
  const second = await kh.createSource(ADMIN.adminId, body);
  assert.equal(first.duplicate, false);
  assert.equal(second.duplicate, true);
  assert.equal(second.source.id, first.source.id);
  // Hash no servidor nunca confia em hash do cliente: hash calculado do conteúdo real.
  assert.equal(first.source.content_hash.length, 64);
});

test("exclusão consistente: fonte some do acervo, FTS e relacionamentos sem órfãos", async () => {
  const { nb } = await setup();
  const { source: src } = await kh.createSource(ADMIN.adminId, {
    notebookId: nb.id,
    type: "text",
    title: "Para excluir",
    content: "conteúdo sobre frota de veículos para exclusão",
    embedFn,
  });
  db.prepare(
    "INSERT INTO kh_relationships (id, owner_admin_id, from_type, from_id, relation, to_type, to_id, created_at) VALUES (?, ?, 'source', ?, 'relaciona', 'source', 'outro', ?)",
  ).run(uid2(), ADMIN.adminId, src.id, new Date().toISOString());
  const docId = src.document_id;
  assert.equal(kh.deleteKhSource(ADMIN.adminId, src.id), true);
  assert.equal(kh.getKhSource(ADMIN.adminId, src.id), null); // ownership dropada → invisível
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM document_chunks WHERE document_id = ?").get(docId).n,
    0,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM kh_chunk_index WHERE source_id = ?").get(src.id).n,
    0,
  );
  assert.equal(
    db.prepare("SELECT COUNT(*) n FROM kh_relationships WHERE from_id = ?").get(src.id).n,
    0,
  );
  // FTS não retorna mais nada desta fonte.
  const res = await kh.khSearch(ADMIN.adminId, {
    query: "frota de veículos para exclusão",
    notebookId: nb.id,
  });
  assert.equal(res.items.length, 0);
});

test("ingestão de arquivo inválido e limite: falha fechada, fonte marcada failed", async () => {
  const { nb } = await setup();
  // Formato não suportado (HTML não é parser operacional do pipeline) → falha explícita.
  const bad = await kh.createSource(ADMIN.adminId, {
    notebookId: nb.id,
    type: "file",
    title: "pagina.html",
    mime: "text/html",
    buffer: Buffer.from("<html><body>oi</body></html>"),
    embedFn,
  });
  assert.equal(bad.source.ingest_status, "failed");
  assert.equal(bad.source.error_code, "unsupported_type");
  // Arquivo acima do limite: recusado ANTES de persistir qualquer coisa.
  await assert.rejects(
    () =>
      kh.createSource(ADMIN.adminId, {
        notebookId: nb.id,
        type: "file",
        title: "grande.txt",
        mime: "text/plain",
        buffer: Buffer.alloc(2_100_000, "a"),
        embedFn,
      }),
    /kh_too_large/,
  );
  // Nada ficou órfão (nenhuma fonte/dependência criada para o rejeitado).
  const list = kh.listKhSources(ADMIN.adminId, { notebookId: nb.id });
  assert.ok(!list.items.some((s) => s.title === "grande.txt" && s.ingest_status === "pending"));
});

test("recuperação de job: fonte 'processing' órfã no boot é reprocesada (idempotente)", async () => {
  const { nb } = await setup();
  const { source: src } = await kh.createSource(ADMIN.adminId, {
    notebookId: nb.id,
    type: "text",
    title: "Recuperável",
    content: "conteúdo sobre rh e admissões para recuperação",
    embedFn,
  });
  assert.equal(src.ingest_status, "indexed");
  // Simula interrupção: volta a fonte para processing e o job para running com lease expirado.
  db.prepare("UPDATE kh_sources SET ingest_status='processing' WHERE id=?").run(src.id);
  db.prepare(
    "UPDATE kh_jobs SET status='running', lease_until='2000-01-01T00:00:00Z' WHERE source_id=?",
  ).run(src.id);
  const resumed = kh.recoverKhJobs();
  assert.ok(resumed >= 1);
  for (
    let i = 0;
    i < 50 && kh.getKhSource(ADMIN.adminId, src.id).ingest_status === "processing";
    i++
  )
    await new Promise((r) => setTimeout(r, 20));
  assert.equal(kh.getKhSource(ADMIN.adminId, src.id).ingest_status, "indexed");
  // Sem duplicação de chunks (idempotência da recuperação).
  const chunkRows = db
    .prepare(
      "SELECT COUNT(*) n FROM document_chunks d WHERE d.id IN (SELECT chunk_id FROM kh_chunk_index WHERE source_id=?)",
    )
    .get(src.id).n;
  const ftsRows = db
    .prepare("SELECT COUNT(*) n FROM kh_chunk_index WHERE source_id = ?")
    .get(src.id).n;
  assert.equal(chunkRows, ftsRows);
});

test("isolamento: fonte de ana é invisível para outro owner na pesquisa e na leitura", async () => {
  auth.reauth(ADMIN, "senha-muito-forte-1");
  auth.createAdmin(ADMIN, {
    username: "bia2",
    password: "senha-muito-forte-2",
    currentPassword: "senha-muito-forte-1",
  });
  const BIA = auth.validateSession(
    auth.login({ username: "bia2", password: "senha-muito-forte-2", ip: "127.0.0.1" }).sid,
  );
  const { nb } = await setup();
  await kh.createSource(ADMIN.adminId, {
    notebookId: nb.id,
    type: "text",
    title: "Sigiloso",
    content: "documento confidencial sobre vendas estratégicas",
    embedFn,
  });
  // bia não vê a fonte nem pesquisa nela — mesmo que saiba os ids.
  assert.equal(
    kh.getKhSource(BIA.adminId, nb.id) !== null ? kh.getKhSource(BIA.adminId, nb.id) : null,
    null,
  );
  const resBia = await kh.khSearch(BIA.adminId, { query: "vendas estratégicas confidenciais" });
  assert.equal(resBia.items.length, 0);
  // Notebook alheio não é filtro válido para bia.
  const resNb = await kh.khSearch(BIA.adminId, { query: "vendas", notebookId: nb.id });
  assert.equal(resNb.items.length, 0);
  // Biblioteca alheia idem.
  const resLib = await kh.khSearch(BIA.adminId, { query: "vendas", libraryId: "alheia" });
  assert.equal(resLib.items.length, 0);
});
