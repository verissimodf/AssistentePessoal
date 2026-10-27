// Local-only speech-to-text adapter. Audio is bounded in memory and forwarded to the private
// whisper.cpp service; this module never writes recordings to disk or logs their contents.
import { MailError } from "./mail.js";

const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
const LIMIT_PER_MINUTE = 12;
const requests = new Map();
let active = false;

async function validAudio(file) {
  if (
    !file ||
    typeof file.arrayBuffer !== "function" ||
    file.size < 16 ||
    file.size > MAX_AUDIO_BYTES
  )
    throw new MailError(
      file?.size > MAX_AUDIO_BYTES ? 413 : 400,
      file?.size > MAX_AUDIO_BYTES ? "audio_too_large" : "audio_invalid",
    );
  const type = String(file.type || "")
    .toLowerCase()
    .split(";")[0];
  if (
    !["audio/webm", "audio/ogg", "audio/wav", "audio/x-wav", "audio/mp4", "audio/mpeg"].includes(
      type,
    )
  )
    throw new MailError(400, "audio_type_unsupported");
  const bytes = Buffer.from(await file.arrayBuffer());
  const signatureOk =
    type === "audio/webm"
      ? bytes.subarray(0, 4).equals(Buffer.from([0x1a, 0x45, 0xdf, 0xa3]))
      : type === "audio/ogg"
        ? bytes.subarray(0, 4).toString() === "OggS"
        : type === "audio/wav" || type === "audio/x-wav"
          ? bytes.subarray(0, 4).toString() === "RIFF" &&
            bytes.subarray(8, 12).toString() === "WAVE"
          : type === "audio/mp4"
            ? bytes.subarray(4, 8).toString() === "ftyp"
            : bytes.subarray(0, 3).toString() === "ID3" ||
              (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0);
  if (!signatureOk) throw new MailError(400, "audio_signature_invalid");
  return { type, bytes };
}

function checkRate(adminId, at = Date.now()) {
  const recent = (requests.get(adminId) || []).filter((t) => at - t < 60_000);
  if (recent.length >= LIMIT_PER_MINUTE) throw new MailError(429, "stt_rate_limited");
  recent.push(at);
  requests.set(adminId, recent);
}

export async function transcribeAudio(
  adminId,
  file,
  { env = process.env, fetchFn = (...args) => fetch(...args), language = "pt" } = {},
) {
  if (!adminId) throw new MailError(403, "admin_session_required");
  const { type, bytes } = await validAudio(file);
  checkRate(adminId);
  if (active) throw new MailError(429, "stt_busy");
  active = true;
  try {
    const serviceUrl = String(env.JARVIS_STT_URL || "http://stt:8080").replace(/\/$/, "");
    const body = new FormData();
    body.append(
      "file",
      new Blob([bytes], { type }),
      `speech.${type === "audio/wav" || type === "audio/x-wav" ? "wav" : type === "audio/ogg" ? "ogg" : type === "audio/mp4" ? "m4a" : type === "audio/mpeg" ? "mp3" : "webm"}`,
    );
    body.append("response_format", "json");
    const lang = ["pt", "en", "es", "auto"].includes(language) ? language : "pt";
    body.append("language", lang);
    body.append("duration", "20000");
    const response = await fetchFn(`${serviceUrl}/inference`, {
      method: "POST",
      body,
      signal: AbortSignal.timeout(45_000),
    });
    if (!response.ok) throw new MailError(503, "stt_unavailable");
    const result = await response.json().catch(() => null);
    const text = String(result?.text || "")
      .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, "")
      .trim()
      .slice(0, 12_000);
    if (!text) throw new MailError(422, "stt_no_speech");
    return { text, engine: "whisper.cpp-local", language: lang };
  } catch (error) {
    if (error instanceof MailError) throw error;
    throw new MailError(503, "stt_unavailable");
  } finally {
    active = false;
  }
}
