// Provedor de busca web estruturada — evolução Fase 4 (docs/evolution/phase-4/web-search-provider.md).
// Provedores substituíveis: 'searxng' (instância local, JSON API — recomendado) e 'ddg-html'
// (sem credenciais). Configuração do searxng: global_settings.integrations.searxng.url (painel)
// com fallback em JARVIS_SEARXNG_URL. Indisponibilidade é SEMPRE explícita — nunca resultado
// fictício (mandato §4.2).
import { safeFetch, assertSafeUrl, assertPublicHost } from "./urlpolicy.js";
import { getSettings } from "./settings.js";
import { createHash } from "node:crypto";

export const KH_RETRIEVAL_MAX_BYTES = Number(process.env.JARVIS_RESEARCH_MAX_PAGE) || 500_000;

// ---------- canonicalização e dedupe ----------

/** Canonicalização segura de URL: sem fragmento, sem parâmetros de rastreio. */
export function canonicalizeUrl(rawUrl) {
  const u = new URL(assertSafeUrl(rawUrl));
  u.hash = "";
  const drop = [...u.searchParams.keys()].filter((k) => /^(utm_|fbclid|gclid|ref|source)/i.test(k));
  for (const k of drop) u.searchParams.delete(k);
  return u.toString();
}

export const domainOf = (url) => {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
};

export const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

// ---------- provedor padrão (DDG HTML, sem credenciais) ----------

let injectedFetcher = null; // injeção para testes (fixtures); produção usa safeFetch
/** Define um fetcher alternativo (testes/fixtures). `null` volta ao padrão. */
export function setSearchFetcher(fn) {
  injectedFetcher = fn;
}

async function fetchHtml(url) {
  if (injectedFetcher) return injectedFetcher(url);
  const r = await safeFetch(url, { timeoutMs: 20_000 });
  if (!r.ok) throw new Error("search_provider_unavailable");
  return await r.text();
}

/** Provedor configurado: searxng (settings/env) quando presente; senão ddg-html. */
export function configuredProvider(adminId = 0) {
  let url = null;
  try {
    url = getSettings(adminId)?.integrations?.searxng?.url || null;
  } catch {
    /* settings indisponíveis em boot inicial — segue para env */
  }
  url = url || process.env.JARVIS_SEARXNG_URL || null;
  // Base validada: esquema HTTP(S) e host explícito (serviço declarado pelo operador).
  if (url && !/^https?:\/\/[a-zA-Z0-9._:-]+(:\d+)?$/i.test(url.replace(/\/$/, "")))
    return { provider: "ddg-html", base: null };
  return url
    ? { provider: "searxng", base: String(url).replace(/\/$/, "") }
    : { provider: "ddg-html", base: null };
}

/** Busca via instância searxng local (JSON API). A BASE é configurada pelo OPERADOR
 *  (global_settings/env) — segue o padrão das integrações HTTP do próprio app
 *  (`http-integration.js`: URL da configuração do admin, timeout, sem urlpolicy de conteúdo),
 *  pois é serviço interno da rede Docker; o modelo só controla a consulta, nunca a base. */
async function searxngSearch(base, request) {
  const u = new URL(`${base}/search`);
  u.searchParams.set("q", request.query);
  u.searchParams.set("format", "json");
  if (request.language) u.searchParams.set("language", request.language);
  u.searchParams.set("safesearch", "1");
  const body = await (injectedFetcher
    ? injectedFetcher(u.toString())
    : (async () => {
        // Integração do OPERADOR (base fixa em config): fetch direto na rede interna —
        // padrão de `http-integration.js`; o urlpolicy (SSRF) não se aplica pois a URL NÃO
        // vem de conteúdo/modelo, e sim da configuração administrativa.
        const r = await fetch(u.toString(), {
          signal: AbortSignal.timeout(20_000),
          headers: { "User-Agent": "Jarvis/1.0 (+local research)" },
        });
        if (!r.ok) throw new Error(`searxng_http_${r.status}`);
        return await r.text();
      })());
  const data = JSON.parse(body);
  const results = (Array.isArray(data.results) ? data.results : []).map((x) => ({
    title: String(x.title || "(sem título)"),
    url: x.url,
    canonical_url: canonicalizeUrl(x.url),
    domain: domainOf(x.url),
    snippet: String(x.content || ""),
    provider: "searxng",
    metadata: { engine: x.engine || null, published: x.publishedDate || null },
  }));
  return { provider: "searxng", results };
}

