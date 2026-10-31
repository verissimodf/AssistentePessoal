# Decisões Técnicas — Fase 6 (ADRs)

## ADR-MM-001 — Motor multimodal como camada de entrada/apresentação sobre `chatExchange`

**Contexto**: o mandato proíbe segundo backend conversacional, segundo runtime de agentes
ou segunda memória.
**Decisão**: `server/multimodal.js` orquestra sessões/turnos/eventos, mas toda mensagem
enviada passa por `chatExchange` (conversations.js) e `runAgent`. Histórico, memória,
Policy Engine, D9 e idempotência ficam intocados.
**Consequência**: zero risco de divergência de histórico; funcionalidades multimodais
herdam automaticamente evoluções do chat.

## ADR-MM-002 — Reuso dos motores STT/TTS existentes com injeção para testes

**Contexto**: `server/stt.js` (whisper.cpp local) e `server/voice.js` (xtts/kokoro/
ElevenLabs) já existem, são substituíveis e testados.
**Decisão**: reusar sem modificações de contrato; fixtures via `setVoiceFetch`/`fetchFn`.
**Consequência**: nenhuma dependência nova; provedores de teste não tocam a rede.

## ADR-MM-003 — Nenhum áudio bruto persistido no servidor

**Contexto**: §11 e §12.2 — armazenar apenas o necessário; não guardar áudio quando
transcrição/metadados bastam.
**Decisão**: áudio capturado e sintetizado existem só em trânsito (multipart/HTTP
response). O banco guarda `transcript_json` e `audio_meta_json` (`type`, `bytes`, `tts_ms`).
**Consequência**: privacidade por construção; exclusão consistente é trivial (nada para
apagar).

## ADR-MM-004 — Eventos por polling incremental, sem novo transporte

**Contexto**: §8.1 pede eventos tipados; o stack não tem WebSocket (Fases 0–5 usam HTTP +
NDJSON pontual em `/api/chat/stream`).
**Decisão**: `GET /api/mm/events?sinceId=` sobre a infraestrutura HTTP existente.
**Consequência**: zero infraestrutura paralela; streaming de deltas de texto/áudio fica
explicitamente fora (limitação honesta), e os nomes de eventos já reservados.

## ADR-MM-005 — Escopos existentes (`chat`, `voice`), nenhum escopo novo

**Contexto**: rotas precisam declarar acesso; multimodal é a mesma superfície
conversacional do admin verificado, com áudio já regulado pelo escopo `voice`.
**Decisão**: sessões/turnos → `chat`; captura/transcrição/síntese → `voice`. Nada novo
em `SCOPES`, `BOT_SCOPES` ou `TOOL_SCOPES`.
**Consequência**: deny-by-default preservado; nenhum token/bot ganha poder novo; contagem
de ferramentas do diagnóstico inalterada (29).

## ADR-MM-006 — Avatar 100% cliente (SVG/CSS), sem dependências

**Contexto**: §9.4 — não adicionar dependências gráficas pesadas sem justificativa; a
interface deve funcionar sem o avatar.
**Decisão**: componente SVG/CSS com animações por estado; `prefers-reduced-motion`
desliga animações (fallback estático com cor/ícone distintos); estado derivado de
eventos e do estado real dos turnos (`avatarStateFromTurn`).
**Consequência**: custo de CPU/GPU mínimo; falha do avatar não bloqueia a conversa.

## ADR-MM-007 — VAD real fica para depois (gate duplo conservador)

**Contexto**: §7.2 — distinguir fala/silêncio/ruído sem tratar ruído como comando.
**Decisão**: nesta fase o controle é explícito (início/fim por ação do usuário + envio
confirmado), o que elimina por construção o risco de ruído virar comando. VAD automático
(p.ex. silero/RMS no cliente) é caminho de upgrade documentado que apenas aceleraria o
fluxo — a barreira de confirmação permanece.
**Consequência**: menos latência otimista inventada; nenhuma dependência nova.

## ADR-MM-008 — Interrupção de geração: descarte lógico em vez de cancelamento físico

**Contexto**: `chatExchange`/`runAgent` não expõem cancelamento cooperativo; criar um
segundo mecanismo de cancelamento duplicaria o runtime.
**Decisão**: interromper marca o turno (`interrupted`) e descarta o resultado tardio
(guarda de obsolescência); a troca persistida no histórico não é apagada (dados nunca
são apagados silenciosamente). Cancelamento FÍSICO real existe na síntese (AbortController).
**Consequência**: sem bypass e sem perda de dados; limitação documentada.
