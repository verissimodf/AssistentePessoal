// Multimodal Session Engine — evolução Fase 6 (docs/evolution/phase-6/session-engine.md).
// Camada de ENTRADA/APRESENTAÇÃO sobre o sistema conversacional EXISTENTE: sessões
// multimodais com turnos persistentes e eventos tipados. NÃO há segundo backend
// conversacional, histórico duplicado ou memória paralela — toda mensagem enviada passa
// por `chatExchange` (conversations.js), que segue sendo a fonte da verdade.
//
// Invariantes (ADR-MM-001..006):
//  - Transcrição ≠ autorização: nada aqui concede escopos; escritas seguem Policy Engine/D9.
//  - Áudio bruto NUNCA é persistido no servidor: transcrição + metadados bastam (ADR-MM-003);
//    o áudio sintetizado pelo TTS é devolvido na resposta HTTP e não fica em disco.
//  - Indisponibilidade é EXPLÍCITA: STT/TTS fora do ar produzem turnos `failed` com código
//    estável — nunca um resultado fictício.
//  - Eventos obsoletos são descartados: um resultado antigo nunca substitui um turno
//    interrompido (guarda de obsolescência por estado).
import { db, now, uid, audit } from "./db.js";
import { assignNew, owns, tx } from "./ownership.js";
import { transcribeAudio } from "./stt.js";
import { tts, VoiceError } from "./voice.js";
import { chatExchange, validateMessage } from "./conversations.js";

const parseJson = (t, f) => {
  if (t === null || t === undefined) return f;
  try {
    const v = JSON.parse(t);
    return v && typeof v === "object" ? v : f;
  } catch {
    return f;
  }
};
const clean = (v, max) => String(v ?? "").slice(0, max);

export const MM_LIMITS = {
  max_turns_per_session: 200,
  max_events_per_session: 500,
  max_session_runtime_ms: 2 * 60 * 60 * 1000, // sessão ativa sem uso há 2 h é fechada
  max_turn_runtime_ms: 5 * 60 * 1000, // turno em estado transitório há 5 min falha
  max_transcript_chars: 16_000, // mesmo teto de MAX_MESSAGE_CHARS
  max_segments: 200,
};

export const TURN_STATES = new Set([
  "idle",
  "listening",
  "transcribing",
  "processing",
  "generating",
  "speaking",
  "interrupted",
  "completed",
  "failed",
]);
export const ACTIVE_TURN_STATES = new Set([
  "listening",
  "transcribing",
  "processing",
  "generating",
  "speaking",
]);
export const MODALITIES = new Set([
  "text",
  "audio_in",
  "audio_out",
  "transcript",
  "image",
  "avatar",
]);

export class MmError extends Error {
  constructor(code, message) {
    super(message ?? code);
    this.name = "MmError";
    this.code = code;
  }
}

// Sínteses em curso por turno: `interruptTurn` aborta o fetch do TTS (cancelamento REAL).
const inflightTts = new Map();

// ---------- eventos ----------

