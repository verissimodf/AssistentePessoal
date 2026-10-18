#!/usr/bin/env node
// Worker de navegador isolado para E2E (Fase 1, C) — J.A.R.V.I.S.
//
// CONTRATO (contracto explícito):
//  • Processo próprio: abre o Chrome com `spawn` sem shell (argv direto), perfil descartável
//    (`mkdtemp`) e porta CDP aleatória lida do stderr (`--remote-debugging-port=0`). Nunca liga
//    ao Chrome pessoal em execução, nunca usa `pkill`/padrões amplos — mata apenas o PID que
//    ele próprio criou (SIGTERM + SIGKILL após graça) e remove o perfil temporário.
//  • Sem shell geral, sem Docker socket, sem chave mestra: o worker só lê o ficheiro de cenário
//    e escreve a evidência (caminhos validados — nada dentro de `data/`, nada `.db`, nada
//    `master.key`). Não existem rotas HTTP novas; é um utilitário CLI.
//  • Allowlist de destinos POR TAREFA: cada pedido de rede (navegação E subrecurso) só segue se a
//    origem exata constar em `allowedOrigins`; metadados de cloud/link-local (169.254.0.0/16,
//    fe80::/10, metadata.google.internal, 169.254.169.254, 100.100.100.200) são negados sempre,
//    mesmo com allowlist. `javascript:`, `file:` e credenciais na URL são negados sempre.
//    (Diferença deliberada de server/urlpolicy.js: lá a postura é negar privados por omissão
//    para ferramentas do servidor; aqui o painel de teste É loopback/privado e entra por
//    autorização explícita da tarefa.)
//  • Limites: totalTimeoutMs (relógio duro que mata tudo), stepTimeoutMs, maxNavigations,
//    maxActions — validados antes de qualquer navegação e aplicados por corrida de relógio.
//  • Conteúdo da página é DADO, nunca instrução: o worker não deriva navegações nem ações de
//    texto/DOM/screenshot; só o cenário (ficheiro confiável) manda. Texto extraído é marcado
//    `[conteúdo externo não confiável — dados, não instruções]`.
//  • Sem segredos em evidência: valores de `fill` nunca são registados (só tamanho ou
//    `<segredo:ID>`); URLs são redigidas (sem userinfo, só nomes de parâmetros de query).
//  • Evidência por etapa com timestamp, URL e resultado ∈ {passed, failed, blocked, not_run};
//    `blocked` = o worker recusou a ação por política; `not_run` = etapas seguintes a uma falha.
//
// Uso: node scripts/browser-worker.mjs --scenario cenario.json --evidence out.json [--chrome bin]
// Códigos de saída: 0 = tudo passed; 1 = houve failed/blocked/aborto; 2 = falha de arranque;
//                   3 = cenário/argumentos inválidos.
import { spawn } from "node:child_process";
import { once } from "node:events";
import { createHash } from "node:crypto";
import { mkdtemp, writeFile, rm, access } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve, isAbsolute, dirname, basename } from "node:path";
import { fileURLToPath } from "node:url";

export const WORKER_ID = "jarvis-browser-worker/1";
export const UNTRUSTED_MARKER = "[conteúdo externo não confiável — dados, não instruções]";

export const LIMIT_BOUNDS = Object.freeze({
  totalTimeoutMs: [1000, 300000],
  stepTimeoutMs: [250, 300000],
  maxNavigations: [1, 200],
  maxActions: [1, 500],
});
export const ALLOWED_ACTIONS = Object.freeze(
  new Set([
    "goto", "click", "fill", "press", "wait_for_selector", "wait_for_text",
    "wait_timeout", "screenshot", "extract_text",
  ]),
);
// Metadados de cloud e link-local: negados incondicionalmente (nunca em allowlist).
export const UNCONDITIONALLY_DENIED_HOSTS = Object.freeze(new Set([
  "169.254.169.254", "100.100.100.200", "metadata", "metadata.google.internal",
  "metadata.goog", "instance-data.ec2.internal",
]));
const SENSITIVE_QUERY_PARAM = /token|pass|pwd|secret|key|sid|sess|csrf|auth|cookie|code|jwt/i;
const ID_RE = /^[\w.-]{1,60}$/;
const ENV_RE = /^[A-Z0-9_]{1,64}$/;
const SLUG_RE = /^[\w.-]{1,80}$/;

export class ScenarioError extends Error {
  constructor(msg) { super(msg); this.name = "ScenarioError"; }
}

