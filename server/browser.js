// Navegador — driver de automação com DOIS MODOS por configuração, contrato explícito e nenhuma
// shell arbitrária.
//
//  - modo `local`  : Chromium (Playwright) DENTRO do próprio processo/container do JARVIS;
//  - modo `remote` : worker externo, alcançado por contrato HTTP autenticado (bearer);
//  - modo `off`    : padrão — capacidade desligada, nada é inicializado.
//
// O endereço do navegador NUNCA é fixo no código: vem de `integrations.browser` (configuração do
// operador). O alvo que o agente navega é sempre validado por `urlpolicy` (bloqueio de loopback,
// redes privadas, link-local/metadados de cloud e esquemas não-HTTP) — limites de destino e
// isolamento ficam no mesmo lugar que o resto do produto já usa.
//
// Este módulo NÃO decide autorização: quem chama (tools.js → aprovação humana → resolveApproval)
// é quem possui o portão. Aqui ficam apenas: validação do pedido, driver, timeout, cancelamento e
// redação de segredos. Nenhum cookie/token/valor secreto sai daqui.
import { lookup as dnsResolve } from "node:dns/promises";
import { assertSafeUrl } from "./urlpolicy.js";
import { getSettings } from "./settings.js";
import { browserHostAllowed, normalizeBrowserHosts } from "./browser-approval.js";
import { assertBrowserDestination, installBrowserRequestPolicy } from "./browser-network.js";

/** Operações suportadas — lista FECHADA (não existe eval/shell/download arbitrário). */
export const BROWSER_OPS = ["navigate", "extract", "click", "fill", "wait_for", "screenshot"];

export const BROWSER_LIMITS = {
  minTimeoutMs: 1_000,
  maxTimeoutMs: 60_000,
  defaultTimeoutMs: 20_000,
  maxSelectorChars: 300,
  maxTextInputChars: 1_000,
  maxOutputChars: 4_000,
};

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const asInt = (v, fallback) => {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
};

/** Configuração efetiva do navegador (por administrador, com o global por trás). */
export function resolveBrowserConfig(adminId = null) {
  const cfg = getSettings(adminId)?.integrations?.browser || {};
  const enabled = !!cfg.enabled;
  const endpoint = typeof cfg.command === "string" ? cfg.command.trim() : "";
  // `off` (desligado) · `remote` (worker externo por URL) · `local` (navegador no container).
  const mode = !enabled ? "off" : endpoint ? "remote" : "local";
  return {
    mode,
    endpoint,
    token: typeof cfg.apiKey === "string" ? cfg.apiKey : "",
    executablePath:
      typeof cfg.executablePath === "string" && cfg.executablePath ? cfg.executablePath : null,
    timeoutMs: clamp(
      asInt(cfg.timeoutMs, BROWSER_LIMITS.defaultTimeoutMs),
      BROWSER_LIMITS.minTimeoutMs,
      BROWSER_LIMITS.maxTimeoutMs,
    ),
    allowedHosts: normalizeBrowserHosts(cfg.allowedHosts),
  };
}

/** Estado para o diagnóstico — nunca expõe o token, apenas se existe. */
export const browserStatus = (adminId = null) => {
  const c = resolveBrowserConfig(adminId);
  return {
    mode: c.mode,
    endpoint: c.endpoint || null,
    hasToken: !!c.token,
    timeoutMs: c.timeoutMs,
  };
};

/**
 * Segunda barreira (DNS): `assertSafeUrl` barra IP literal, mas um NOME público pode resolver para
 * loopback/rede privada/metadados — antes de navegar, o host é resolvido e recusado se cair em
 * endereço bloqueado. O resolvedor é injetável para teste (nenhuma consulta real necessária).
 */
export async function assertPublicHost(
  rawUrl,
  { resolve = (h) => dnsResolve(h, { all: true, verbatim: true }) } = {},
) {
  try {
    await assertBrowserDestination(rawUrl, { resolveHost: resolve });
  } catch {
    throw new BrowserError(
      "blocked_destination",
      "Não foi possível resolver o destino com segurança.",
    );
  }
}

export class BrowserError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "BrowserError";
    this.code = code;
  }
}

/**
 * Valida o pedido ANTES de qualquer I/O: operação da lista fechada, destino seguro (SSRF),
 * seletor/texto dentro dos limites e timeout dentro do teto.
 */
