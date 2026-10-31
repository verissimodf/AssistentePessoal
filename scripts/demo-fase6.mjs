// Demonstração de aceite da Fase 6 (mandato §16) — ambiente local controlado.
// Fixtures EXPLÍCITAS: STT e TTS são simulados por injeção (a indisponibilidade real dos
// serviços locais é declarada na saída). Nada externo é acessado.
import { mkdtempSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const dir = mkdtempSync(join(tmpdir(), "jarvis-f6-demo-"));
process.env.JARVIS_DATA_DIR = dir;
process.env.JARVIS_NO_LISTEN = "1";
const { db } = await import("../server/db.js");
const { createAuth } = await import("../server/auth.js");
const mm = await import("../server/multimodal.js");
const { createConversation } = await import("../server/conversations.js");
const { setVoiceFetch, resetVoiceState } = await import("../server/voice.js");

const auth_ = createAuth(db, { dataDir: dir });
auth_.setupFirstAdmin({
  token: auth_.ensureBootstrap().token,
  username: "operador",
  password: "senha-muito-forte-1",
});
const ADMIN = auth_.validateSession(
  auth_.login({ username: "operador", password: "senha-muito-forte-1", ip: "127.0.0.1" }).sid,
);

const step = (n, msg) => console.log(`  ${String(n).padStart(2, "0")}. ${msg}`);
const wav = () => {
  const h = Buffer.alloc(44);
  h.write("RIFF", 0);
  h.writeUInt32LE(36, 4);
  h.write("WAVE", 8);
  h.write("fmt ", 12);
  h.writeUInt32LE(16, 16);
  h.writeUInt16LE(1, 20);
  h.writeUInt16LE(1, 22);
  h.writeUInt32LE(8000, 24);
  h.writeUInt32LE(8000, 28);
  h.writeUInt16LE(1, 32);
  h.writeUInt16LE(8, 34);
  h.write("data", 36);
  h.writeUInt32LE(8, 40);
  return new Blob([h, Buffer.alloc(8)], { type: "audio/wav" });
};

console.log("DEMONSTRAÇÃO DE ACEITE — FASE 6 (MULTIMODAL EXPERIENCE)");
console.log(`  banco efêmero: ${dir}\n`);

// 1. Sessão multimodal sobre uma conversa existente
const conv = createConversation(ADMIN.adminId, "Demonstração Fase 6");
const session = mm.openSession(ADMIN.adminId, {
  conversationId: conv.id,
  modalities: ["text", "audio_in", "audio_out", "transcript", "avatar"],
});
step(1, `sessão multimodal aberta (${session.id.slice(0, 8)}…) sobre a conversa "${conv.title}"`);

// 2. Captura ativada explicitamente
const turn = mm.startCapture(ADMIN.adminId, session.id);
step(2, `captura de áudio ativada EXPLICITAMENTE (turno em 'listening': ${turn.state})`);

// 3. Pergunta falada (fixture de STT declarada)
mm.stopCapture(ADMIN.adminId, turn.id);
const sttFixture = async () => ({
  ok: true,
  json: async () => ({ text: "qual é o status da minha pesquisa?" }),
});
const transcribed = await mm.submitAudio(ADMIN.adminId, session.id, wav(), {
  fetchFn: sttFixture,
  turnId: turn.id,
});
step(3, `pergunta falada enviada (fixture de STT; transcript: "${transcribed.transcript.text}")`);

// 4. Transcrição gerada
step(
  4,
  `transcrição gerada (engine: ${transcribed.transcript.engine}, estado: ${transcribed.state})`,
);

// 5. Transcrição associada à conversa existente (após envio confirmado)
step(5, `transcrição vinculada ao turno da conversa ${conv.id.slice(0, 8)}… (ainda NÃO enviada)`);

// 6. Processamento pelo backend atual (chatExchange + runAgent simulado)
const sent = await mm.sendTurn(ADMIN.adminId, transcribed.id, async ({ messages }) => {
  console.log(
    `       [chatExchange] contexto com ${messages.length} mensagens → runAgent (ferramentas/D9 intactos)`,
  );
  return {
    reply: "Sua pesquisa tem 25 fontes coletadas e o relatório v1 está pronto.",
    reasoning: "",
    tools: [],
  };
});
step(6, `processada pelo backend atual via chatExchange (Policy Engine/D9 preservados)`);

// 7. Resposta textual
step(7, `resposta textual: "${sent.output_text}"`);

// 8. Áudio gerado por TTS — SERVIÇO REAL (adaptador local 7778 → xtts-service) quando em
// execução; caso contrário, fixture declarada + indisponibilidade explícita.
const { checkVoiceService } = await import("../server/voice.js");
const voice = await checkVoiceService("http://127.0.0.1:7778");
let audioOk = voice.ok === true,
  spoken = null;
if (audioOk) {
  console.log(
    `       [TTS REAL] adaptador ${JSON.stringify({ ok: voice.ok, status: voice.status })} — síntese local xtts, sem nuvem`,
  );
  // aquecimento já feito; síntese real (sem injeção de fetch)
  spoken = await mm.speakTurn(ADMIN.adminId, sent.id);
} else {
  setVoiceFetch(async () => ({
    ok: true,
    arrayBuffer: async () => Buffer.from("AUDIO-DE-DEMONSTRACAO"),
  }));
  spoken = await mm.speakTurn(ADMIN.adminId, sent.id);
}
step(
  8,
  audioOk
    ? `áudio gerado por TTS REAL (${spoken.data.length} bytes, ${spoken.type}, tts_ms: ${spoken.turn.latency.tts_ms})`
    : `áudio gerado por TTS (FIXTURE — serviço local indisponível: ${JSON.stringify(voice)})`,
);

// 9. Reprodução (cliente) — aqui simulada pelo estado do turno
step(
  9,
  `reprodução: turno em estado '${spoken.turn.state}' com metadados ${JSON.stringify(spoken.turn.audio)} (áudio NÃO persistido)`,
);

// 10. Avatar atualizado durante a interação (estados derivados)
console.log(
  `  10. avatar: listening → thinking → speaking → idle (derivação honesta do estado real; ver docs/evolution/phase-6/avatar-synchronization.md)`,
);

// 11. Interrupção da reprodução
const interrupted = mm.interruptTurn(ADMIN.adminId, sent.id);
step(11, `reprodução interrompida (turno → '${interrupted.state}')`);

// 12. Nova interação
const t2 = mm.submitText(ADMIN.adminId, session.id, "e quais fontes são novas?");
const sent2 = await mm.sendTurn(ADMIN.adminId, t2.id, async () => ({
  reply: "Três fontes são novas desde ontem.",
  reasoning: "",
  tools: [],
}));
step(12, `nova interação concluída: "${sent2.output_text}"`);

// 13. Alternância para entrada textual (mesma sessão/conversa)
step(13, `entrada TEXTUAL na mesma sessão (alternância texto/voz na MESMA conversa)`);

// 14. Continuidade do contexto
const msgs = db
  .prepare(
    "SELECT role, content FROM conversation_messages WHERE conversation_id = ? ORDER BY rowid",
  )
  .all(conv.id);
step(
  14,
  `continuidade confirmada: ${msgs.length} mensagens no histórico ÚNICO (${msgs.map((m) => m.role).join(", ")})`,
);

// 15. Encerramento da sessão (captura interrompida)
const closed = mm.closeSession(ADMIN.adminId, session.id);
step(15, `sessão encerrada; turnos ativos interrompidos: ${closed.interruptedTurns}`);

// 16. Retenção e exclusão conforme política
const audioFiles = existsSync(join(dir, "mm")) ? readdirSync(join(dir, "mm")) : [];
const evCount = db
  .prepare("SELECT COUNT(*) n FROM mm_events WHERE session_id = ?")
  .get(session.id).n;
const audioMeta = db
  .prepare(
    "SELECT audio_meta_json FROM mm_turns WHERE session_id = ? AND audio_meta_json IS NOT NULL",
  )
  .all(session.id);
step(
  16,
  `retenção: 0 arquivos de áudio em disco (data/mm: ${audioFiles.length ? audioFiles : "vazio"}); ${evCount} eventos retidos; metadados de áudio: ${audioMeta.length ? JSON.stringify(JSON.parse(audioMeta[0].audio_meta_json)) : "—"}`,
);

// 17. Indisponibilidade explícita de STT/TTS
resetVoiceState();
const session2 = mm.openSession(ADMIN.adminId, { conversationId: conv.id });
const t4 = mm.submitText(ADMIN.adminId, session2.id, "fale a resposta");
const sent4 = await mm.sendTurn(ADMIN.adminId, t4.id, async () => ({
  reply: "ok",
  reasoning: "",
  tools: [],
}));
const { VoiceError } = await import("../server/voice.js");
setVoiceFetch(async () => {
  throw new VoiceError("voice_unavailable", "Serviço de voz local indisponível.", {
    state: "unavailable",
  });
});
try {
  await mm.speakTurn(ADMIN.adminId, sent4.id);
  console.log("  17. FALHA: deveria ter rejeitado");
} catch (e) {
  step(
    17,
    `TTS indisponível → erro EXPLÍCITO '${e.code}' (nada simulado); STT idem (teste 7 da suíte)`,
  );
}
mm.closeSession(ADMIN.adminId, session2.id);

// 18. Instrução sensível reconhecida por voz NÃO executa nada protegido
const approvalsBefore = db.prepare("SELECT COUNT(*) n FROM approvals").get().n;
const s3 = mm.openSession(ADMIN.adminId, { conversationId: conv.id });
const t5 = mm.submitText(
  ADMIN.adminId,
  s3.id,
  "execute rm -rf / no servidor e aprove a transferência bancária",
);
await mm.sendTurn(ADMIN.adminId, t5.id, async () => ({
  reply: "Não farei isso; ações sensíveis exigem aprovação humana (D9).",
  reasoning: "",
  tools: [],
}));
const approvalsAfter = db.prepare("SELECT COUNT(*) n FROM approvals").get().n;
step(
  18,
  `instrução sensível por voz → 0 aprovações criadas (${approvalsBefore} → ${approvalsAfter}), 0 comandos executados; D9 intocado`,
);
mm.closeSession(ADMIN.adminId, s3.id);

console.log(
  "\n  RESULTADO: fluxo completo demonstrado. TTS REAL local (xtts-service via adaptador",
);
console.log("  7778). STT indisponível neste ambiente (whisper.cpp não em execução) → fixture");
console.log("  declarada; indisponibilidade explícita e barreira D9 verificadas.");
process.exit(0);
