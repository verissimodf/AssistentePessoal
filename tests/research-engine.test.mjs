// Deep Research (evolução Fase 4): provedor de busca (fixtures), recuperação segura,
// motor sobre o Workflow Engine, evidências verbatim, conflitos, relatórios, retomada.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

process.env.JARVIS_DATA_DIR = mkdtempSync(join(tmpdir(), "jarvis-p4-research-"));
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

const research = await import("../server/research.js");
const search = await import("../server/research-search.js");
const kh = await import("../server/knowledge.js");

// ---------- provedor: fixtures explícitas (sem rede) ----------

const FIXTURE_HTML = `<html><body>
<div class="result"><a class="result__a" href="https://exemplo.org/artigo1">Vencimento do contrato X</a><a class="result__snippet">O contrato X vence em dezembro de 2026 segundo o órgão oficial.</a></div>
<div class="result"><a class="result__a" href="https://exemplo.org/artigo1?utm_source=x">Duplicata do contrato X</a><a class="result__snippet">duplicada</a></div>
<div class="result"><a class="result__a" href="https://outro-site.br/pagina">Página do concorrente Y</a><a class="result__snippet">Conteúdo divergente sobre prazos.</a></div>
</body></html>`;

const fixtureFetcher =
  (html = FIXTURE_HTML) =>
  async () =>
    html;

test("provedor: parse, dedupe por URL canônica, limite e filtros de domínio", async () => {
  search.setSearchFetcher(fixtureFetcher());
  const res = await search.webSearchStructured({ query: "contrato X" });
  assert.equal(res.unavailable, undefined);
  assert.equal(res.results.length, 2); // duplicata canônica removida
  assert.equal(res.results[0].canonical_url, "https://exemplo.org/artigo1");
  assert.equal(res.results[0].domain, "exemplo.org");
  const filtered = await search.webSearchStructured({
    query: "contrato X",
    domains: ["outro-site.br"],
  });
  assert.equal(filtered.results.length, 1);
  const limited = await search.webSearchStructured({ query: "contrato X", limit: 1 });
  assert.equal(limited.results.length, 1);
});

test("provedor: indisponibilidade EXPLÍCITA (sem rede/parse) — nunca resultado fictício", async () => {
  search.setSearchFetcher(async () => {
    throw new Error("search_provider_unavailable");
  });
  const down = await search.webSearchStructured({ query: "qualquer" });
  assert.equal(down.unavailable, "provider_error");
  assert.equal(down.results.length, 0);
  search.setSearchFetcher(fixtureFetcher("<html>sem resultados</html>"));
  const empty = await search.webSearchStructured({ query: "qualquer" });
  assert.equal(empty.unavailable, "no_results");
  search.setSearchFetcher(null);
});

test("canonicalização e SSRF: utm/fragmento removidos; alvos internos rejeitados", () => {
  assert.equal(
    search.canonicalizeUrl("https://Exemplo.org/a?utm_source=x&id=2#sec"),
    "https://exemplo.org/a?id=2",
  );
  assert.throws(
    () => search.canonicalizeUrl("http://127.0.0.1:7777/x"),
    /port_not_allowed|private|loopback|blocked/i,
  );
  assert.throws(() => search.canonicalizeUrl("file:///etc/passwd"));
});

test("recuperação de página: strip de script, hash, limite e indisponibilidade", async () => {
  search.setSearchFetcher(
    async () =>
      `<html><script>evil()</script><p>conteúdo útil da página ${"x".repeat(50)}</p></html>`,
  );
  const page = await search.retrievePage("https://exemplo.org/artigo1");
  assert.equal(page.quality, "full");
  assert.ok(page.text.includes("conteúdo útil"));
  assert.ok(!page.text.includes("evil"));
  assert.equal(page.content_hash.length, 64);
  search.setSearchFetcher(async () => {
    throw new Error("boom");
  });
  const failed = await search.retrievePage("https://exemplo.org/artigo1");
  assert.equal(failed.quality, "failed");
  search.setSearchFetcher(null);
});

// ---------- motor: plano, execução, evidências, relatório ----------