export function validateBrowserRequest(input = {}, { allowedHosts = [] } = {}) {
  const op = String(input.op ?? "").trim();
  if (!BROWSER_OPS.includes(op)) {
    return {
      ok: false,
      code: "unsupported_op",
      reason: `Operação não suportada. Use: ${BROWSER_OPS.join(", ")}.`,
    };
  }
  const rawUrl = input.url === undefined || input.url === null ? "" : String(input.url).trim();
  let url = "";
  if (rawUrl) {
    try {
      url = assertSafeUrl(rawUrl).toString();
    } catch (e) {
      return {
        ok: false,
        code: "blocked_destination",
        reason: `Destino recusado pela política de rede (${e?.message || "url inválida"}).`,
      };
    }
    if (!browserHostAllowed(url, allowedHosts))
      return {
        ok: false,
        code: "blocked_destination",
        reason: "Destino fora da lista de hosts permitidos.",
      };
  }
  if (op === "navigate" && !url)
    return { ok: false, code: "url_required", reason: "Informe a URL para navegar." };
  const selector = input.selector === undefined ? "" : String(input.selector).trim();
  if (["extract", "click", "fill"].includes(op) && op !== "extract" && !selector) {
    return {
      ok: false,
      code: "selector_required",
      reason: `A operação ${op} exige um seletor CSS.`,
    };
  }
  if (selector.length > BROWSER_LIMITS.maxSelectorChars)
    return { ok: false, code: "selector_too_long", reason: "Seletor acima do limite." };
  const text = input.text === undefined ? "" : String(input.text);
  if (text.length > BROWSER_LIMITS.maxTextInputChars)
    return { ok: false, code: "text_too_long", reason: "Texto acima do limite." };
  const timeoutMs = clamp(asInt(input.timeoutMs, 0) || 0, 0, BROWSER_LIMITS.maxTimeoutMs);
  return { ok: true, request: { op, url, selector, text, timeoutMs: timeoutMs || null } };
}

