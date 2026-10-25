/**
 * Cabeçalhos de segurança do painel (SSR em 8090).
 *
 * O serviço da API já responde com `nosniff`; o painel não respondia com nenhum. Estes quatro
 * são seguros para uma SPA: não restringem subrecursos (scripts, estilos, workers do three.js),
 * apenas impedem sniffing de tipo, vazamento de referrer e enquadramento por terceiros.
 *
 * `SAMEORIGIN`/`frame-ancestors 'self'` (e não `DENY`) para não quebrar um enquadramento
 * same-origin legítimo; proteção contra clickjacking externo continua valendo.
 */
export const PANEL_SECURITY_HEADERS = {
  "x-content-type-options": "nosniff",
  "referrer-policy": "no-referrer",
  "x-frame-options": "SAMEORIGIN",
  "content-security-policy": "frame-ancestors 'self'",
} as const;

/** Status que, por especificação, não podem carregar corpo. */
const NULL_BODY_STATUS = new Set([101, 204, 205, 304]);

/**
 * Devolve uma cópia da resposta com os cabeçalhos de segurança, preservando status, corpo e
 * qualquer cabeçalho já definido pela aplicação (nunca sobrescreve).
 */
export function withSecurityHeaders(response: Response): Response {
  const headers = new Headers(response.headers);
  for (const [name, value] of Object.entries(PANEL_SECURITY_HEADERS)) {
    if (!headers.has(name)) headers.set(name, value);
  }
  const init = { status: response.status, statusText: response.statusText, headers };
  return NULL_BODY_STATUS.has(response.status)
    ? new Response(null, init)
    : new Response(response.body, init);
}
