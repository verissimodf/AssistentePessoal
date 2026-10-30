// Download seguro de fontes URL do Knowledge Hub (evolução Fase 2): reutiliza a política de
// rede existente (assertSafeUrl + assertPublicHost + safeFetch, com bloqueio de redes privadas,
// metadados de cloud e esquemas não-HTTP) — nenhum caminho de rede novo é criado.
import { safeFetch, assertSafeUrl, assertPublicHost } from "./urlpolicy.js";

const KH_MAX_URL_BYTES = Number(process.env.JARVIS_KH_MAX_URL_BYTES) || 2_000_000;

/** Baixa uma URL de fonte com as mesmas garantias de SSRF do fetchUrl do chat. */
export async function safeFetchUrl(rawUrl) {
  const url = assertSafeUrl(rawUrl);
  await assertPublicHost(url);
  const r = await safeFetch(url, { timeoutMs: 30_000 });
  if (!r.ok) throw new Error("kh_fetch_failed");
  const type = String(r.headers?.get?.("content-type") || "text/plain");
  if (!/^(text\/|application\/(json|xml|xhtml))/.test(type)) throw new Error("kh_unsupported_mime");
  const buf = Buffer.from(await r.arrayBuffer());
  if (buf.length > KH_MAX_URL_BYTES) throw new Error("kh_too_large");
  return { buffer: buf, mime: type.split(";")[0].trim() || "text/plain" };
}