function addEvent(sessionId, turnId, kind, payload = {}) {
  db.prepare(
    "INSERT INTO mm_events (session_id, turn_id, kind, payload_json, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(sessionId, turnId, kind, JSON.stringify(payload), now());
  // Retenção: mantém apenas os últimos N eventos da sessão (auditoria recente, sem crescimento).
  const count = db
    .prepare("SELECT COUNT(*) n FROM mm_events WHERE session_id = ?")
    .get(sessionId).n;
  if (count > MM_LIMITS.max_events_per_session) {
    const cut = db
      .prepare("SELECT id FROM mm_events WHERE session_id = ? ORDER BY id DESC LIMIT 1 OFFSET ?")
      .get(sessionId, MM_LIMITS.max_events_per_session);
    if (cut)
      db.prepare("DELETE FROM mm_events WHERE session_id = ? AND id <= ?").run(sessionId, cut.id);
  }
}

// ---------- sessões ----------

function getConversationRow(adminId, id) {
  return adminId && id
    ? db
        .prepare("SELECT id FROM conversations WHERE id = ? AND admin_id = ?")
        .get(String(id), adminId)
    : null;
}

export function openSession(
  adminId,
  { conversationId, modalities = ["text", "transcript"], config = {} } = {},
) {
  if (!adminId) throw new MmError("mm_owner_required");
  if (!getConversationRow(adminId, conversationId)) throw new MmError("mm_conversation_required");
  const mods = (Array.isArray(modalities) ? modalities : []).filter((m) => MODALITIES.has(m));
  const id = uid();
  const ts = now();
  tx(() => {
    db.prepare(
      "INSERT INTO mm_sessions (id, owner_admin_id, conversation_id, status, modalities_json, state_json, created_at, updated_at) VALUES (?, ?, ?, 'active', ?, '{}', ?, ?)",
    ).run(
      id,
      adminId,
      String(conversationId),
      JSON.stringify(mods.length ? mods : ["text"]),
      ts,
      ts,
    );
    assignNew("mm_session", id, adminId);
  });
  audit("mm.session_opened", { admin: adminId, ids: [id], type: "multimodal" });
  addEvent(id, null, "session.started", { modalities: mods });
  return getSession(adminId, id);
}

export const listSessions = (adminId, { limit = 50 } = {}) =>
  adminId
    ? db
        .prepare(
          "SELECT id, conversation_id, status, modalities_json, created_at, updated_at, closed_at FROM mm_sessions WHERE owner_admin_id = ? ORDER BY created_at DESC LIMIT ?",
        )
        .all(adminId, Math.min(Math.max(Number(limit) || 50, 1), 200))
        .map((r) => ({ ...r, modalities: parseJson(r.modalities_json, []) }))
    : [];

export function getSession(adminId, id) {
  if (!owns(adminId, "mm_session", id)) return null;
  const row = db.prepare("SELECT * FROM mm_sessions WHERE id = ?").get(id);
  if (!row) return null;
  const turns = db
    .prepare("SELECT * FROM mm_turns WHERE session_id = ? ORDER BY seq")
    .all(id)
    .map(turnView);
  return {
    ...row,
    modalities: parseJson(row.modalities_json, []),
    state: parseJson(row.state_json, {}),
    turns,
    events: db
      .prepare(
        "SELECT id, turn_id, kind, payload_json, created_at FROM mm_events WHERE session_id = ? ORDER BY id",
      )
      .all(id)
      .map((e) => ({ ...e, payload: parseJson(e.payload_json, {}) })),
  };
}

export function closeSession(adminId, id) {
  if (!owns(adminId, "mm_session", id)) return { error: "not_found" };
  const s = db.prepare("SELECT * FROM mm_sessions WHERE id = ?").get(id);
  if (!s || s.status !== "active") return { error: "mm_session_not_active" };
  // Turnos ativos são interrompidos: captura/geração/fala não sobrevivem ao fechamento.
  const active = db
    .prepare(
      `SELECT id FROM mm_turns WHERE session_id = ? AND state IN ('listening','transcribing','processing','generating','speaking')`,
    )
    .all(id);
  const ts = now();
  tx(() => {
    for (const t of active) {
      db.prepare(
        "UPDATE mm_turns SET state='interrupted', error_code='mm_session_closed', updated_at=? WHERE id=?",
      ).run(ts, t.id);
      addEvent(id, t.id, "response.interrupted", { reason: "mm_session_closed" });
    }
    db.prepare("UPDATE mm_sessions SET status='closed', closed_at=?, updated_at=? WHERE id=?").run(
      ts,
      ts,
      id,
    );
  });
  audit("mm.session_closed", { admin: adminId, ids: [id], interruptedTurns: active.length });
  return { ok: true, interruptedTurns: active.length };
}

// ---------- turnos ----------

const turnView = (r) => ({
  id: r.id,
  session_id: r.session_id,
  conversation_id: r.conversation_id,
  seq: r.seq,
  state: r.state,
  input_kind: r.input_kind,
  input_text: r.input_text,
  transcript: parseJson(r.transcript_json, null),
  reply_message_id: r.reply_message_id,
  output_text: r.output_text,
  audio: parseJson(r.audio_meta_json, null),
  error_code: r.error_code,
  latency: parseJson(r.latency_json, {}),
  created_at: r.created_at,
  updated_at: r.updated_at,
});

function getTurn(adminId, turnId) {
  const t = db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(String(turnId));
  return t && owns(adminId, "mm_session", t.session_id) ? t : null;
}

function sessionOf(adminId, sessionId) {
  const s = db.prepare("SELECT * FROM mm_sessions WHERE id = ?").get(String(sessionId));
  return s && s.status === "active" && owns(adminId, "mm_session", sessionId) ? s : null;
}

/** Cria um turno em escuta (captura de microfone EXPLÍCITA; nada é ativado sozinho). */
export function startCapture(adminId, sessionId) {
  const s = sessionOf(adminId, sessionId);
  if (!s) throw new MmError("mm_session_not_active");
  return createTurn(adminId, s, "audio", "listening");
}

function createTurn(adminId, s, inputKind, state) {
  const activeCount = db
    .prepare(
      "SELECT COUNT(*) n FROM mm_turns WHERE session_id = ? AND state IN ('listening','transcribing','processing','generating','speaking')",
    )
    .get(s.id).n;
  if (activeCount > 0) throw new MmError("mm_turn_concurrent"); // um turno ativo por sessão
  const total = db.prepare("SELECT COUNT(*) n FROM mm_turns WHERE session_id = ?").get(s.id).n;
  if (total >= MM_LIMITS.max_turns_per_session) throw new MmError("mm_turn_limit");
  const id = uid();
  const ts = now();
  db.prepare(
    "INSERT INTO mm_turns (id, session_id, conversation_id, seq, state, input_kind, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  ).run(id, s.id, s.conversation_id, total + 1, state, inputKind, ts, ts);
  db.prepare("UPDATE mm_sessions SET updated_at = ? WHERE id = ?").run(ts, s.id);
  if (state === "listening") addEvent(s.id, id, "audio.capture.started", { turn_id: id });
  return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(id));
}

export function stopCapture(adminId, turnId) {
  const t = getTurn(adminId, turnId);
  if (!t) throw new MmError("not_found");
  if (t.state !== "listening") throw new MmError("mm_turn_not_listening");
  db.prepare("UPDATE mm_turns SET state='idle', updated_at=? WHERE id=?").run(now(), t.id);
  addEvent(t.session_id, t.id, "audio.capture.stopped", { turn_id: t.id });
  return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(t.id));
}