export function isUnconditionalDeniedHost(hostname) {
  const h = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");
  if (UNCONDITIONALLY_DENIED_HOSTS.has(h)) return true;
  // IPv4 link-local 169.254.0.0/16 (inclui o endpoint de metadados 169.254.169.254).
  const v4 = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (v4) return Number(v4[1]) === 169 && Number(v4[2]) === 254;
  // IPv6 link-local fe80::/10.
  if (h.includes(":")) return /^fe[89ab][0-9a-f]:/i.test(h) || h === "fe80::";
  return false;
}

/** Normaliza e valida uma origem da allowlist (scheme://host[:porta] exato). */
export function parseAllowedOrigin(origin) {
  if (typeof origin !== "string" || !origin.trim()) throw new ScenarioError("origem vazia na allowlist");
  let u;
  try { u = new URL(origin.trim()); } catch { throw new ScenarioError(`origem inválida: ${JSON.stringify(origin)}`); }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    throw new ScenarioError(`origem com esquema não permitido: ${origin}`);
  }
  if (u.username || u.password) throw new ScenarioError(`origem não pode conter credenciais: ${origin}`);
  if (u.pathname !== "/" || u.search || u.hash) {
    throw new ScenarioError(`origem tem de ser só scheme://host[:porta]: ${origin}`);
  }
  if (isUnconditionalDeniedHost(u.hostname)) {
    throw new ScenarioError(`metadados/link-local nunca podem entrar na allowlist: ${origin}`);
  }
  return u.origin;
}

/** Política central: um destino é permitido? Devolve { allowed, reason }. */
export function isDestinationAllowed(rawUrl, allowedOrigins) {
  let u;
  try { u = new URL(String(rawUrl)); } catch {
    return { allowed: false, reason: "url inválida" };
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") {
    return { allowed: false, reason: `esquema não permitido (${u.protocol})` };
  }
  if (u.username || u.password) return { allowed: false, reason: "credenciais na URL" };
  if (isUnconditionalDeniedHost(u.hostname)) return { allowed: false, reason: "metadados/link-local bloqueados por política" };
  const allowed = new Set(allowedOrigins);
  if (!allowed.has(u.origin)) return { allowed: false, reason: `origem fora da allowlist da tarefa (${u.origin})` };
  return { allowed: true, reason: "allowlist" };
}

/** URL segura para evidência: sem userinfo, query só com NOMES de parâmetro. */
export function redactUrl(raw) {
  let u;
  try { u = new URL(String(raw)); } catch { return "<url inválida>"; }
  const names = [...u.searchParams.keys()].map((n) => (SENSITIVE_QUERY_PARAM.test(n) ? `${n}=<redigido>` : n));
  return `${u.origin}${u.pathname}${names.length ? `?${names.join("&")}` : ""}`;
}

function checkBound(name, value, [lo, hi]) {
  if (!Number.isInteger(value) || value < lo || value > hi) {
    throw new ScenarioError(`limits.${name} tem de ser inteiro em [${lo}, ${hi}] (recebido: ${JSON.stringify(value)})`);
  }
}

const stepNeedsSelector = new Set(["click", "fill", "press", "wait_for_selector"]);

