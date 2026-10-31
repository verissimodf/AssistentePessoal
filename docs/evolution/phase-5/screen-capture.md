# Captura de tela — protocolo e retenção

## Canal de confiança: `screenshotBase64` pelo UDS

Fase 5 introduz a imagem do screenshot no contrato do worker (`scripts/browser-worker.mjs:5`):

- Worker: na op `screenshot`, o PNG volta em base64 **pelo socket Unix** (canal de confiança
  app↔worker) para o app persistir como artefato de evidência; o worker **não tem**
  volume/disco próprio (`scripts/browser-worker.mjs:148-153`).
  Resposta: `{ state: "completed", screenshotBytes, screenshotBase64 }`.
- Driver local (usado só em testes): mesma forma de retorno (`server/browser.js:260-264`).

## `saveScreenshot` no driver

`runBrowserAction(adminId, params, options)` aceita `options.saveScreenshot(buf)`
(`server/browser.js:447-453`):

1. Se o resultado traz `screenshotBase64` (string) e `saveScreenshot` é função, o buffer é
   decodificado e entregue ao callback.
2. O caminho retornado pelo callback vira `screenshotPath` no resultado estruturado
   (`server/browser.js:459`).
3. Falha do callback é silenciada (`screenshotPath = null`) — a captura não derruba a ação.
4. Quem decide o destino é o chamador: no motor CI, `observe` grava em
   `data/ci/<sessionId>/obs-<ts>.png` com modo `0o600` (`server/computer.js:132-137`).
5. Sem `saveScreenshot`, nada é escrito em disco — o PNG permanece só em memória
   (comportamento pré-Fase 5 preservado).

O transporte `managed` passa o corpo do worker por `redact` antes de devolver
(`server/browser.js:340`), mas o PNG em base64 é entregue ao callback antes disso no fluxo
do resultado — a imagem nunca é registrada em log.

## Segurança do transporte

- O worker gerenciado só é acessível pelo socket Unix privado do runtime
  (`server/browser.js:278-280`); no modo legacy TCP exige bearer token com
  `timingSafeEqual` e bind loopback (`scripts/browser-worker.mjs:177-181`).
- Diretório do socket criado com modo `0o700` e socket com `chmod 0o600`
  (`scripts/browser-worker.mjs:252-258`).
- A op `screenshot` exige `policyId` de egress válido (UUID v4) como as demais ops
  (`scripts/browser-worker.mjs:106-110`); o proxy de egress usa o `policyId` como
  credencial do contexto Playwright (`scripts/browser-worker.mjs:128-137`).

## Retenção dos PNGs

| Evento | Efeito |
|---|---|
| 31ª observação na sessão | observação mais antiga deletada do banco + PNG removido (`server/computer.js:117-126`) |
| Fechamento da sessão | todos os PNGs da sessão removidos (`unlinkSync`) e linhas de `ci_observations` deletadas (`server/computer.js:86-98`) |
| Hash | sobrevive em `ci_actions.observation_before/after` mesmo após a remoção (`server/computer.js:96`) |

Teto: `max_observations_per_session = 30` (`server/computer.js:31`). Não há política de
retenção além do ciclo da sessão — "nada fica em disco" após o fechamento
(`server/computer.js:86`).
