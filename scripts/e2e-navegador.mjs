// E2E de navegador (Fase 2) via Chrome CDP — executado por `scripts/e2e-navegador.sh`, que
// sobe uma instância ISOLADA (API + painel) e fornece `E2E_BOOTSTRAP_TOKEN`/`E2E_PASSWORD`.
// Requer `google-chrome` no PATH e `.output/server/index.mjs` (build do painel) presente.
// E2E de navegador (Fase 2) via Chrome CDP — instância ISOLADA com dados de teste criados aqui.
// O "browser-user"/CLI de browser não está instalado neste ambiente; usamos Chrome headless puro.
// Cenários: primeiro acesso (token de bootstrap) → login → navegação → foco da sessão gravado e
// persistente após recarga → proveniência sem valores → estado offline/gate de sessão.
// Cada cenário é registado como pass/fail/blocked com o detalhe observado (nunca segredos).
const BASE_PANEL = process.env.E2E_PANEL || "http://127.0.0.1:7912";
const BASE_API = process.env.E2E_API || "http://127.0.0.1:7911";
const CDP = process.env.E2E_CDP || "http://127.0.0.1:9222";
const BOOTSTRAP = process.env.E2E_BOOTSTRAP_TOKEN || "";
const PW = process.env.E2E_PASSWORD || "";

const results = [];
const record = (scenario, status, detail) => {
  results.push({ scenario, status, detail });
  console.log(`${status.toUpperCase().padEnd(7)} ${scenario}${detail ? " — " + detail : ""}`);
};

// ---------- CDP ----------
let seq = 0;
const pending = new Map();
const ws = new WebSocket(
  (await (await fetch(`${CDP}/json/new?about:blank`, { method: "PUT" })).json())
    .webSocketDebuggerUrl,
);
await new Promise((res, rej) => {
  ws.onopen = res;
  ws.onerror = rej;
});
ws.onmessage = (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    const { res, rej } = pending.get(m.id);
    pending.delete(m.id);
    m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result);
  }
};
const send = (method, params = {}) =>
  new Promise((res, rej) => {
    const id = ++seq;
    pending.set(id, { res, rej });
    ws.send(JSON.stringify({ id, method, params }));
  });
await send("Page.enable");
await send("Runtime.enable");