/** Valida o cenário completo; lança ScenarioError com mensagem accionável. */
export function validateScenario(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) throw new ScenarioError("cenário tem de ser um objeto JSON");
  if (typeof raw.name !== "string" || !raw.name.trim() || raw.name.length > 120) {
    throw new ScenarioError("cenário.name é obrigatório (string até 120 caracteres)");
  }
  if (!Array.isArray(raw.allowedOrigins) || raw.allowedOrigins.length < 1 || raw.allowedOrigins.length > 20) {
    throw new ScenarioError("allowedOrigins: lista não vazia (1..20 origens exatas) é obrigatória");
  }
  const origins = [...new Set(raw.allowedOrigins.map(parseAllowedOrigin))];
  const limits = raw.limits && typeof raw.limits === "object" ? raw.limits : {};
  for (const [k, bound] of Object.entries(LIMIT_BOUNDS)) {
    if (!(k in limits)) throw new ScenarioError(`limits.${k} é obrigatório (contrato explícito de limites)`);
    checkBound(k, limits[k], bound);
  }
  if (limits.stepTimeoutMs > limits.totalTimeoutMs) {
    throw new ScenarioError("limits.stepTimeoutMs não pode exceder limits.totalTimeoutMs");
  }
  let secrets = [];
  if (raw.secrets != null) {
    if (!Array.isArray(raw.secrets) || raw.secrets.length > 20) throw new ScenarioError("secrets: lista (0..20) de {id, env}");
    const ids = new Set();
    for (const s of raw.secrets) {
      if (!s || typeof s !== "object" || !ID_RE.test(s.id || "") || !ENV_RE.test(s.env || "")) {
        throw new ScenarioError(`secret inválido: ${JSON.stringify(s)} (id ^[\w.-]{1,60}$, env ^[A-Z0-9_]+$)`);
      }
      if (ids.has(s.id)) throw new ScenarioError(`secret id duplicado: ${s.id}`);
      ids.add(s.id);
      secrets.push({ id: s.id, env: s.env });
    }
  }
  if (!Array.isArray(raw.steps) || raw.steps.length < 1) throw new ScenarioError("steps: lista não vazia obrigatória");
  if (raw.steps.length > limits.maxActions) {
    throw new ScenarioError(`steps (${raw.steps.length}) excede limits.maxActions (${limits.maxActions})`);
  }
  const gotos = raw.steps.filter((s) => s && s.action === "goto").length;
  if (gotos > limits.maxNavigations) {
    throw new ScenarioError(`navegações (${gotos}) excede limits.maxNavigations (${limits.maxNavigations})`);
  }
  const seen = new Set();
  const steps = raw.steps.map((s, i) => {
    if (!s || typeof s !== "object") throw new ScenarioError(`steps[${i}] tem de ser objeto`);
    if (!ID_RE.test(s.id || "")) throw new ScenarioError(`steps[${i}].id inválido`);
    if (seen.has(s.id)) throw new ScenarioError(`steps[${i}].id duplicado: ${s.id}`);
    seen.add(s.id);
    if (!ALLOWED_ACTIONS.has(s.action)) throw new ScenarioError(`steps[${i}].action não permitida: ${JSON.stringify(s.action)}`);
    if (s.timeoutMs != null && (!Number.isInteger(s.timeoutMs) || s.timeoutMs < 250 || s.timeoutMs > limits.totalTimeoutMs)) {
      throw new ScenarioError(`steps[${i}].timeoutMs inválido (250..totalTimeoutMs)`);
    }
    const step = { ...s };
    if (stepNeedsSelector.has(step.action)) {
      if (typeof step.selector !== "string" || !step.selector.trim() || step.selector.length > 500) {
        throw new ScenarioError(`steps[${i}] (${step.action}) exige selector (string até 500 caracteres)`);
      }
    }
    if (step.action === "goto") {
      if (typeof step.url !== "string" || step.url.length > 2048) throw new ScenarioError(`steps[${i}].url inválida`);
      try { new URL(step.url); } catch { throw new ScenarioError(`steps[${i}].url não é URL absoluta: ${step.url}`); }
    }
    if (step.action === "fill") {
      const hasValue = "value" in step, hasSecret = "secret" in step;
      if (hasValue === hasSecret) throw new ScenarioError(`steps[${i}] (fill) exige value OU secret (exatamente um)`);
      if (hasSecret && !secrets.some((x) => x.id === step.secret)) {
        throw new ScenarioError(`steps[${i}].secret não declarado em secrets: ${JSON.stringify(step.secret)}`);
      }
      if (hasValue && typeof step.value !== "string") throw new ScenarioError(`steps[${i}].value tem de ser string`);
    }
    if (step.action === "press" && (typeof step.key !== "string" || !/^[A-Za-z0-9]{1,20}$/.test(step.key))) {
      throw new ScenarioError(`steps[${i}].key inválida (ex.: Enter, Tab, Escape)`);
    }
    if (step.action === "wait_for_text" && (typeof step.text !== "string" || !step.text.trim())) {
      throw new ScenarioError(`steps[${i}].text obrigatório`);
    }
    if (step.action === "wait_for_selector" && (typeof step.selector !== "string" || !step.selector.trim())) {
      throw new ScenarioError(`steps[${i}].selector obrigatório`);
    }
    if (step.action === "wait_timeout" && (!Number.isInteger(step.ms) || step.ms < 0 || step.ms > 30000)) {
      throw new ScenarioError(`steps[${i}].ms tem de ser 0..30000`);
    }
    if (step.action === "screenshot" && (typeof step.name !== "string" || !SLUG_RE.test(step.name))) {
      throw new ScenarioError(`steps[${i}].name inválido para screenshot (slug)`);
    }
    if (step.action === "extract_text" && step.selector != null && (typeof step.selector !== "string" || step.selector.length > 500)) {
      throw new ScenarioError(`steps[${i}].selector inválido`);
    }
    return step;
  });
  return { name: raw.name.trim(), allowedOrigins: origins, limits, secrets, steps };
}