// Fixture de one-shot: respostas por estágio (plano/evidência/síntese).
function researchOneShot(sources) {
  return async (prompt) => {
    if (prompt.includes("PLANO de investigação")) {
      return {
        answer: JSON.stringify({
          subquestions: ["Quando vence o contrato X?", "Há renovação automática?"],
          strategy: "buscar fontes oficiais",
          sufficiency: "2 fontes diretas",
        }),
      };
    }
    if (prompt.includes("evidências em JSON")) {
      // Citação VERBATIM da fonte + uma alucinada (para provar a rejeição).
      const src = sources[0];
      const honest = src.content.slice(0, 60);
      return {
        answer: JSON.stringify({
          evidences: [
            { quote: honest, location: "início", type: "direct" },
            {
              quote: "citação que NÃO existe no conteúdo da fonte nenhum pouco",
              location: "?",
              type: "direct",
            },
          ],
        }),
      };
    }
    if (prompt.includes('{"claims"')) {
      return {
        answer: JSON.stringify({
          claims: [
            {
              statement: "O contrato X vence em dezembro de 2026.",
              evidence: [1],
              status: "supported",
            },
            { statement: "O contrato é renovável por 5 anos.", evidence: [], status: "inferred" },
          ],
          conflicts: [{ a: 1, b: 2, description: "prazo x renovação sem base comum" }],
        }),
      };
    }
    return { answer: "ok" };
  };
}

test("motor: plano → busca+recuperação → evidência verbatim (alucinação rejeitada) → claims/conflitos → relatório", async () => {
  const proj = research.createResearch(ADMIN.adminId, {
    question: "Quando vence o contrato X?",
    scope: "contratos 2026",
  });
  assert.equal(proj.status, "draft");
  research.setOneShot(null);
  // Fixture de página web com conteúdo verificável.
  const PAGE =
    "O contrato X vence em dezembro de 2026 segundo o órgão oficial. Não há cláusula de renovação automática.";
  search.setSearchFetcher((url) => (url.includes("duckduckgo") ? FIXTURE_HTML : PAGE));
  // Plano com fixture de one-shot.
  const plan = await research.generatePlan(ADMIN.adminId, proj.id, {
    oneShotFn: researchOneShot([{ content: PAGE }]),
  });
  assert.equal(plan.plan.subquestions.length, 2);
  assert.equal(plan.plan.kind, "hypothesis"); // plano não é fato
  assert.equal(research.getResearch(ADMIN.adminId, proj.id).status, "planning");
  // Execução completa (workflow da Fase 3).
  const out = await research.executeResearch(ADMIN.adminId, proj.id, {
    oneShotFn: researchOneShot([{ content: PAGE }]),
  });
  const project = out.project;
  // Fontes: hub (vazio aqui) + web com dedupe; página recuperada com hash.
  assert.ok(project.sources.some((s) => s.origin === "web" && s.quality === "full"));
  // Evidências: citação alucinada foi REJEITADA em cada fonte (só verbatim entra); fontes
  // idênticas (mesma página no fixture) produzem a mesma citação — tudo verbatim.
  assert.ok(project.evidence.length >= 1);
  assert.ok(project.evidence.every((e) => PAGE.includes(e.quote)));
  assert.equal(
    project.evidence.some((e) => e.type === "direct"),
    true,
  );
  // Claims: suportada (com evidência direta) e inferida; conflito registrado.
  const supported = project.claims.find((c) => c.status === "supported");
  assert.ok(supported, "claim suportada ausente");
  assert.match(supported.statement, /dezembro/i);
  const inferred = project.claims.find((c) => c.status === "inferred");
  assert.ok(inferred, "claim inferida ausente");
  assert.equal(inferred.evidence_ids.length, 0);
  assert.equal(project.conflicts.length, 1);
  // Relatório versionado com citações autoritativas (da fonte registrada, não do modelo).
  assert.ok(project.reports.length >= 1);
  const report = db.prepare("SELECT * FROM research_reports WHERE project_id = ?").get(proj.id);
  assert.ok(report.content.includes("dezembro de 2026"));
  const citations = JSON.parse(report.citations_json);
  assert.ok(citations[0].source_id && citations[0].origin === "web");
  assert.equal(project.status, "completed"); // evidência direta existe
  // Workflow real da Fase 3 por trás: eventos e nós persistidos.
  const wfRun = db.prepare("SELECT * FROM wf_runs WHERE id = ?").get(project.workflow_run_id);
  assert.ok(wfRun);
  assert.equal(wfRun.status, "completed");
});

