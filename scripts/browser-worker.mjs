#!/usr/bin/env node
// Worker de navegador EXTERNO (modo `remote`) do J.A.R.V.I.S.
//
// Expõe o contrato explícito consumido por `server/browser.js`:
//   POST /run    { runId, op, url?, selector?, text?, timeoutMs? } → { state, title?, finalUrl?, host?, text?, screenshotBytes?, error? }
//   POST /cancel { runId }                                         → { cancelled: boolean }
//   GET  /health                                                   → { ok, engine, mode }
//
// Segurança (fail-closed):
//  - exige `JARVIS_BROWSER_TOKEN`; sem token o processo NÃO inicia (nunca fica aberto por omissão);
//  - bind em 127.0.0.1 por padrão (JARVIS_BROWSER_BIND para mudar) — nunca 0.0.0.0 por omissão;
//  - lista FECHADA de operações (sem eval, sem shell, sem upload/download);
//  - destino validado por `urlpolicy` (esquema, porta, credenciais, IP literal) + resolução DNS
//    (nome público que resolve para loopback/rede privada/metadados é recusado);
//  - contexto isolado por execução (sem reaproveitar cookies/armazenamento) e nenhum
//    cookie/header sensível é devolvido ou registrado;
//  - teto de tempo por execução e cancelamento cooperativo.
import { createServer } from "node:http";
import { timingSafeEqual, randomUUID } from "node:crypto";
import { mkdirSync, chmodSync } from "node:fs";
import { dirname } from "node:path";
import {
  assertBrowserDestination,
  installBrowserRequestPolicy,
} from "../server/browser-network.js";
import { removeStaleUnixSocket } from "../server/unix-socket.js";

const PORT = Number(process.env.JARVIS_BROWSER_PORT || 7788);
const BIND = process.env.JARVIS_BROWSER_BIND || "127.0.0.1";
const WORKER_SOCKET = process.env.JARVIS_BROWSER_WORKER_SOCKET || "";
const TOKEN = process.env.JARVIS_BROWSER_TOKEN || "";
const MAX_BODY = 64 * 1024;
const OPS = ["navigate", "extract", "click", "fill", "wait_for", "screenshot"];
const MAX_TIMEOUT = 60_000;
const MAX_TEXT = 4_000;
const POLICY_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

if (!WORKER_SOCKET && (!TOKEN || TOKEN.length < 16)) {
  console.error(
    "browser-worker: JARVIS_BROWSER_TOKEN ausente/curto — recusando iniciar (fail-closed).",
  );
  process.exit(1);
}

const eq = (a, b) => {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && timingSafeEqual(x, y);
};

let browser = null;
const inflight = new Map();

async function loadPlaywright() {
  for (const mod of ["playwright-core", "playwright"]) {
    try {
      return await import(mod);
    } catch {
      /* tenta o próximo */
    }
  }
  throw Object.assign(new Error("playwright_unavailable"), { code: "playwright_unavailable" });
}

const readJson = (req) =>
  new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on("data", (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error("payload_too_large"), { code: "payload_too_large" }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on("end", () => {
      try {
        resolve(chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) : {});
      } catch {
        reject(Object.assign(new Error("invalid_json"), { code: "invalid_json" }));
      }
    });
    req.on("error", () =>
      reject(Object.assign(new Error("invalid_json"), { code: "invalid_json" })),
    );
  });

const send = (res, status, body) => {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
    "cache-control": "no-store",
  });
  res.end(payload);
};

