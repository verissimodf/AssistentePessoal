// Ponte de voz: traduz o contrato do Assistente Pessoal (POST /tts) para o
// xtts-service local (POST /voice/speak). Preserva a voz clonada "jarvis-ptbr"
// que o OpenJarvis usava. Escuta só em loopback (127.0.0.1:7778).
import { createServer } from "node:http";

const PORT = Number(process.env.VOICE_ADAPTER_PORT || 7778);
const XTTS = process.env.XTTS_URL || "http://127.0.0.1:8010";
const DEFAULT_SPEAKER = process.env.XTTS_SPEAKER || "jarvis-ptbr";

const server = createServer(async (req, res) => {
  if (req.method === "GET" && req.url === "/health") {
    res.writeHead(200, { "content-type": "application/json" });
    return res.end(JSON.stringify({ ok: true, service: "voice-adapter", xtts: XTTS, speaker: DEFAULT_SPEAKER }));
  }
  if (req.method === "POST" && req.url === "/tts") {
    let raw = "";
    for await (const c of req) raw += c;
    let b = {};
    try { b = raw ? JSON.parse(raw) : {}; } catch { /* corpo inválido */ }
    if (!b.text) { res.writeHead(400, { "content-type": "text/plain" }); return res.end("texto obrigatório"); }
    // O xtts-service espera application/x-www-form-urlencoded em /voice/speak.
    const form = new URLSearchParams({
      text: b.text,
      speaker: b.speaker || DEFAULT_SPEAKER,
      language: (b.lang || "pt").slice(0, 2),
    });
    try {
      const r = await fetch(`${XTTS}/voice/speak`, {
        method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: form,
      });
      if (!r.ok) { res.writeHead(502, { "content-type": "text/plain" }); return res.end(`xtts ${r.status}: ${await r.text()}`); }
      const buf = Buffer.from(await r.arrayBuffer());
      res.writeHead(200, { "content-type": r.headers.get("content-type") || "audio/wav", "content-length": buf.length });
      return res.end(buf);
    } catch (e) {
      res.writeHead(502, { "content-type": "text/plain" });
      return res.end(`xtts inacessível: ${e.message}`);
    }
  }
  res.writeHead(404, { "content-type": "text/plain" });
  res.end("not found");
});

server.listen(PORT, "127.0.0.1", () => console.log(`voice-adapter em http://127.0.0.1:${PORT} -> ${XTTS} (speaker ${DEFAULT_SPEAKER})`));