/**
 * Submete áudio ao STT (interface substituível — whisper.cpp local; fixtures via injeção
 * em `transcribeAudio`). A transcrição é ENTRADA CANDIDATA: só vira mensagem após `sendTurn`.
 */
export async function submitAudio(
  adminId,
  sessionId,
  file,
  { language = "pt", fetchFn = null, turnId = null } = {},
) {
  const s = sessionOf(adminId, sessionId);
  if (!s) throw new MmError("mm_session_not_active");
  let turn = turnId ? getTurn(adminId, turnId) : null;
  if (turn && turn.session_id !== s.id) throw new MmError("not_found");
  if (!turn) turn = createTurn(adminId, s, "audio", "listening");
  if (!["listening", "idle"].includes(turn.state)) throw new MmError("mm_turn_not_listening");
  const started = Date.now();
  setTurnState(turn.id, "transcribing");
  try {
    const result = await transcribeAudio(adminId, file, {
      language,
      ...(fetchFn ? { fetchFn } : {}),
    });
    const ms = Date.now() - started;
    attachTranscriptRow(turn.id, result.text, { ...result, corrected: false, latency_ms: ms });
    const view = turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(turn.id));
    addEvent(s.id, turn.id, "transcription.completed", {
      turn_id: turn.id,
      language: result.language,
      engine: result.engine,
      latency_ms: ms,
    });
    return view;
  } catch (e) {
    const code = e?.code || "mm_stt_failed";
    failTurn(turn.id, code);
    addEvent(s.id, turn.id, "session.error", { turn_id: turn.id, scope: "stt", code });
    throw e;
  }
}

/** Texto direto (digitação) ou correção manual da transcrição — candidata a envio. */
export function attachTranscript(adminId, turnId, text, { corrected = false } = {}) {
  const t = getTurn(adminId, turnId);
  if (!t) throw new MmError("not_found");
  if (!["listening", "idle", "transcribing", "interrupted"].includes(t.state))
    throw new MmError("mm_turn_not_editable");
  const trimmed = validateMessage(text); // mesmos tetos da mensagem de chat (16.000 chars)
  attachTranscriptRow(t.id, trimmed, { text: trimmed, corrected, engine: "manual" });
  addEvent(t.session_id, t.id, "transcription.completed", {
    turn_id: t.id,
    corrected,
    engine: "manual",
  });
  return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(t.id));
}

/** Envia o texto para o turno (alternância texto/voz): cria turno `idle` com transcrição pronta. */
export function submitText(adminId, sessionId, text) {
  const s = sessionOf(adminId, sessionId);
  if (!s) throw new MmError("mm_session_not_active");
  const turn = createTurn(adminId, s, "text", "idle");
  const trimmed = validateMessage(text);
  attachTranscriptRow(turn.id, trimmed, { text: trimmed, corrected: false, engine: "text" });
  addEvent(s.id, turn.id, "transcription.completed", { turn_id: turn.id, engine: "text" });
  return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(turn.id));
}