/** Caminhos de evidência/cenário: absolutos, nunca em data/, nunca .db/master.key. */
export function assertSafePath(p, label) {
  if (typeof p !== "string" || !isAbsolute(p)) throw new ScenarioError(`${label} tem de ser caminho absoluto`);
  const norm = resolve(p);
  // Separadores de ambos os SOs: no Windows `resolve` devolve `\` e a proteção de data/ tem de
  // funcionar lá também (não basta dividir por "/").
  const parts = norm.split(/[\\/]+/);
  if (parts.includes("data")) throw new ScenarioError(`${label} não pode estar dentro de data/ (banco/segredos): ${norm}`);
  if (parts.some((x) => x === "master.key")) throw new ScenarioError(`${label} não pode referenciar master.key`);
  if (norm.endsWith(".db")) throw new ScenarioError(`${label} não pode terminar em .db`);
  return norm;
}

// ---------------------------------------------------------------- CDP (WebSocket nativo)

function makeCdp(wsUrl, { defaultTimeoutMs } = {}) {
  let seq = 0;
  const pending = new Map();
  const handlers = new Map();
  const ws = new WebSocket(wsUrl);
  const ready = new Promise((res, rej) => {
    ws.onopen = res;
    ws.onerror = (e) => rej(new Error(`CDP ws error: ${e?.message || e?.type || "desconhecido"}`));
    ws.onclose = () => {
      const err = new Error("CDP ws fechado");
      for (const { rej: r } of pending.values()) r(err);
      pending.clear();
    };
  });
  ws.onmessage = (ev) => {
    let m;
    try { m = JSON.parse(ev.data); } catch { return; }
    if (m.id && pending.has(m.id)) {
      const { res, rej } = pending.get(m.id);
      pending.delete(m.id);
      m.error ? rej(new Error(`${m.error.message || "erro CDP"} (${m.error.code ?? ""})`)) : res(m.result);
    } else if (m.method && handlers.has(m.method)) {
      for (const fn of handlers.get(m.method)) fn(m.params);
    }
  };
  return {
    ready,
    on: (event, fn) => { if (!handlers.has(event)) handlers.set(event, []); handlers.get(event).push(fn); },
    async send(method, params = {}, timeoutMs) {
      const id = ++seq;
      const t = timeoutMs ?? defaultTimeoutMs ?? 15000;
      let timer;
      const p = new Promise((res, rej) => {
        pending.set(id, { res, rej });
        timer = setTimeout(() => {
          if (pending.has(id)) { pending.delete(id); rej(new Error(`timeout CDP ${method} (${t}ms)`)); }
        }, t);
      });
      ws.send(JSON.stringify({ id, method, params }));
      try { return await p; } finally { clearTimeout(timer); }
    },
    close() { try { ws.close(); } catch { /* já fechado */ } },
  };
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function launchChrome(chromeBin, startupMs = 20000) {
  const profileDir = await mkdtemp(join(tmpdir(), "jarvis-bw-profile-"));
  const args = [
    "--headless=new", "--remote-debugging-port=0", `--user-data-dir=${profileDir}`,
    "--no-first-run", "--disable-dev-shm-usage", "--no-sandbox", "--disable-gpu",
    "--window-size=1280,900", "--no-proxy-server", "about:blank",
  ];
  const child = spawn(chromeBin, args, { stdio: ["ignore", "pipe", "pipe"] });
  let stderr = "";
  child.stderr.on("data", (d) => { stderr += d; if (stderr.length > 200000) stderr = stderr.slice(-100000); });
  // Em qualquer falha de arranque: não deixar perfil temporário nem processo órfão para trás.
  const fail = async (msg) => {
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
    await rm(profileDir, { recursive: true, force: true }).catch(() => {});
    return new Error(msg);
  };
  const wsUrl = await new Promise((res, rej) => {
    let settled = false;
    let buf = "";
    let timer = null;
    const cleanup = () => { clearTimeout(timer); child.stderr.off("data", onData); };
    const onData = (d) => {
      buf += d;
      const m = buf.match(/DevTools listening on (ws:\/\/\S+)/);
      // CRÍTICO: limpar o timer de arranque no sucesso — senão, 20s depois, `fail()` mataria o
      // Chrome (SIGKILL) e apagaria o perfil em pleno warm-up ("CDP ws fechado").
      if (m && !settled) { settled = true; cleanup(); res(m[1]); }
    };
    child.stderr.on("data", onData);
    timer = setTimeout(() => { if (!settled) { settled = true; cleanup(); void fail(`chrome não anunciou CDP em ${startupMs}ms`).then(rej); } }, startupMs);
    child.once("error", (e) => { if (!settled) { settled = true; cleanup(); void fail(`falha ao lançar chrome (${chromeBin}): ${e.message}`).then(rej); } });
    child.once("exit", (code, sig) => {
      if (!settled) { settled = true; cleanup(); void fail(`chrome saiu antes do CDP (code=${code} sig=${sig ?? "-"})`).then(rej); }
    });
  });
  return { child, wsUrl, profileDir, stderrSoFar: () => stderr };
}

async function shutdownChrome(child, profileDir) {
  if (!child) return;
  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGTERM");
    const done = once(child, "exit").catch(() => {});
    await Promise.race([done, sleep(3000)]);
    if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  }
  await rm(profileDir, { recursive: true, force: true }).catch(() => {});
}

