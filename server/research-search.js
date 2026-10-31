// Provedor de busca web estruturada — evolução Fase 4 (docs/evolution/phase-4/web-search-provider.md).
// Interface substituível; provedor padrão 'ddg-html' (reutiliza o scraping existente e a
// política de rede da urlpolicy). Sem credenciais configuradas para provedores de API —
// indisponibilidade é EXPLÍCITA, nunca resultado fictício (mandato §4.2).
import { safeFetch, assertSafeUrl, assertPublicHost } from "./urlpolicy.js";
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

/** Faz o parse do HTML de resultados do provedor (formato do provedor padrão). */
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
export async function webSearchStructured(request = {}) {
  const query = String(request.query || "").trim();
  if (!query) return { provider: null, results: [], unavailable: "empty_query" };
  const limit = Math.min(Math.max(Number(request.limit) || 8, 1), 20);
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
          if (!r.ok) throw new Error("fetch_failed");
          return await r.text();
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