function attachTranscriptRow(turnId, text, meta) {
  db.prepare("UPDATE mm_turns SET transcript_json = ?, updated_at = ? WHERE id = ?").run(
    JSON.stringify({ text: clean(text, MM_LIMITS.max_transcript_chars), ...meta }),
    now(),
    turnId,
  );
}

function setTurnState(turnId, state) {
  db.prepare("UPDATE mm_turns SET state = ?, updated_at = ? WHERE id = ?").run(
    state,
    now(),
    turnId,
  );
}

function failTurn(turnId, code) {
  db.prepare("UPDATE mm_turns SET state='failed', error_code = ?, updated_at = ? WHERE id = ?").run(
    clean(code, 64),
    now(),
    turnId,
  );
}

/**
 * Envia a transcrição CONFIRMADA para a conversa associada — via `chatExchange`, o MESMO
 * caminho do chat textual (Policy Engine, D9, idempotência e persistência intactos).
 * `run` é injetado pela rota (runAgent/evaluateReflex) — o motor não conhece o modelo.
 * Guarda de obsolescência: se o turno foi interrompido durante a geração, o resultado é
 * DESCARTADO (uma resposta antiga nunca substitui um turno mais recente).
 */
export async function sendTurn(adminId, turnId, run) {
  const t = getTurn(adminId, turnId);
  if (!t) throw new MmError("not_found");
  if (!["idle", "transcribing", "listening"].includes(t.state))
    throw new MmError("mm_turn_not_sendable");
  const transcript = parseJson(t.transcript_json, null);
  if (!transcript?.text) throw new MmError("mm_transcript_required");
  const s = db.prepare("SELECT * FROM mm_sessions WHERE id = ?").get(t.session_id);
  if (!s || s.status !== "active") throw new MmError("mm_session_not_active");

  db.prepare("UPDATE mm_turns SET input_text = ?, state='processing', updated_at=? WHERE id=?").run(
    clean(transcript.text, MM_LIMITS.max_transcript_chars),
    now(),
    t.id,
  );
  addEvent(s.id, t.id, "response.started", { turn_id: t.id });
  const started = Date.now();
  setTurnState(t.id, "generating");
  try {
    const ax = await chatExchange(
      adminId,
      {
        conversationId: s.conversation_id,
        message: transcript.text,
        clientMsgId: null,
        agentId: null,
      },
      run,
    );
    // Obsolescência: interrupção durante a geração descarta o resultado (evento tardio).
    const cur = db.prepare("SELECT state FROM mm_turns WHERE id = ?").get(t.id);
    if (cur?.state === "interrupted")
      return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(t.id));
    const ms = Date.now() - started;
    db.prepare(
      "UPDATE mm_turns SET reply_message_id = ?, output_text = ?, state='completed', latency_json = ?, updated_at = ? WHERE id = ?",
    ).run(
      ax.assistantMessageId,
      clean(ax.reply, MM_LIMITS.max_transcript_chars),
      JSON.stringify({ generation_ms: ms }),
      now(),
      t.id,
    );
    addEvent(s.id, t.id, "response.completed", {
      turn_id: t.id,
      reply_message_id: ax.assistantMessageId,
      latency_ms: ms,
    });
    return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(t.id));
  } catch (e) {
    const cur = db.prepare("SELECT state FROM mm_turns WHERE id = ?").get(t.id);
    if (cur?.state === "interrupted")
      return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(t.id));
    failTurn(t.id, e?.code || "mm_generation_failed");
    addEvent(s.id, t.id, "session.error", {
      turn_id: t.id,
      scope: "generation",
      code: e?.code || "mm_generation_failed",
    });
    throw e;
  }
}

/** Sintetiza a fala da resposta (TTS substituível) — áudio volta na resposta, sem persistir. */
export async function speakTurn(adminId, turnId, { lang = "pt-BR" } = {}) {
  const t = getTurn(adminId, turnId);
  if (!t) throw new MmError("not_found");
  if (t.state !== "completed" || !t.output_text) throw new MmError("mm_turn_not_speakable");
  setTurnState(t.id, "speaking");
  addEvent(t.session_id, t.id, "response.speaking", { turn_id: t.id });
  const started = Date.now();
  const ctl = new AbortController();
  inflightTts.set(t.id, ctl);
  try {
    const a = await tts(t.output_text, lang, adminId, { signal: ctl.signal });
    const ms = Date.now() - started;
    // Metadados apenas: tipo MIME e tamanho. O áudio NÃO é persistido (ADR-MM-003).
    db.prepare(
      "UPDATE mm_turns SET audio_meta_json = ?, latency_json = ?, state='completed', updated_at = ? WHERE id = ?",
    ).run(
      JSON.stringify({ type: a.type, bytes: a.data.length, tts_ms: ms }),
      JSON.stringify({ ...parseJson(t.latency_json, {}), tts_ms: ms }),
      now(),
      t.id,
    );
    return {
      type: a.type,
      data: a.data,
      turn: turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(t.id)),
    };
  } catch (e) {
    const cur = db.prepare("SELECT state FROM mm_turns WHERE id = ?").get(t.id);
    if (cur?.state === "interrupted") return null; // interrompido durante a síntese: nada a devolver
    if (e instanceof VoiceError) failTurn(t.id, e.code);
    else failTurn(t.id, "mm_tts_failed");
    addEvent(t.session_id, t.id, "session.error", {
      turn_id: t.id,
      scope: "tts",
      code: e?.code || "mm_tts_failed",
    });
    throw e;
  } finally {
    inflightTts.delete(t.id);
  }
}