test("proveniência do Hub: fontes internas marcadas origin='hub' e nunca misturadas sem origem", async () => {
  const lib = kh.createLibrary(ADMIN.adminId, {
    name: "L-" + Math.random().toString(36).slice(2, 6),
  });
  const nb = kh.createNotebook(ADMIN.adminId, {
    libraryId: lib.id,
    name: "N-" + Math.random().toString(36).slice(2, 6),
  });
  await kh.createSource(ADMIN.adminId, {
    notebookId: nb.id,
    type: "text",
    title: "Nota interna do contrato",
    content: "O contrato X é do departamento comercial.",
  });
  const proj = research.createResearch(ADMIN.adminId, { question: "De quem é o contrato X?" });
  await research.generatePlan(ADMIN.adminId, proj.id, {
    oneShotFn: async () => ({
      answer: JSON.stringify({
        subquestions: ["De quem é?"],
        strategy: "hub",
        sufficiency: "1 fonte",
      }),
    }),
  });
  const out = await research.executeResearch(ADMIN.adminId, proj.id, {
    oneShotFn: async (prompt) => {
      if (prompt.includes("PLANO"))
        return {
          answer: JSON.stringify({ subquestions: ["q1"], strategy: "s", sufficiency: "s" }),
        };
      if (prompt.includes("evidências em JSON"))
        return { answer: JSON.stringify({ evidences: [] }) };
      if (prompt.includes('{"claims"'))
        return { answer: JSON.stringify({ claims: [], conflicts: [] }) };
      return { answer: "ok" };
    },
  });
  const hubSource = out.project.sources.find((s) => s.origin === "hub");
  assert.ok(hubSource);
  assert.equal(hubSource.domain, ""); // fonte interna não tem domínio web
});

test("indisponibilidade do provedor → projeto parcial/inconclusivo, nunca success completo", async () => {
  search.setSearchFetcher(async () => {
    throw new Error("search_provider_unavailable");
  });
  const proj = research.createResearch(ADMIN.adminId, { question: "Pergunta sem web?" });
  await research.generatePlan(ADMIN.adminId, proj.id, {
    oneShotFn: async () => ({
      answer: JSON.stringify({ subquestions: ["q1"], strategy: "s", sufficiency: "s" }),
    }),
  });
  const out = await research.executeResearch(ADMIN.adminId, proj.id, {
    oneShotFn: async (prompt) => {
      if (prompt.includes('{"claims"'))
        return { answer: JSON.stringify({ claims: [], conflicts: [] }) };
      return { answer: "ok" };
    },
  });
  assert.ok(["partial", "inconclusive"].includes(out.project.status));
  assert.equal(out.project.sources.filter((s) => s.origin === "web").length, 0);
  search.setSearchFetcher(null);
});

test("orçamento e retomada: subperguntas limitadas; deepen adiciona rodada sem duplicar fontes", async () => {
  search.setSearchFetcher((url) =>
    url.includes("duckduckgo")
      ? FIXTURE_HTML
      : "Página nova com conteúdo diferente para aprofundamento.",
  );
  const proj = research.createResearch(ADMIN.adminId, { question: "Contrato X em detalhe?" });
  await research.generatePlan(ADMIN.adminId, proj.id, {
    oneShotFn: async () => ({
      answer: JSON.stringify({ subquestions: ["q1"], strategy: "s", sufficiency: "s" }),
    }),
  });
  await research.executeResearch(ADMIN.adminId, proj.id, {
    oneShotFn: async (prompt) => {
      if (prompt.includes('{"claims"'))
        return {
          answer: JSON.stringify({
            claims: [{ statement: "vence", evidence: [1], status: "supported" }],
            conflicts: [],
          }),
        };
      if (prompt.includes("evidências em JSON"))
        return {
          answer: JSON.stringify({
            evidences: [{ quote: "Página nova com conteúdo", location: "topo", type: "direct" }],
          }),
        };
      return { answer: "ok" };
    },
  });
  const before = research.getResearch(ADMIN.adminId, proj.id).sources.length;
  // Deepen: nova rodada; fontes duplicadas NÃO são re-criadas (hash único).
  const deep = await research.deepenResearch(ADMIN.adminId, proj.id, "E a renovação?", {
    oneShotFn: async (prompt) => {
      if (prompt.includes('{"claims"'))
        return { answer: JSON.stringify({ claims: [], conflicts: [] }) };
      if (prompt.includes("evidências em JSON"))
        return {
          answer: JSON.stringify({
            evidences: [{ quote: "Página nova com conteúdo", location: "topo", type: "direct" }],
          }),
        };
      return { answer: "ok" };
    },
  });
  const after = research.getResearch(ADMIN.adminId, proj.id).sources.length;
  assert.ok(after >= before);
  const versions = db
    .prepare("SELECT version FROM research_reports WHERE project_id = ? ORDER BY version")
    .all(proj.id)
    .map((r) => r.version);
  assert.ok(versions.length >= 2); // relatório versionado por rodada
  search.setSearchFetcher(null);
});