const SECRET_KEY = /cookie|authorization|token|password|secret|credential|set-cookie|session/i;
const ANSI_CONTROL =
  /\u001b\[[0-?]*[ -/]*[@-~]|[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/g;
const SECRET_ASSIGNMENT =
  /["']?\b(?:api[_-]?key|access[_-]?token|refresh[_-]?token|client[_-]?secret|authorization|password|passwd|token|secret)\b["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|Bearer\s+[^\s,;]+|[^\s,;]+)/gi;
const BEARER_CREDENTIAL = /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi;

const redactString = (value) =>
  value
    .replace(ANSI_CONTROL, "")
    .replace(SECRET_ASSIGNMENT, (match) => `${match.split(/[:=]/, 1)[0]}=[redacted]`)
    .replace(BEARER_CREDENTIAL, "Bearer [redacted]");

/** Remove qualquer coisa com cara de credencial e limita o tamanho — inclusive de worker externo. */
export function redact(value, depth = 0) {
  if (depth > 4) return "[profundidade]";
  if (value === null || value === undefined) return value;
  if (typeof value === "string") {
    const clean = redactString(value);
    return clean.length > BROWSER_LIMITS.maxOutputChars
      ? `${clean.slice(0, BROWSER_LIMITS.maxOutputChars)}…`
      : clean;
  }
  if (typeof value !== "object") return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (SECRET_KEY.test(k)) continue; // nunca propaga cookie/token/header sensível
    out[k] = redact(v, depth + 1);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Modo local (Playwright dentro do container). Nenhum navegador é iniciado antes do primeiro uso.
// ---------------------------------------------------------------------------
let localBrowser = null;
const inflight = new Map(); // runId → { abort }

async function loadPlaywright() {
  for (const mod of ["playwright-core", "playwright"]) {
    try {
      return await import(mod);
    } catch {
      /* tenta o próximo */
    }
  }
  throw new BrowserError(
    "browser_unavailable",
    "Navegador local indisponível: instale o Playwright no container (`npm i playwright-core && npx playwright-core install --with-deps chromium`) ou use o modo remoto (worker externo).",
  );
}

async function localRun(
  request,
  { timeoutMs, executablePath, loadPlaywrightFn, signal, resolveHost, allowedHosts },
) {
  if (request.url)
    await assertPublicHost(request.url, {
      resolve: resolveHost || ((h) => dnsResolve(h, { all: true, verbatim: true })),
    });
  const pw = await loadPlaywrightFn();
  const chromium = pw.chromium || pw.default?.chromium;
  if (!chromium)
    throw new BrowserError("browser_unavailable", "Playwright sem Chromium disponível.");
  if (!localBrowser) {
    localBrowser = await chromium.launch({
      headless: true,
      ...(executablePath ? { executablePath } : {}),
      args: ["--disable-dev-shm-usage", "--no-sandbox"],
    });
  }
  const context = await localBrowser.newContext({
    ignoreHTTPSErrors: false,
    acceptDownloads: false,
  });
  try {
    const page = await context.newPage();
    // Defesa em profundidade: bloqueia qualquer requisição cujo destino viole a política de rede.
    await installBrowserRequestPolicy(page, { signal, resolveHost, allowedHosts });
    if (request.url)
      await page.goto(request.url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (request.op === "click") await page.click(request.selector, { timeout: timeoutMs });
    if (request.op === "fill")
      await page.fill(request.selector, request.text, { timeout: timeoutMs });
    if (request.op === "wait_for") {
      if (request.selector) await page.waitForSelector(request.selector, { timeout: timeoutMs });
      else await page.waitForLoadState("networkidle", { timeout: timeoutMs });
    }
    if (request.op === "screenshot") {
      const buf = await page.screenshot({ fullPage: false, type: "png" });
      // A imagem NÃO é devolvida em base64: apenas tamanho (o arquivo é gravado pelo chamador).
      return { screenshotBytes: buf.length };
    }
    const title = await page.title();
    let text = "";
    if (request.op === "extract") {
      text = request.selector
        ? await page.locator(request.selector).first().innerText({ timeout: timeoutMs })
        : await page.locator("body").innerText({ timeout: timeoutMs });
    }
    return { title, finalUrl: page.url(), host: new URL(page.url()).host, text };
  } finally {
    await context.close().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Modo remoto (worker externo). Contrato explícito; a URL vem da configuração do operador.
// ---------------------------------------------------------------------------
const REMOTE_CONTRACT = { path: "/run", cancelPath: "/cancel", method: "POST" };

async function remoteRun(
  request,
  { endpoint, token, timeoutMs, runId, fetchFn, signal, allowedHosts },
) {
  const base = String(endpoint).replace(/\/+$/, "");
  let res;
  try {
    res = await fetchFn(`${base}${REMOTE_CONTRACT.path}`, {
      method: REMOTE_CONTRACT.method,
      headers: {
        "content-type": "application/json",
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: JSON.stringify({
        runId,
        op: request.op,
        url: request.url || null,
        selector: request.selector || null,
        text: request.text || null,
        timeoutMs,
        allowedHosts,
      }),
      signal,
    });
  } catch (e) {
    if (e?.name === "AbortError" || e?.name === "TimeoutError")
      throw new BrowserError("browser_timeout", "Navegador remoto excedeu o tempo limite.");
    throw new BrowserError(
      "browser_unreachable",
      "Navegador remoto inacessível (verifique o endereço do worker e a rede).",
    );
  }
  if (res.status === 401 || res.status === 403)
    throw new BrowserError(
      "browser_unauthorized",
      "Navegador remoto recusou a credencial do worker.",
    );
  if (!res.ok) throw new BrowserError("browser_error", `Navegador remoto respondeu ${res.status}.`);
  let body;
  try {
    body = await res.json();
  } catch {
    throw new BrowserError(
      "browser_protocol_error",
      "Resposta do navegador remoto fora do contrato.",
    );
  }
  if (!body || typeof body !== "object" || typeof body.state !== "string") {
    throw new BrowserError(
      "browser_protocol_error",
      "Resposta do navegador remoto fora do contrato.",
    );
  }
  return redact(body);
}

/**
 * Executa UMA operação. Devolve sempre um resultado ESTRUTURADO (nunca lança para o chamador):
 * `{ state, op, host, durationMs, exitCode, output, error? }` com
 * state ∈ completed | failed | timeout | cancelled | error — o mesmo contrato de `runShell`.
 */
export async function runBrowserAction(adminId, params = {}, options = {}) {
  const cfg = options.config ?? resolveBrowserConfig(adminId);
  const startedAt = Date.now();
  const runId =
    options.runId || `br-${startedAt.toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  const base = {
    op: String(params?.op ?? ""),
    host: null,
    exitCode: null,
    startedAt: new Date(startedAt).toISOString(),
  };
  const done = (state, extra = {}) => ({
    ...base,
    state,
    durationMs: Date.now() - startedAt,
    finishedAt: new Date().toISOString(),
    ...extra,
  });

  if (cfg.mode === "off")
    return done("error", {
      error: {
        code: "browser_disabled",
        message: "Navegador desabilitado em Configurações (integração browser).",
      },
    });
  const v = validateBrowserRequest(params, { allowedHosts: cfg.allowedHosts || [] });
  if (!v.ok) return done("failed", { error: { code: v.code, message: v.reason } });
  const request = v.request;
  if (request.url) base.host = new URL(request.url).host;

  const timeoutMs = Math.min(request.timeoutMs || cfg.timeoutMs, BROWSER_LIMITS.maxTimeoutMs);
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  const external = options.signal;
  const signal = external ? AbortSignal.any([external, ctl.signal]) : ctl.signal;
  inflight.set(runId, { abort: () => ctl.abort() });
  const fetchFn = options.fetchFn ?? ((...a) => globalThis.fetch(...a));
  const loadPlaywrightFn = options.loadPlaywright ?? loadPlaywright;
  try {
    const result =
      cfg.mode === "remote"
        ? await remoteRun(request, {
            endpoint: cfg.endpoint,
            token: cfg.token,
            timeoutMs,
            runId,
            fetchFn,
            signal,
            allowedHosts: cfg.allowedHosts || [],
          })
        : await localRun(request, {
            timeoutMs,
            executablePath: cfg.executablePath,
            loadPlaywrightFn,
            signal,
            resolveHost: options.resolveHost,
            allowedHosts: cfg.allowedHosts || [],
          });
    const state = cfg.mode === "remote" ? result.state : "completed";
    const error =
      result.error && typeof result.error === "object"
        ? {
            code: String(result.error.code || "browser_error"),
            message: String(result.error.message || "falha no navegador"),
          }
        : undefined;
    if (state !== "completed") return done(state, { error, output: result.output ?? null });
    const excerpt = typeof result.text === "string" ? result.text : "";
    const output =
      typeof result.screenshotBytes === "number"
        ? `captura gerada (${result.screenshotBytes} bytes)`
        : JSON.stringify(
            redact({
              title: result.title ?? null,
              finalUrl: result.finalUrl ?? null,
              text: excerpt,
            }),
          ).slice(0, BROWSER_LIMITS.maxOutputChars);
    return done("completed", {
      output,
      title: result.title ?? null,
      finalUrl: result.finalUrl ?? null,
      host: result.host ?? base.host,
    });
  } catch (e) {
    const code = e instanceof BrowserError ? e.code : "browser_error";
    const cancelled = external?.aborted;
    if (cancelled)
      return done("cancelled", {
        error: { code: "browser_cancelled", message: "Operação de navegador cancelada." },
      });
    if (code === "browser_timeout" || ctl.signal.aborted) {
      return done("timeout", {
        error: { code: "browser_timeout", message: `Tempo limite de ${timeoutMs} ms excedido.` },
      });
    }
    return done(code === "browser_unavailable" ? "error" : "failed", {
      error: { code, message: e?.message ? String(e.message).slice(0, 300) : code },
    });
  } finally {
    clearTimeout(timer);
    inflight.delete(runId);
  }
}

/** Cancelamento cooperativo: aborta a execução local e avisa o worker remoto (best-effort). */
export async function cancelBrowserRun(
  runId,
  { config, fetchFn = (...a) => globalThis.fetch(...a) } = {},
) {
  const entry = inflight.get(runId);
  if (entry) entry.abort();
  const cfg = config ?? null;
  if (cfg?.mode === "remote" && cfg.endpoint) {
    try {
      await fetchFn(`${String(cfg.endpoint).replace(/\/+$/, "")}${REMOTE_CONTRACT.cancelPath}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(cfg.token ? { authorization: `Bearer ${cfg.token}` } : {}),
        },
        body: JSON.stringify({ runId }),
        signal: AbortSignal.timeout(3000),
      });
    } catch {
      /* best-effort: o worker tem o próprio teto de tempo */
    }
  }
  return !!entry;
}

/** Encerra o navegador local (usado por testes e por desligamento controlado). */
export async function closeLocalBrowser() {
  if (!localBrowser) return;
  const b = localBrowser;
  localBrowser = null;
  await b.close().catch(() => {});
}
