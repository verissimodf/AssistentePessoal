// Text-to-speech and voice cloning. Engines:
//  - elevenlabs: cloud TTS + Instant Voice Clone (uses your ElevenLabs key)
//  - xtts / kokoro: local Python service (scripts/voz/voice_service.py) on 127.0.0.1:7778, no cloud
//
// P2-A: o motor LOCAL tem cold-start (o modelo XTTS leva ~40 s para carregar na primeira chamada).
// Por isso o timeout é explícito e diferenciado: frio (generoso, com teto) x morno (curto), com
// estado `warming_up` recuperável, concorrência limitada e cancelamento propagado — nunca um 500
// genérico apenas porque o modelo precisava carregar.
import { writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { DATA_DIR, uid } from "./db.js";
import { getSettings } from "./settings.js";

const ALLOWED = [".wav", ".mp3", ".ogg", ".flac", ".m4a", ".webm"];

/** Erro estruturado do subsistema de voz: código estável + estado recuperável (sem stack vazando). */
export class VoiceError extends Error {
  constructor(code, message, { state = "error", retryAfter = null } = {}) {
    super(message ?? code);
    this.name = "VoiceError";
    this.code = code;
    this.state = state;
    if (retryAfter != null) this.retryAfter = retryAfter;
  }
}

const clamp = (n, lo, hi) => Math.min(hi, Math.max(lo, n));
const positive = (v) => (Number.isFinite(Number(v)) && Number(v) > 0 ? Number(v) : null);

/** Resolve os timeouts de TTS (morno/cold-start) a partir do ambiente, com piso, teto e defaults. */
export function resolveTtsTimeouts(env = {}) {
  const warm = clamp(positive(env.JARVIS_TTS_TIMEOUT_MS) ?? 20_000, 50, 60_000);
  const cold = clamp(positive(env.JARVIS_TTS_COLD_START_MS) ?? 120_000, warm, 300_000);
  return { timeoutMs: warm, coldTimeoutMs: cold };
}

// Estado do processo: `warm` só vira true após UMA síntese local bem-sucedida; a fila limita a
// concorrência (o XTTS é um serviço único e pesado) e nunca cresce sem limite.
const MAX_WAITING = 4;
let warm = false;
let inflight = 0;
let waiting = 0;
let chain = Promise.resolve();
let fetchImpl = (...args) => globalThis.fetch(...args);

/** Injeção para testes (nenhuma rede real). */
export const setVoiceFetch = (fn) => {
  fetchImpl = fn ?? ((...args) => globalThis.fetch(...args));
};
export const getVoiceState = () => ({ warm, inflight, waiting, ...resolveTtsTimeouts(process.env) });
export const resetVoiceState = () => {
  warm = false;
  inflight = 0;
  waiting = 0;
  chain = Promise.resolve();
  fetchImpl = (...args) => globalThis.fetch(...args);
};

/** Serializa a síntese com fila limitada: excedente recebe `voice_busy` (recuperável). */
async function withSlot(fn) {
  if (waiting >= MAX_WAITING) {
    throw new VoiceError("voice_busy", "Síntese de voz ocupada; tente novamente em instantes.", {
      state: "busy",
      retryAfter: 5,
    });
  }
  waiting += 1;
  const prev = chain;
  let release;
  chain = new Promise((r) => (release = r));
  try {
    await prev;
  } finally {
    waiting -= 1;
  }
  inflight += 1;
  try {
    return await fn();
  } finally {
    inflight -= 1;
    release();
  }
}

export async function tts(text, lang, adminId, { signal: clientSignal } = {}) {
  const s = getSettings(adminId);
  const v = s.voice || {};
  if (v.tts === "elevenlabs") {
    const key = s.providers?.elevenlabs?.apiKey;
    if (!key) throw new Error("Configure a chave da ElevenLabs.");
    const voiceId = v.clonedEngine === "elevenlabs" && v.clonedVoiceId ? v.clonedVoiceId : v.elevenVoiceId || "JBFqnCBsd6RMkjVDRZzb";
    const r = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${voiceId}?output_format=mp3_44100_128`, {
      method: "POST", headers: { "xi-api-key": key, "content-type": "application/json" },
      body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }),
    });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
    return { type: "audio/mpeg", data: Buffer.from(await r.arrayBuffer()) };
  }
  // local engines
  const url = v.localVoiceUrl || "http://127.0.0.1:7778";
  return withSlot(async () => {
    const { timeoutMs, coldTimeoutMs } = resolveTtsTimeouts(process.env);
    const budget = warm ? timeoutMs : coldTimeoutMs; // frio: cobre o carregamento do modelo
    const timeoutCtl = new AbortController();
    const timer = setTimeout(() => timeoutCtl.abort(), budget);
    const signal = clientSignal
      ? AbortSignal.any([clientSignal, timeoutCtl.signal])
      : timeoutCtl.signal;
    try {
      const r = await fetchImpl(`${url}/tts`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          text,
          lang: (lang || "pt-BR").slice(0, 2),
          engine: v.tts,
          speaker_wav: v.clonedEngine === "xtts" ? v.clonedVoiceId : null,
        }),
        signal,
      });
      if (!r.ok) {
        // Nunca repassa o corpo do serviço (pode conter detalhes internos).
        throw new VoiceError("voice_error", `Serviço de voz local respondeu ${r.status}.`, {
          state: "error",
        });
      }
      const data = Buffer.from(await r.arrayBuffer());
      warm = true; // só depois de UMA síntese bem-sucedida o serviço é considerado morno
      return { type: "audio/wav", data };
    } catch (err) {
      if (err instanceof VoiceError) throw err;
      if (clientSignal?.aborted) {
        throw new VoiceError("voice_cancelled", "Síntese cancelada pelo cliente.", {
          state: "cancelled",
        });
      }
      const aborted = err?.name === "AbortError" || err?.name === "TimeoutError";
      if (aborted) {
        // Timeout do NOSSO orçamento: se o serviço ainda não estava morno, é aquecimento (recuperável).
        if (!warm) {
          throw new VoiceError(
            "voice_warming_up",
            "O serviço de voz local está carregando o modelo. Tente novamente em instantes.",
            { state: "warming_up", retryAfter: 15 },
          );
        }
        throw new VoiceError("voice_timeout", "A síntese de voz excedeu o tempo limite.", {
          state: "timeout",
          retryAfter: 5,
        });
      }
      const code = err?.cause?.code || err?.code;
      if (code === "ECONNREFUSED" || err?.message?.includes("fetch failed")) {
        throw new VoiceError(
          "voice_unavailable",
          "Serviço de voz local indisponível. Verifique se scripts/voz/voice_service.py está rodando.",
          { state: "unavailable", retryAfter: 10 },
        );
      }
      throw new VoiceError("voice_error", "Falha ao sintetizar voz.", { state: "error" });
    } finally {
      clearTimeout(timer);
    }
  });
}

/** Verifica se o serviço de voz local está online e respondendo na URL informada. */
export async function checkVoiceService(url = "http://127.0.0.1:7778") {
  try {
    const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
    return { ok: r.ok, status: r.status };
  } catch (err) {
    return { ok: false, error: err.cause?.code || err.message };
  }
}

/** Saves the sample locally; with ElevenLabs it also creates a cloned voice there. */
export async function cloneVoice(file, engine, adminId) {
  const ext = extname(file.name || "").toLowerCase();
  if (!ALLOWED.includes(ext)) throw new Error(`Formato não suportado: ${ext}. Use ${ALLOWED.join(", ")}`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error("Arquivo maior que 25 MB.");
  const path = join(DATA_DIR, "voices", `${uid()}${ext}`);
  writeFileSync(path, buf);
  if (engine === "elevenlabs") {
    const key = getSettings(adminId).providers?.elevenlabs?.apiKey;
    if (!key) throw new Error("Configure a chave da ElevenLabs.");
    const fd = new FormData();
    fd.append("name", `Jarvis-${Date.now()}`);
    fd.append("files", new Blob([buf]), file.name);
    const r = await fetch("https://api.elevenlabs.io/v1/voices/add", { method: "POST", headers: { "xi-api-key": key }, body: fd });
    if (!r.ok) throw new Error(`ElevenLabs ${r.status}: ${await r.text()}`);
    return { voiceId: (await r.json()).voice_id, engine };
  }
  return { voiceId: path, engine: "xtts" };
}