/** Interrupção: cancela síntese em curso (AbortController) e marca o turno como interrompido. */
export function interruptTurn(adminId, turnId) {
  const t = getTurn(adminId, turnId);
  if (!t) throw new MmError("not_found");
  if (!ACTIVE_TURN_STATES.has(t.state) && t.state !== "completed")
    throw new MmError("mm_turn_not_interruptible");
  inflightTts.get(t.id)?.abort();
  setTurnState(t.id, "interrupted");
  db.prepare("UPDATE mm_turns SET error_code = 'mm_interrupted', updated_at = ? WHERE id = ?").run(
    now(),
    t.id,
  );
  addEvent(t.session_id, t.id, "response.interrupted", { turn_id: t.id });
  return turnView(db.prepare("SELECT * FROM mm_turns WHERE id = ?").get(t.id));
}

/** Eventos da sessão desde `sinceId` (polling; sem segunda infraestrutura de transporte). */
export function listEvents(adminId, sessionId, { sinceId = 0, limit = 200 } = {}) {
  if (!owns(adminId, "mm_session", sessionId)) return null;
  return db
    .prepare(
      "SELECT id, turn_id, kind, payload_json, created_at FROM mm_events WHERE session_id = ? AND id > ? ORDER BY id LIMIT ?",
    )
    .all(
      String(sessionId),
      Math.max(0, Number(sinceId) || 0),
      Math.min(Math.max(Number(limit) || 200, 1), 500),
    )
    .map((e) => ({ ...e, payload: parseJson(e.payload_json, {}) }));
}

// ---------- recuperação e tick ----------

/** Boot: turnos que sobreviveram a um reinício em estado transitório falham EXPLICITAMENTE. */
export function recoverMmTurns() {
  const rows = db
    .prepare(
      `SELECT id, session_id FROM mm_turns WHERE state IN ('listening','transcribing','processing','generating','speaking')`,
    )
    .all();
  for (const r of rows) {
    failTurn(r.id, "mm_interrupted_boot");
    addEvent(r.session_id, r.id, "session.error", {
      turn_id: r.id,
      scope: "recovery",
      code: "mm_interrupted_boot",
    });
  }
  if (rows.length) audit("mm.turns_recovered", { count: rows.length });
  return rows.length;
}

/** Tick: sessões ociosas além do teto são fechadas; turnos travados falham com código estável. */
export function tickMmSessions({ nowMs = Date.now() } = {}) {
  const cut = new Date(nowMs - MM_LIMITS.max_session_runtime_ms).toISOString();
  const stale = db
    .prepare(
      "SELECT id, owner_admin_id FROM mm_sessions WHERE status = 'active' AND updated_at < ?",
    )
    .all(cut);
  for (const s of stale) {
    const ts = now();
    db.prepare("UPDATE mm_sessions SET status='closed', closed_at=?, updated_at=? WHERE id=?").run(
      ts,
      ts,
      s.id,
    );
    audit("mm.session_expired", { admin: s.owner_admin_id, ids: [s.id] });
  }
  const turnCut = new Date(nowMs - MM_LIMITS.max_turn_runtime_ms).toISOString();
  const stuck = db
    .prepare(
      `SELECT id, session_id FROM mm_turns WHERE state IN ('listening','transcribing','processing','generating','speaking') AND updated_at < ?`,
    )
    .all(turnCut);
  for (const t of stuck) {
    failTurn(t.id, "mm_turn_timeout");
    addEvent(t.session_id, t.id, "session.error", {
      turn_id: t.id,
      scope: "timeout",
      code: "mm_turn_timeout",
    });
  }
  return { sessionsClosed: stale.length, turnsFailed: stuck.length };
}
