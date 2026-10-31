# Testes e Resultados (Fase 6)

## Suítes executadas (números reais)

| Suíte | Comando | Resultado |
|---|---|---|
| Backend (Node test runner) | `node --no-warnings --test tests/*.test.mjs` | **807/807 pass** (789 pré-existentes + 18 novos) |
| Frontend (Vitest) | `npx vitest run` | **148/148 pass** (132 pré-existentes + 16 novos) |
| Eval de agentes | `npm run eval:agents` | 6/6 pass |
| TypeScript | `npx tsc --noEmit` | 0 erros |
| Lint | `npx eslint .` | 0 erros |
| Build | `npm run build` | exit 0 |
| Migrações | incluídas na suíte backend (v0→v25 legado, banco limpo, idempotência) | pass |
| Demo de aceite | `node scripts/demo-fase6.mjs` | 18 passos concluídos (ver abaixo) |

## Novos testes backend (`tests/multimodal.test.mjs` — 18)

Cobertura do mandato §15 (números na ordem dos testes):

- **STT**: áudio válido + transcrição (4-6); MIME/assinatura inválidos rejeitados antes do
  provedor (23); provedor indisponível → turno `failed` com código estável, nada fictício,
  nada na conversa (7).
- **TTS**: síntese da resposta EXATA com metadados e sem persistência (8-10); provedor
  ocupado/fora → `voice_unavailable` propagado e turno `failed` (8-10).
- **Turn management**: texto→envio→resposta na MESMA conversa sem duplicação (1-3);
  correção manual (4-6); interrupção da síntese aborta o fetch REAL (11-12); interrupção
  durante a geração descarta resultado obsoleto (13); turnos concorrentes bloqueados (14);
  fechamento interrompe turnos ativos (15); timeout de turnos travados e expiração de
  sessões (17-18); recuperação de boot (19).
- **Eventos**: sequência tipada completa do mandato (25); teto de retenção de 500 (20).
- **Segurança**: prompt injection por transcrição é só texto — 0 aprovações, 0 execuções,
  auditoria sem conteúdo (21); mensagem vazia/transcrição ausente → erros estáveis (22);
  cross-owner invisível (16); sessão exige conversa do próprio dono (24).
- **Persistência**: tabelas v25 e `ownership` com `mm_session` (1).

## Novos testes frontend (`src/test/multimodal-ui.test.tsx` — 16)

- Mapeamento `avatarStateFromTurn`: todos os 7 estados, incluindo **mic desligado → nunca
  listening** e **sem áudio reproduzindo → nunca speaking**; sessão fechada → unavailable.
- `describeTurnState` (rótulos i18n), badge de turno, `shouldReduceMotion` (matchMedia
  mockado), `voiceCaptureAvailable`.
- `useAudioPlaying`: sincronização com eventos reais play/pause/ended/error.
- Render do `Avatar`: estados, fallback estático sob reduced-motion, `aria-label`.

## Demonstração de aceite (§16) — `scripts/demo-fase6.mjs`

Ambiente local controlado, banco efêmero, sem rede externa. Resultado observado:

1. Sessão multimodal aberta sobre conversa existente ✅
2. Captura de áudio ativada EXPLICITAMENTE (`listening`) ✅
3. Pergunta falada enviada — **fixture de STT declarada** (whisper.cpp não estava em
   execução; indisponibilidade explícita) ✅
4. Transcrição gerada (`whisper.cpp-local` via fixture) ✅
5. Transcrição vinculada ao turno da conversa, ainda não enviada ✅
6. Processamento pelo backend atual (`chatExchange` → Policy Engine/D9 intactos) ✅
7. Resposta textual produzida ✅
8. **Áudio gerado por TTS REAL** — `xtts-service` local via adaptador 7778
   (347.724 bytes, `audio/wav`, `tts_ms: 13.940` aquecido; síntese a frio medida em
   ~110 s com carregamento do modelo) ✅
9. Reprodução com metadados no turno; áudio NÃO persistido ✅
10. Estados do avatar derivados do estado real (`listening → thinking → speaking → idle`) ✅
11. Interrupção da reprodução (`interrupted`) ✅
12. Nova interação concluída ✅
13. Alternância para entrada textual na MESMA sessão ✅
14. Continuidade do contexto: histórico ÚNICO (user, assistant, user, assistant) ✅
15. Sessão encerrada; captura interrompida ✅
16. Retenção: 0 arquivos de áudio em disco; 11 eventos; apenas metadados de áudio ✅
17. TTS indisponível → erro EXPLÍCITO `voice_unavailable` (nada simulado) ✅
18. Instrução sensível reconhecida por voz → **0 aprovações criadas, 0 comandos
    executados**; D9 intocado ✅

## Reprodutibilidade

```bash
node scripts/demo-fase6.mjs                                    # demo de aceite
node --no-warnings --test tests/multimodal.test.mjs            # suíte da fase
npx vitest run src/test/multimodal-ui.test.tsx                 # testes de UI
```
