// Fase H — regras da lista de conversas na interface (funções puras e testáveis).
// A fonte da verdade é o servidor; aqui fica apenas o estado de interação: qual conversa
// estava selecionada (só o ID vai para o localStorage) e como formatar título/data.
import type { ConversationSummary } from "@/lib/bridge";

export const ACTIVE_KEY = "jarvis.chat.active";

export const getStoredActive = (): string | null =>
  typeof localStorage === "undefined" ? null : localStorage.getItem(ACTIVE_KEY);

export const storeActive = (id: string | null) => {
  if (typeof localStorage === "undefined") return;
  if (id) localStorage.setItem(ACTIVE_KEY, id);
  else localStorage.removeItem(ACTIVE_KEY);
};

/**
 * Regra de seleção após recarregar: mantém a conversa guardada localmente se ela ainda existir
 * no servidor; caso contrário abre a mais recente; sem conversas, começa uma nova (null).
 * Nunca apaga nada — a lista vem inteira do servidor.
 */
export function pickActiveConversation(
  storedId: string | null,
  list: ConversationSummary[],
): string | null {
  if (storedId && list.some((c) => c.id === storedId)) return storedId;
  return list[0]?.id ?? null;
}

const LOCALES: Record<string, string> = { pt: "pt-BR", en: "en-US", es: "es-ES" };

/**
 * Id de cada envio (clientMsgId) no formato UUID v4 exigido pelo servidor.
 * `crypto.randomUUID` só existe em contexto seguro (HTTPS/localhost); o painel é acessado
 * via HTTP na tailnet, então há fallback com `getRandomValues` (disponível em qualquer
 * contexto) e, em último caso, bytes pseudo-aleatórios. O retry reutiliza o mesmo id —
 * por isso a geração precisa nunca lançar e o resultado ser sempre um v4 válido.
 */
export function newClientMsgId(): string {
  const c: Crypto | undefined = globalThis.crypto;
  if (typeof c?.randomUUID === "function") return c.randomUUID();
  const b = new Uint8Array(16);
  if (typeof c?.getRandomValues === "function") c.getRandomValues(b);
  else for (let i = 0; i < b.length; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40; // versão 4
  b[8] = (b[8]! & 0x3f) | 0x80; // variante RFC 4122
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** Data curta para a lista: hoje mostra a hora; outro dia mostra dia/mês. */
export function formatConversationDate(iso: string, lang: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const opts: Intl.DateTimeFormatOptions =
    d.toDateString() === new Date().toDateString()
      ? { hour: "2-digit", minute: "2-digit" }
      : { day: "2-digit", month: "short" };
  return new Intl.DateTimeFormat(LOCALES[lang] || "pt-BR", opts).format(d);
}