// ---------------------------------------------------------------- execução do cenário

const iso = () => new Date().toISOString();

async function raceStep(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, rej) => {
    timer = setTimeout(() => rej(new Error(`${label} excedeu ${ms}ms`)), ms);
  });
  try { return await Promise.race([promise, timeout]); } finally { clearTimeout(timer); }
}

async function runScenario(scenario, { chromeBin, evidencePath }) {
  const { limits, allowedOrigins, secrets, steps } = scenario;
  const startedAt = iso();
  const t0 = Date.now();
  const secretValue = (id) => {
    const def = secrets.find((s) => s.id === id);
    return def ? process.env[def.env] : undefined;
  };
  let chrome = null, cdp = null, profileDir = null, stderrRef = () => "";
  const network = { allowed: 0, blocked: [], truncated: false };
  const stepResults = [];
  const shotsDir = dirname(evidencePath) + "/shots";
  let navigations = 0, aborted = null, startupFailure = null, warmup = null;

  const totalTimer = setTimeout(() => { aborted = `relógio duro totalTimeoutMs (${limits.totalTimeoutMs}ms)`; }, limits.totalTimeoutMs);

  try {
    // ---- arranque do Chrome (perfil descartável, porta aleatória, sem shell) ----
    let launched;
    try {
      launched = await launchChrome(chromeBin);
    } catch (e) {
      startupFailure = e.message;
      throw e;
    }
    chrome = launched.child; profileDir = launched.profileDir; stderrRef = launched.stderrSoFar;

    cdp = makeCdp(launched.wsUrl, { defaultTimeoutMs: limits.stepTimeoutMs });
    await cdp.ready;
    // Alvo de página: cria via HTTP PUT (igual ao E2E oficial) e liga o WS da página.
    const httpBase = launched.wsUrl.replace(/^ws:/, "http:").replace(/\/devtools\/browser\/.*$/, "");
    const target = await (await fetch(`${httpBase}/json/new?about:blank`, { method: "PUT" })).json();
    cdp.close();
    cdp = makeCdp(target.webSocketDebuggerUrl, { defaultTimeoutMs: limits.stepTimeoutMs });
    await cdp.ready;
    await cdp.send("Page.enable");
    await cdp.send("Runtime.enable");
    // Interceção total: cada pedido passa pela política de allowlist (navegações E subreursos).
    await cdp.send("Fetch.enable", { patterns: [{ urlPattern: "*", requestStage: "Request" }] });
    cdp.on("Fetch.requestPaused", (p) => {
      const v = isDestinationAllowed(p.request.url, allowedOrigins);
      if (v.allowed) {
        cdp.send("Fetch.continueRequest", { requestId: p.requestId }).then(() => { network.allowed++; }).catch(() => {});
      } else {
        cdp.send("Fetch.failRequest", { requestId: p.requestId, errorReason: "BlockedByClient" }).then(() => {
          if (network.blocked.length < 50) network.blocked.push({ at: iso(), url: redactUrl(p.request.url), reason: v.reason });
          else network.truncated = true;
        }).catch(() => {});
      }
    });

    const evalJs = async (expression, timeoutMs) => {
      const r = await cdp.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true }, timeoutMs);
      if (r.exceptionDetails) throw new Error(`exceção na página: ${r.exceptionDetails.text || "detalhes omitidos"}`);
      return r.result?.value;
    };

    // Warm-up de rede: a PRIMEIRA navegação HTTP por instância do Chrome custa ~25s nesta máquina
    // (latência do ambiente, não do destino — medida empiricamente: about:blank 2ms, http ~25s,
    // seguintes 5–60ms). Absorvemos isso aqui, fora do orçamento das etapas, para os limites por
    // etapa continuarem determinísticos. O alvo é a raiz de uma origem já autorizada pela tarefa.
    {
      const w0 = Date.now();
      const warmUrl = `${allowedOrigins[0]}/`;
      try {
        await cdp.send("Page.navigate", { url: warmUrl }, 70000);
        for (let w = 0; w < 70000; w += 500) {
          const rs = await evalJs("document.readyState", 15000);
          if (rs === "complete" || rs === "interactive") break;
          if (aborted) break;
          await sleep(500);
        }
        warmup = { url: redactUrl(warmUrl), ok: true, ms: Date.now() - w0 };
      } catch (e) {
        // Falha de warm-up não aborta: as etapas próprias falhariam de qualquer modo e o
        // evidência regista a causa.
        warmup = { url: redactUrl(warmUrl), ok: false, ms: Date.now() - w0, detail: String(e?.message || e).slice(0, 200) };
      }
    }

    // ---- execução das etapas ----
    for (let i = 0; i < steps.length; i++) {
      if (aborted) break;
      const step = steps[i];
      const perStep = step.timeoutMs ?? limits.stepTimeoutMs;
      const rec = {
        index: i + 1, id: step.id, action: step.action, at: iso(),
        target: step.action === "goto" ? redactUrl(step.url)
          : stepNeedsSelector.has(step.action) ? step.selector
          : step.action === "screenshot" ? `shots/${step.name}.png` : null,
        status: "not_run", detail: "",
      };
      const s0 = Date.now();
      try {
        await raceStep((async () => {
          // 1) política ANTES de tocar no browser: destino não permitido ⇒ blocked, sem navegar.
          if (step.action === "goto") {
            const v = isDestinationAllowed(step.url, allowedOrigins);
            if (!v.allowed) {
              const err = new Error(`destino bloqueado: ${v.reason}`);
              err.blocked = true; throw err;
            }
            navigations++;
            await cdp.send("Page.navigate", { url: step.url }, perStep);
            // espera robusta por readyState via polling (sem depender de eventos perdidos)
            for (let w = 0; w < perStep; w += 200) {
              const rs = await evalJs("document.readyState", 5000);
              if (rs === "complete" || rs === "interactive") break;
              if (aborted) throw new Error("abortado pelo relógio duro");
              await sleep(200);
            }
            await sleep(150);
            const finalHref = String((await evalJs("location.href", 5000)) || step.url);
            rec.finalUrl = redactUrl(finalHref);
            const fv = isDestinationAllowed(finalHref, allowedOrigins);
            if (!fv.allowed) { const err = new Error(`redirecionou para destino bloqueado: ${fv.reason}`); err.blocked = true; throw err; }
          } else if (step.action === "click") {
            const pos = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(step.selector)}); if (!el) return null; el.scrollIntoView({block:"center"}); const r = el.getBoundingClientRect(); return {x: r.left + r.width/2, y: r.top + r.height/2}; })()`, perStep);
            if (!pos) throw new Error(`elemento não encontrado: ${step.selector}`);
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseMoved", x: pos.x, y: pos.y });
            await cdp.send("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
            await cdp.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
          } else if (step.action === "fill") {
            let value;
            if ("secret" in step) {
              value = secretValue(step.secret);
              rec.value = `<segredo:${step.secret}>`;
              if (value == null || value === "") {
                const err = new Error(`credencial ausente: variável de ambiente do segredo ${step.secret} não definida`);
                err.blocked = true; throw err;
              }
            } else {
              value = step.value;
              // Nunca registamos o valor literal, apenas o tamanho (formulário é conteúdo sensível).
              rec.value = `<valor não registado: ${String(value).length} caracteres>`;
            }
            const ok = await evalJs(`(() => {
              const el = document.querySelector(${JSON.stringify(step.selector)});
              if (!el) return "sem elemento";
              el.focus();
              const proto = el.tagName === "TEXTAREA" ? window.HTMLTextAreaElement : window.HTMLInputElement;
              const set = Object.getOwnPropertyDescriptor(proto.prototype, "value").set;
              set.call(el, ${JSON.stringify(value)});
              el.dispatchEvent(new Event("input", { bubbles: true }));
              el.dispatchEvent(new Event("change", { bubbles: true }));
              return "ok";
            })()`, perStep);
            if (ok !== "ok") throw new Error(`fill falhou (${ok}) em ${step.selector}`);
          } else if (step.action === "press") {
            await cdp.send("Input.dispatchKeyEvent", { type: "keyDown", key: step.key, code: step.key });
            await cdp.send("Input.dispatchKeyEvent", { type: "keyUp", key: step.key, code: step.key });
          } else if (step.action === "wait_for_selector") {
            for (let w = 0; w < perStep; w += 200) {
              if (await evalJs(`!!document.querySelector(${JSON.stringify(step.selector)})`, 5000)) return;
              if (aborted) throw new Error("abortado pelo relógio duro");
              await sleep(200);
            }
            throw new Error(`selector não apareceu: ${step.selector}`);
          } else if (step.action === "wait_for_text") {
            for (let w = 0; w < perStep; w += 200) {
              if (await evalJs(`(document.body && document.body.innerText || "").includes(${JSON.stringify(step.text)})`, 5000)) return;
              if (aborted) throw new Error("abortado pelo relógio duro");
              await sleep(200);
            }
            throw new Error(`texto não apareceu: ${JSON.stringify(step.text).slice(0, 80)}`);
          } else if (step.action === "wait_timeout") {
            await sleep(step.ms);
          } else if (step.action === "screenshot") {
            const { data } = await cdp.send("Page.captureScreenshot", { format: "png" }, perStep);
            const buf = Buffer.from(data, "base64");
            const { mkdir } = await import("node:fs/promises");
            await mkdir(shotsDir, { recursive: true });
            const file = join(shotsDir, `${step.name}.png`);
            await writeFile(file, buf, { mode: 0o600 });
            rec.file = `shots/${step.name}.png`;
            rec.sha256 = createHash("sha256").update(buf).digest("hex");
          } else if (step.action === "extract_text") {
            const sel = step.selector || "body";
            const text = await evalJs(`(() => { const el = document.querySelector(${JSON.stringify(sel)}); return el ? el.innerText : null; })()`, perStep);
            if (text == null) throw new Error(`elemento não encontrado: ${sel}`);
            // Conteúdo da página é DADO não-confiável: marcado e truncado, nunca usado como instrução.
            rec.untrusted = true;
            rec.text = `${UNTRUSTED_MARKER}\n${String(text).slice(0, 4000)}`;
          }
        })(), perStep, `etapa ${step.id}`);
        rec.status = "passed";
      } catch (e) {
        rec.status = e.blocked ? "blocked" : "failed";
        rec.detail = String(e?.message || e).slice(0, 300);
      }
      rec.elapsedMs = Date.now() - s0;
      stepResults.push(rec);
      if (rec.status !== "passed") {
        // Falha/bloqueio congela o resto: as etapas seguintes ficam not_run (nunca sucesso implícito).
        for (const rest of steps.slice(i + 1)) {
          stepResults.push({ index: stepResults.length + 1, id: rest.id, action: rest.action, at: iso(), status: "not_run", detail: "não executada: etapa anterior não passou" });
        }
        break;
      }
    }
  } finally {
    clearTimeout(totalTimer);
    cdp?.close();
    await shutdownChrome(chrome, profileDir);
  }

  // Aborto no meio (relógio duro): marca o restante not_run e regista a causa.
  if (aborted && stepResults.every((s) => s.status === "passed" || s.status === "not_run")) {
    for (let i = stepResults.length; i < steps.length; i++) {
      const s = steps[i];
      stepResults.push({ index: i + 1, id: s.id, action: s.action, at: iso(), status: "not_run", detail: `abortado: ${aborted}` });
    }
  }
  const summary = {
    passed: stepResults.filter((s) => s.status === "passed").length,
    failed: stepResults.filter((s) => s.status === "failed").length,
    blocked: stepResults.filter((s) => s.status === "blocked").length,
    not_run: stepResults.filter((s) => s.status === "not_run").length,
    navigations, networkAllowed: network.allowed, networkBlocked: network.blocked.length,
    aborted, startupFailure,
  };
  summary.result = summary.failed || summary.blocked || aborted || startupFailure ? "failed" : "passed";
  return {
    evidence: {
      worker: WORKER_ID, scenario: scenario.name, startedAt, finishedAt: iso(),
      elapsedMs: Date.now() - t0, allowlist: allowedOrigins, limits, warmup,
      steps: stepResults,
      network: { allowed: network.allowed, blocked: network.blocked, truncated: network.truncated },
      summary,
      exitCode: startupFailure ? 2 : summary.result === "passed" ? 0 : 1,
    },
    // Diagnóstico do Chrome (stderr) fica FORA da evidência JSON; só é escrito em ficheiro à parte
    // quando o resultado não é passed (nunca contém cookies/segredos — é stderr do processo).
    chromeStderrTail: stderrRef().slice(-4000),
  };
}

// ---------------------------------------------------------------- CLI

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const k = argv[i], v = argv[i + 1];
    if (!/^--(scenario|evidence|chrome)$/.test(k) || v == null) {
      throw new ScenarioError(`argumento desconhecido/incompleto: ${k ?? "(vazio)"} (uso: --scenario F --evidence F [--chrome BIN])`);
    }
    out[k.slice(2)] = v;
  }
  if (!out.scenario || !out.evidence) throw new ScenarioError(" obrigam --scenario e --evidence");
  return out;
}

async function mainCli() {
  let evidencePath = null, started = iso();
  let exitCode = 3;
  try {
    const args = parseArgs(process.argv.slice(2));
    const scenarioPath = assertSafePath(args.scenario, "--scenario");
    evidencePath = assertSafePath(args.evidence, "--evidence");
    const { readFile, mkdir } = await import("node:fs/promises");
    const scenario = validateScenario(JSON.parse(await readFile(scenarioPath, "utf8")));
    let chromeBin = args.chrome || process.env.BROWSER_WORKER_CHROME || "google-chrome";
    if (isAbsolute(chromeBin)) {
      // Falha cedo com mensagem clara se o binário indicado não existe (nunca shell: só spawn/execFile).
      await access(chromeBin).catch(() => { throw new Error(`binário de chrome não encontrado: ${chromeBin}`); });
    }
    await mkdir(dirname(evidencePath), { recursive: true });
    const { evidence, chromeStderrTail } = await runScenario(scenario, { chromeBin, evidencePath });
    evidence.scenarioFile = basename(scenarioPath);
    await writeFile(evidencePath, JSON.stringify(evidence, null, 2), { mode: 0o600 });
    exitCode = evidence.exitCode;
    if (exitCode !== 0 && chromeStderrTail) {
      // Diagnóstico ao lado da evidência (stderr do Chrome; sem cookies/segredos).
      await writeFile(`${evidencePath}.chrome.log`, chromeStderrTail, { mode: 0o600 }).catch(() => {});
    }
  } catch (e) {
    const isScenario = e instanceof ScenarioError;
    if (evidencePath) {
      await writeFile(evidencePath, JSON.stringify({
        worker: WORKER_ID, startedAt: started, finishedAt: iso(),
        steps: [], network: { allowed: 0, blocked: [] },
        summary: { result: "failed", startupFailure: isScenario ? null : String(e?.message || e), validationError: isScenario ? String(e.message) : null },
      }, null, 2), { mode: 0o600 }).catch(() => {});
    }
    exitCode = isScenario ? 3 : 2;
  }
  process.exit(exitCode);
}

// fileURLToPath (nunca `.pathname`): no Windows o pathname dá `/D:/...`, a comparação falhava e o
// CLI não corria nada (saía 0 sem evidência) — bug real apanhado pelo CI em windows-latest.
const invokedDirectly = process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url));
if (invokedDirectly) {
  // Encerramento gracioso: SIGINT/SIGTERM abortam, o `finally` de runScenario mata o Chrome
  // (SIGTERM→SIGKILL) e remove o perfil; a evidência é escrita pelo caminho normal de erro/sucesso.
  // Registado só no CLI: quem importa o módulo (testes) não recebe handlers de sinal.
  for (const sig of ["SIGINT", "SIGTERM"]) {
    process.on(sig, () => { process.exit(sig === "SIGINT" ? 130 : 143); });
  }
  await mainCli();
}