const evalJs = async (expression) => {
  const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (r.exceptionDetails) return { error: r.exceptionDetails.text || "exception" };
  return r.result?.value;
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(expression, timeoutMs = 10000, everyMs = 250) {
  const t0 = Date.now();
  while (Date.now() - t0 < timeoutMs) {
    const v = await evalJs(expression);
    if (v === true) return true;
    await sleep(everyMs);
  }
  return false;
}
async function navigate(url) {
  await send("Page.navigate", { url });
  await sleep(1200);
}
const screenshot = async (name) => {
  const { data } = await send("Page.captureScreenshot", { format: "png" });
  const { writeFileSync, mkdirSync } = await import("node:fs");
  const { tmpdir } = await import("node:os");
  const { join } = await import("node:path");
  const outDir = join(tmpdir(), "jarvis-e2e");
  mkdirSync(outDir, { recursive: true });
  writeFileSync(join(outDir, `e2e-${name}.png`), Buffer.from(data, "base64"));
};
// Preencher inputs controlados por React (setter nativo + evento input).
const setInputs = (pairs) => {
  const code = `
    (() => {
      const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
      const pairs = ${JSON.stringify(pairs)};
      for (const [sel, val] of pairs) {
        const el = document.querySelector(sel);
        if (!el) return "sem elemento: " + sel;
        set.call(el, val);
        el.dispatchEvent(new Event("input", { bubbles: true }));
      }
      return true;
    })()`;
  return evalJs(code);
};
const text = () => evalJs("document.body.innerText");

// ---------- 1. Gate de sessão antes do primeiro acesso ----------
await navigate(BASE_PANEL);
// O painel aponta para a API pela porta 7777 em hosts loopback; num ensaio isolado redirecionamos
// o "bridge" para a instância de teste (o mesmo que o operador faria via interface/localStorage).
await evalJs(`localStorage.setItem("jarvis.bridge", ${JSON.stringify(BASE_API)}); true`);
await navigate(BASE_PANEL);
const setupShown = await waitFor(`document.body.innerText.includes("Primeiro acesso")`, 8000);
record(
  "gate: primeiro acesso exibido sem sessão",
  setupShown ? "pass" : "fail",
  setupShown
    ? "ecrã 'Primeiro acesso' com token/usuário/senha"
    : `não encontrou o ecrã de setup; página=${JSON.stringify(((await text()) || "").slice(0, 160))}`,
);

// Sem sessão, as rotas autenticadas devolvem 401 (mesmo do navegador).
const unauth = await evalJs(
  `fetch(${JSON.stringify(BASE_API + "/api/session-focus")}, {credentials:"include"}).then(r=>r.status).catch(e=>"erro:"+e)`,
);
record("api: /api/session-focus sem sessão", unauth === 401 ? "pass" : "fail", `status=${unauth}`);

// ---------- 2. Primeiro acesso real pelo formulário ----------
const setOk = await setInputs([
  ['input[aria-label="Código de configuração"]', BOOTSTRAP],
  ['input[aria-label="Usuário"]', "e2eadmin"],
  ['input[aria-label="Senha (mínimo 12 caracteres)"]', PW],
  ['input[aria-label="Confirmar senha"]', PW],
]);
await evalJs(`document.querySelector('button[type="submit"]').click()`);
const loggedIn = await waitFor(
  `!document.body.innerText.includes("Primeiro acesso") && document.body.innerText.includes("Visão geral")`,
  15000,
);
record(
  "setup: cria o 1º administrador e entra no painel",
  setOk === true && loggedIn ? "pass" : "fail",
  loggedIn ? "painel autenticado após o formulário" : `inputs=${setOk}`,
);
await screenshot("01-visao-geral");

// ---------- 3. Foco da sessão: gravar e persistir após recarga ----------
await navigate(`${BASE_PANEL}/visao-geral`);
const focusCard = await waitFor(
  `!!document.querySelector('textarea[aria-label="Objetivo"]')`,
  12000,
);
if (focusCard) {
  await evalJs(`
    (() => {
      const ta = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
      const obj = document.querySelector('textarea[aria-label="Objetivo"]');
      ta.call(obj, "E2E: verificar a persistência do foco");
      obj.dispatchEvent(new Event("input", { bubbles: true }));
      return true;
    })()`);
  await evalJs(
    `Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Salvar")?.click()`,
  );
  const saved = await waitFor(`document.body.innerText.includes("Guardado")`, 8000);
  await navigate(`${BASE_PANEL}/visao-geral`);
  const persisted = await waitFor(
    `document.querySelector('textarea[aria-label="Objetivo"]')?.value === "E2E: verificar a persistência do foco"`,
    12000,
  );
  const afterTxt = ((await text()) || "").replace(/\s+/g, " ").slice(0, 260);
  await screenshot("02-apos-recarga");
  record(
    "foco da sessão: gravar (PUT+CSRF) e persistir após recarga",
    saved && persisted ? "pass" : "fail",
    persisted
      ? `gravado=${saved} persistente=${persisted}`
      : `gravado=${saved} página=${JSON.stringify(afterTxt)}`,
  );
} else {
  record(
    "foco da sessão: gravar e persistir após recarga",
    "fail",
    "cartão de foco não encontrado",
  );
}

// ---------- 4. Pendências rotuladas como derivadas ----------
const derived = (await text())?.includes("derivado de aprovações/execuções reais");
record(
  "foco: pendências rotuladas como derivadas",
  derived ? "pass" : "fail",
  derived ? "rótulo presente na Visão geral" : "rótulo ausente",
);

// ---------- 5. Versão/commit honestos numa execução sem build metadata ----------
// Com `E2E_EXPECT_VERSION`/`E2E_EXPECT_COMMIT` (ex.: correr contra a imagem candidata, que tem
// build-info) verifica-se que os metadados REAIS aparecem; sem eles, que o painel diz
// "Não registrado" em vez de inventar.
const expectVersion = process.env.E2E_EXPECT_VERSION || "";
const expectCommit = process.env.E2E_EXPECT_COMMIT || "";
const healthText = (await text()) || "";
if (expectVersion || expectCommit) {
  const temVersao = !expectVersion || healthText.includes(expectVersion);
  const temSha = !expectCommit || healthText.includes(expectCommit.slice(0, 7));
  record(
    "build: versão e SHA reais do build exibidos (sem inventar)",
    temVersao && temSha ? "pass" : "fail",
    `versão esperada=${expectVersion || "-"} sha esperado=${(expectCommit || "-").slice(0, 12)} visíveis=${temVersao}/${temSha}`,
  );
} else {
  record(
    "build: sem metadados o painel mostra 'Não registrado' (não inventa)",
    healthText.includes("Não registrado") ? "pass" : "fail",
    healthText.includes("Não registrado")
      ? "versão/commit exibidos como 'Não registrado'"
      : "não apareceu 'Não registrado'",
  );
}

// ---------- 6. Execuções e evidências (estado vazio real) ----------
await evalJs(
  `document.querySelector('a[href="/execucoes"]')?.click() || Array.from(document.querySelectorAll("a,button")).find(e=>e.textContent.includes("Execuções"))?.click()`,
);
const exPage = await waitFor(
  `document.body.innerText.includes("Ledger por execução") || document.body.innerText.includes("Nenhuma execução registrada")`,
  8000,
);
record(
  "navegação: Execuções e evidências (estado vazio real)",
  exPage ? "pass" : "fail",
  exPage ? "título/subtítulo do ledger visível" : "conteúdo do ledger não apareceu",
);

// ---------- 7. Proveniência: aberto pela UI, sem valores ----------
await navigate(`${BASE_PANEL}/configuracoes`);
await waitFor(`document.body.innerText.includes("Diagnóstico")`, 10000);
const provTab = await waitFor(
  `Array.from(document.querySelectorAll("button")).some(b => b.textContent.trim() === "Proveniência")`,
  10000,
);
if (provTab) {
  // O Radix Tabs ativa a aba em `mousedown` (não em `click`), por isso dispatch completo do rato.
  await evalJs(`
    (() => {
      const btn = Array.from(document.querySelectorAll("button")).find(b => b.textContent.trim() === "Proveniência");
      if (!btn) return false;
      btn.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1 }));
      btn.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      btn.focus();
      btn.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      btn.click();
      return true;
    })()`);
  const provShown = await waitFor(`!!document.querySelector("table")`, 10000);
  const bodyTxt = (await text()) || "";
  const dbgStatus = await evalJs(
    `fetch(${JSON.stringify(BASE_API + "/api/settings/provenance")}, {credentials:"include"}).then(r=>r.status).catch(e=>"erro:"+e)`,
  );
  const dbgPanel = ((await text()) || "").replace(/\s+/g, " ").slice(-300);
  const noSecrets =
    !bodyTxt.includes("enc:") && !bodyTxt.includes(PW) && !bodyTxt.includes(BOOTSTRAP);
  const origins = ["padrão", "pessoal", "global"].filter((o) => bodyTxt.includes(o));
  record(
    "proveniência: tabela de origens aberta pela UI, sem valores",
    provShown && noSecrets ? "pass" : "fail",
    provShown
      ? `origens visíveis=${origins.join(",") || "nenhuma"}; sem segredos=${noSecrets}`
      : `sem tabela; endpoint=${dbgStatus}; painel=${JSON.stringify(dbgPanel)}`,
  );
  await screenshot("08-proveniencia");
} else {
  record(
    "proveniência: tabela de origens aberta pela UI, sem valores",
    "fail",
    "aba Proveniência não encontrada",
  );
}

console.log(
  "\nRESUMO:",
  JSON.stringify({
    total: results.length,
    pass: results.filter((r) => r.status === "pass").length,
    fail: results.filter((r) => r.status === "fail").length,
  }),
);
ws.close();
process.exit(results.some((r) => r.status === "fail") ? 1 : 0);