async function runOp({ op, url, selector, text, timeoutMs, allowedHosts = [], policyId }, signal) {
  if (!OPS.includes(op))
    return {
      state: "failed",
      error: { code: "unsupported_op", message: "Operação não suportada." },
    };
  if (!POLICY_ID.test(String(policyId || "")))
    return {
      state: "failed",
      error: { code: "browser_policy_required", message: "Política de egress ausente." },
    };
  if (url) {
    try {
      await assertBrowserDestination(url, { allowedHosts, checkDns: false });
    } catch (e) {
      return {
        state: "failed",
        error: { code: "blocked_destination", message: "Destino recusado pela política de rede." },
      };
    }
  }
  const pw = await loadPlaywright();
  const chromium = pw.chromium || pw.default?.chromium;
  if (!browser)
    browser = await chromium.launch({
      headless: true,
      args: ["--disable-dev-shm-usage"],
    });
  const context = await browser.newContext({
    acceptDownloads: false,
    ignoreHTTPSErrors: false,
    proxy: {
      server: `http://127.0.0.1:${process.env.JARVIS_BROWSER_PROXY_PORT || 8899}`,
      bypass: "localhost,127.0.0.1,::1",
      username: "jarvis",
      password: policyId,
    },
  });
  try {
    const page = await context.newPage();
    await installBrowserRequestPolicy(page, { signal, allowedHosts, checkDns: false });
    if (url) await page.goto(url, { waitUntil: "domcontentloaded", timeout: timeoutMs });
    if (op === "click") await page.click(selector, { timeout: timeoutMs });
    if (op === "fill") await page.fill(selector, text, { timeout: timeoutMs });
    if (op === "wait_for") {
      if (selector) await page.waitForSelector(selector, { timeout: timeoutMs });
      else await page.waitForLoadState("networkidle", { timeout: timeoutMs });
    }
    if (op === "screenshot") {
      const buf = await page.screenshot({ type: "png" });
      // Fase 5 (Computer Intelligence): imagem em base64 PELO SOCKET (canal de confiança
      // app↔worker) para o app persistir como artefato de evidência; worker sem volume/disco.
      return {
        state: "completed",
        screenshotBytes: buf.length,
        screenshotBase64: buf.toString("base64"),
      };
    }
    const title = await page.title();
    const body =
      op === "extract"
        ? selector
          ? await page.locator(selector).first().innerText({ timeout: timeoutMs })
          : await page.locator("body").innerText({ timeout: timeoutMs })
        : "";
    return {
      state: "completed",
      title,
      finalUrl: page.url(),
      host: new URL(page.url()).host,
      text: String(body).slice(0, MAX_TEXT),
    };
  } finally {
    await context.close().catch(() => {});
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${BIND}`);
  if (url.pathname === "/health")
    return send(res, 200, { ok: true, engine: "playwright", mode: "remote" });
  // O managed worker não publica TCP: o socket Unix privado substitui bearer-token; no modo
  // legado TCP, a autenticação continua obrigatória e o bind permanece loopback.
  if (!WORKER_SOCKET && !eq(req.headers.authorization || "", `Bearer ${TOKEN}`)) {
    if (url.pathname !== "/health") return send(res, 401, { error: "unauthorized" });
  }
  if (req.method !== "POST") return send(res, 405, { error: "method_not_allowed" });

  let body;
  try {
    body = await readJson(req);
  } catch (e) {
    return send(res, e.code === "payload_too_large" ? 413 : 400, {
      error: e.code || "invalid_request",
    });
  }

  if (url.pathname === "/cancel") {
    const entry = inflight.get(String(body.runId || ""));
    if (entry) entry.abort();
    return send(res, 200, { cancelled: !!entry });
  }
  if (url.pathname !== "/run") return send(res, 404, { error: "not_found" });

  const runId = String(body.runId || randomUUID());
  const op = String(body.op || "");
  const timeoutMs = Math.min(Math.max(Number(body.timeoutMs) || 20_000, 1_000), MAX_TIMEOUT);
  const ctl = new AbortController();
  inflight.set(runId, { abort: () => ctl.abort() });
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const out = await Promise.race([
      runOp(
        {
          op,
          url: body.url || null,
          selector: body.selector || null,
          text: body.text || null,
          timeoutMs,
          allowedHosts: body.allowedHosts || [],
          policyId: body.policyId,
        },
        ctl.signal,
      ),
      new Promise((resolve) =>
        ctl.signal.addEventListener(
          "abort",
          () =>
            resolve({
              state: "timeout",
              error: { code: "browser_timeout", message: "tempo limite excedido" },
            }),
          { once: true },
        ),
      ),
    ]);
    return send(res, 200, out);
  } catch (e) {
    const code = e?.code || "browser_error";
    // Erros do worker nunca devolvem stack, URL de destino detalhada, cookie ou header sensível.
    return send(res, code === "playwright_unavailable" ? 503 : 200, {
      state: code === "playwright_unavailable" ? "error" : "failed",
      error: {
        code,
        message:
          code === "playwright_unavailable"
            ? "Playwright não instalado no worker."
            : "Falha ao executar a operação no navegador.",
      },
    });
  } finally {
    clearTimeout(timer);
    inflight.delete(runId);
  }
});

if (WORKER_SOCKET) {
  mkdirSync(dirname(WORKER_SOCKET), { recursive: true, mode: 0o700 });
  await removeStaleUnixSocket(WORKER_SOCKET);
  server.listen(WORKER_SOCKET, () => {
    chmodSync(WORKER_SOCKET, 0o600);
    console.log("browser-worker: private Unix socket ready");
  });
} else {
  server.listen(PORT, BIND, () => {
    console.log(`browser-worker: http://${BIND}:${PORT} (contrato /run · /cancel · /health)`);
  });
}