/** Faz o parse do HTML de resultados do provedor ddg (formato do provedor ddg-html). */
function parseResults(html) {
  const results = [];
  const re = /<a[^>]+class="[^"]*result__a[^"]*"[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>/g;
  const snipRe = /<a[^>]+class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/g;
  const snippets = [...html.matchAll(snipRe)].map((m) => stripTags(m[1]));
  let i = 0;
  for (const m of html.matchAll(re)) {
    const href = m[1].startsWith("//") ? `https:${m[1]}` : m[1];
    results.push({
      title: stripTags(m[2]),
      url: href,
      canonical_url: canonicalizeUrl(href),
      domain: domainOf(href),
      snippet: snippets[i] || "",
      provider: "ddg-html",
    });
    i++;
  }
  return results;
}

const stripTags = (s) =>
  String(s)
    .replace(/<[^>]+>/g, "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#x27;/g, "'")
    .replace(/\s+/g, " ")
    .trim();

/**
 * Pesquisa estruturada: {query, limit?, domains?[], exclude?[], language?} →
 * {provider, results:[{title, url, canonical_url, domain, snippet, provider}], unavailable?}.
 * Falha do provedor → indisponibilidade EXPLÍCITA (results vazio + unavailable: motivo).
 */
export async function webSearchStructured(request = {}, { adminId = 0 } = {}) {
  const query = String(request.query || "").trim();
  if (!query) return { provider: null, results: [], unavailable: "empty_query" };
  const limit = Math.min(Math.max(Number(request.limit) || 8, 1), 20);
  const cfg = configuredProvider(adminId);

  if (cfg.provider === "searxng") {
    try {
      const res = await searxngSearch(cfg.base, { ...request, query });
      const seen = new Set();
      const out = [];
      for (const r of res.results) {
        if (request.domains?.length && !request.domains.some((d) => r.domain.endsWith(d))) continue;
        if (request.exclude?.length && request.exclude.some((d) => r.domain.endsWith(d))) continue;
        if (seen.has(r.canonical_url)) continue;
        seen.add(r.canonical_url);
        out.push(r);
        if (out.length >= limit) break;
      }
      if (!out.length) return { ...res, results: out, unavailable: "no_results" };
      return { ...res, results: out };
    } catch (e) {
      return { provider: "searxng", results: [], unavailable: `searxng:${e.message}` };
    }
  }

  let html;
  try {
    const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}${request.language ? `&kl=${encodeURIComponent(request.language)}` : ""}`;
    html = await fetchHtml(url);
  } catch (e) {
    return {
      provider: "ddg-html",
      results: [],
      unavailable: e.message === "search_provider_unavailable" ? "provider_error" : e.message,
    };
  }
  let parsed;
  try {
    parsed = parseResults(html);
  } catch {
    return { provider: "ddg-html", results: [], unavailable: "parse_failed" };
  }
  if (!parsed.length) return { provider: "ddg-html", results: [], unavailable: "no_results" };
  // Filtros de domínio + dedupe por URL canônica (ordem do provedor preservada).
  const seen = new Set();
  const out = [];
  for (const r of parsed) {
    let host;
    try {
      host = new URL(r.url).hostname;
    } catch {
      continue;
    }
    if (request.domains?.length && !request.domains.some((d) => host.endsWith(d))) continue;
    if (request.exclude?.length && request.exclude.some((d) => host.endsWith(d))) continue;
    if (seen.has(r.canonical_url)) continue;
    seen.add(r.canonical_url);
    out.push(r);
    if (out.length >= limit) break;
  }
  return { provider: "ddg-html", results: out };
}

// ---------- recuperação controlada de páginas (SSRF, tamanho, sem execução) ----------

/** Texto plano de HTML (sem scripts/styles — nunca executado). */
export function htmlToText(html) {
  return stripTags(
    String(html)
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|li|h[1-6]|tr)>/gi, "\n"),
  ).slice(0, KH_RETRIEVAL_MAX_BYTES);
}

/**
 * Recupera uma página com os controles da Fase 2 (assertSafeUrl/assertPublicHost antes e depois
 * de redirecionamentos — o safeFetch já fixa o IP resolvido). Retorna RetrievedPage:
 * {url, final_url, text, content_hash, quality, fetched_at} ou {quality:'failed', error}.
 */
export async function retrievePage(rawUrl) {
  const base = {
    url: rawUrl,
    final_url: rawUrl,
    text: "",
    content_hash: null,
    quality: "failed",
    fetched_at: new Date().toISOString(),
    error: null,
  };
  try {
    const url = assertSafeUrl(rawUrl);
    // Fixture (transporte controlado em testes): pula o DNS real; produção mantém a dupla
    // verificação (assertSafeUrl + assertPublicHost + safeFetch com IP fixado).
    const urlStr = url.toString();
    if (!injectedFetcher) await assertPublicHost(url);
    base.url = urlStr;
    const fetcher = injectedFetcher
      ? injectedFetcher(urlStr)
      : (async () => {
          const r = await safeFetch(url, { timeoutMs: 30_000 });
          if (!(r.status >= 200 && r.status < 300)) throw new Error(`http_${r.status}`);
          const capped = await r.body();
          return capped.text + (capped.truncated ? "\n[TRUNCADO]" : "");
        })();
    const body = await fetcher;
    const text = typeof body === "string" ? htmlToText(body) : String(body);
    if (!text.trim()) return { ...base, error: "empty_page" };
    const quality = text.length >= KH_RETRIEVAL_MAX_BYTES ? "partial" : "full";
    return { ...base, final_url: url, text, content_hash: sha256(text), quality, error: null };
  } catch (e) {
    return { ...base, error: String(e.message || e).slice(0, 60) };
  }
}
