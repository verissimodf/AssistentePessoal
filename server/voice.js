// Text-to-speech and voice cloning. Engines:
//  - elevenlabs: cloud TTS + Instant Voice Clone (uses your ElevenLabs key)
//  - xtts / kokoro: local Python service (scripts/voz/voice_service.py) on 127.0.0.1:7778, no cloud
import { writeFileSync } from "node:fs";
import { join, extname } from "node:path";
import { DATA_DIR, uid } from "./db.js";
import { getSettings } from "./settings.js";

const ALLOWED = [".wav", ".mp3", ".ogg", ".flac", ".m4a", ".webm"];

export async function tts(text, lang) {
  const s = getSettings();
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
  const r = await fetch(`${url}/tts`, {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ text, lang: (lang || "pt-BR").slice(0, 2), engine: v.tts, speaker_wav: v.clonedEngine === "xtts" ? v.clonedVoiceId : null }),
  });
  if (!r.ok) throw new Error(`Serviço de voz local ${r.status}: ${await r.text()}`);
  return { type: "audio/wav", data: Buffer.from(await r.arrayBuffer()) };
}

/** Saves the sample locally; with ElevenLabs it also creates a cloned voice there. */
export async function cloneVoice(file, engine) {
  const ext = extname(file.name || "").toLowerCase();
  if (!ALLOWED.includes(ext)) throw new Error(`Formato não suportado: ${ext}. Use ${ALLOWED.join(", ")}`);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length > 25 * 1024 * 1024) throw new Error("Arquivo maior que 25 MB.");
  const path = join(DATA_DIR, "voices", `${uid()}${ext}`);
  writeFileSync(path, buf);
  if (engine === "elevenlabs") {
    const key = getSettings().providers?.elevenlabs?.apiKey;
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
