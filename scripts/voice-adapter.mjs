// Ponte local e restrita ao loopback: traduz POST /tts para as rotas do xtts-service.
import { createServer } from "node:http";
import { AdapterRequestError, prepareXttsRequest, readJsonBody } from "./voice-adapter-core.mjs";

const PORT = Number(process.env.VOICE_ADAPTER_PORT || 7778);
const XTTS = process.env.XTTS_URL || "http://127.0.0.1:8010";
const DEFAULT_SPEAKER = process.env.XTTS_SPEAKER || "jarvis-ptbr";
const MAX_AUDIO_BYTES = 50 * 1024 * 1024;
const json = (res, status, payload) => {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
};

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    try {
      const upstream = await fetch(new URL("/health", XTTS), {
        signal: AbortSignal.timeout(2500),
      });
      if (!upstream.ok) return json(res, 503, { ok: false, error: "voice_unavailable" });
      const state = await upstream.json();
      return json(res, 200, {
        ok: true,
        service: "voice-adapter",
        engine: "xtts",
        modelLoaded: state.model_loaded === true,
        device: typeof state.device === "string" ? state.device : "unknown",
      });
    } catch {
      return json(res, 503, { ok: false, error: "voice_unavailable" });
    }
  }

  if (req.method !== "POST" || req.url !== "/tts") return json(res, 404, { error: "not_found" });

  let controller;
  try {
    const body = await readJsonBody(req);
    const upstreamRequest = await prepareXttsRequest(body, {
      xttsUrl: XTTS,
      defaultSpeaker: DEFAULT_SPEAKER,
    });
    controller = new AbortController();
    res.on("close", () => {
      if (!res.writableEnded) controller.abort();
    });
    const upstream = await fetch(upstreamRequest.url, {
      ...upstreamRequest.init,
      signal: AbortSignal.any([controller.signal, AbortSignal.timeout(180_000)]),
    });
    if (!upstream.ok) return json(res, 502, { error: "voice_upstream_failed" });

    const contentLength = Number(upstream.headers.get("content-length") || 0);
    if (contentLength > MAX_AUDIO_BYTES)
      return json(res, 502, { error: "voice_response_too_large" });
    const audio = Buffer.from(await upstream.arrayBuffer());
    if (!audio.length || audio.length > MAX_AUDIO_BYTES)
      return json(res, 502, { error: "voice_response_invalid" });
    res.writeHead(200, {
      "content-type": upstream.headers.get("content-type") || "audio/wav",
      "content-length": audio.length,
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
    });
    return res.end(audio);
  } catch (error) {
    if (res.destroyed) return;
    if (error instanceof AdapterRequestError) return json(res, error.status, { error: error.code });
    return json(res, 502, { error: "voice_unavailable" });
  }
});

server.maxHeadersCount = 32;
server.headersTimeout = 10_000;
server.requestTimeout = 30_000;
server.listen(PORT, "127.0.0.1", () => {
  console.log(`voice-adapter em 127.0.0.1:${PORT} -> xtts-service (speaker ${DEFAULT_SPEAKER})`);
});

// Exported for test cleanup and deterministic startup checks.
export { server };
