#!/usr/bin/env node
// Utilitário de diagnóstico e healthcheck para o serviço de voz local do Jarvis.
const url = process.env.JARVIS_VOICE_URL || "http://127.0.0.1:7778";

console.log(`[Jarvis Voice Check] Sondando ${url}...`);

try {
  const r = await fetch(`${url}/health`, { signal: AbortSignal.timeout(3000) });
  if (r.ok) {
    console.log(`[OK] Serviço de voz local respondendo com sucesso em ${url}`);
    process.exit(0);
  } else {
    console.warn(`[AVISO] Serviço de voz retornou status HTTP ${r.status}`);
    process.exit(1);
  }
} catch (err) {
  console.warn(`[AVISO] Serviço de voz local offline em ${url}: ${err.cause?.code || err.message}`);
  console.log(`\nInstruções para inicialização:`);
  console.log(`  1. Instale os modelos/dependências se necessário:`);
  console.log(`     scripts\\instalar-voz.cmd (Windows) ou scripts/instalar-voz.sh (Linux)`);
  console.log(`  2. Inicie o servidor Python:`);
  console.log(`     python scripts/voz/voice_service.py`);
  console.log(`  3. O serviço ouvirá em http://127.0.0.1:7778/tts e /health.\n`);
  process.exit(1);
}
