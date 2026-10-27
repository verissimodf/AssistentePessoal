import { realpath, stat, readFile } from "node:fs/promises";
import { basename, extname, resolve, sep } from "node:path";

export const MAX_TTS_BODY_BYTES = 64 * 1024;
export const MAX_TTS_TEXT_LENGTH = 12_000;
export const MAX_VOICE_SAMPLE_BYTES = 25 * 1024 * 1024;
const VOICE_EXTENSIONS = new Set([".wav", ".mp3", ".ogg", ".flac", ".m4a", ".webm"]);

export class AdapterRequestError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

export async function readJsonBody(req) {
  const length = Number(req.headers["content-length"] || 0);
  if (length > MAX_TTS_BODY_BYTES) throw new AdapterRequestError(413, "request_too_large");

  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_TTS_BODY_BYTES) throw new AdapterRequestError(413, "request_too_large");
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new AdapterRequestError(400, "invalid_json");
  }
}

export async function prepareXttsRequest(
  body,
  { xttsUrl, defaultSpeaker, dataDir = process.env.JARVIS_DATA_DIR || "/app/data" },
) {
  if (!body || typeof body !== "object" || Array.isArray(body))
    throw new AdapterRequestError(400, "invalid_request");
  if (typeof body.text !== "string" || !body.text.trim())
    throw new AdapterRequestError(400, "text_required");
  if (body.text.length > MAX_TTS_TEXT_LENGTH) throw new AdapterRequestError(413, "text_too_large");

  const language = String(body.lang || "pt")
    .slice(0, 2)
    .toLowerCase();
  if (!/^[a-z]{2}$/.test(language)) throw new AdapterRequestError(400, "invalid_language");

  if (body.speaker_wav) {
    if (typeof body.speaker_wav !== "string")
      throw new AdapterRequestError(400, "invalid_voice_sample");
    let samplePath;
    let voiceRoot;
    try {
      voiceRoot = await realpath(resolve(dataDir, "voices"));
      samplePath = await realpath(resolve(body.speaker_wav));
    } catch {
      throw new AdapterRequestError(400, "voice_sample_unavailable");
    }
    if (!samplePath.startsWith(`${voiceRoot}${sep}`))
      throw new AdapterRequestError(400, "invalid_voice_sample");
    const extension = extname(samplePath).toLowerCase();
    if (!VOICE_EXTENSIONS.has(extension))
      throw new AdapterRequestError(400, "invalid_voice_sample");
    const info = await stat(samplePath);
    if (!info.isFile() || info.size <= 0 || info.size > MAX_VOICE_SAMPLE_BYTES)
      throw new AdapterRequestError(400, "invalid_voice_sample");

    const form = new FormData();
    form.set("text", body.text);
    form.set("language", language);
    form.set("speaker_label", basename(samplePath, extension).slice(0, 80));
    form.set(
      "speaker_audio",
      new Blob([await readFile(samplePath)], { type: "application/octet-stream" }),
      basename(samplePath),
    );
    return { url: new URL("/voice/clone", xttsUrl), init: { method: "POST", body: form } };
  }

  const speaker = String(body.speaker || defaultSpeaker);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(speaker))
    throw new AdapterRequestError(400, "invalid_speaker");
  const form = new URLSearchParams({ text: body.text, speaker, language });
  return {
    url: new URL("/voice/speak", xttsUrl),
    init: {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: form,
    },
  };
}
