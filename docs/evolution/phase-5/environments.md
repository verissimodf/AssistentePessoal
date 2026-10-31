# Ambientes da Fase 5

## Ambiente `browser` (produção)

Sessões de navegador sobre o worker Playwright gerenciado existente.

- Declarado em `ci_sessions.environment` — CHECK aceita apenas `'browser'` e `'fixture'`
  (`server/migrations.js:1595`).
- Habilitação via settings globais: `integrations.browser.enabled === true` ou
  `integrations.browser.mode === "managed"`; caso contrário `openSession` lança
  **`ci_browser_disabled`** — indisponibilidade explícita, nunca simulada
  (`server/computer.js:52-55`; teste em `tests/computer.test.mjs:199-203`).
- Config efetiva do driver (`server/browser.js:51-80`):
  - modos: `off` (padrão) / `remote` (HTTP legado, **recusado** em execução) / `managed`
    (UDS + policy socket presentes) / `unavailable` (`server/browser.js:58-64`).
  - `allowedHosts` normalizados (`browser-approval.js`) e checados em
    `validateBrowserRequest` (`server/browser.js:145-150`).
- A sessão persiste até 20 hosts permitidos em `config_json.allowedHosts`
  (`server/computer.js:61`) — são metadados da sessão; a checagem efetiva de destino continua
  no `runBrowserAction`/worker (allowlist do settings + política de rede + egress pinado).
- Capacidades: operações de lista fechada `navigate, extract, click, fill, wait_for,
  screenshot` (`server/browser.js:27`, `scripts/browser-worker.mjs:33`). Sem shell, download,
  eval ou upload (`scripts/browser-worker.mjs:12`).
- Limites do driver: `BROWSER_LIMITS` — timeout 1–60 s (padrão 20 s), seletor ≤300 chars,
  texto ≤1 000 chars, saída ≤4 000 chars (`server/browser.js:35-42`).

### Indisponibilidade em camadas

| Camada | Sinal |
|---|---|
| Sessão CI | `ci_browser_disabled` (`server/computer.js:55`) |
| Driver `off` | `browser_disabled` (`server/browser.js:367-373`) |
| Transporte HTTP legado | `browser_untrusted_transport` (`server/browser.js:374-380`) |
| Sem worker configurado | `browser_worker_required` (`server/browser.js:381-388`) |
| Sem broker de egress | `browser_policy_unavailable` (`server/browser.js:302-307`) |

## Ambiente `fixture` (testes)

- Uso: `openSession(adminId, { environment: "fixture" })` — não exige browser habilitado
  (só o ambiente `browser` passa pelo gate de `computer.js:53-55`).
- Empregado no teste de isolamento (`tests/computer.test.mjs:209`).
- Os demais testes usam ambiente `browser` real com um **worker fake no mesmo transporte
  Unix** (`JARVIS_BROWSER_WORKER_SOCKET`/`JARVIS_BROWSER_POLICY_SOCKET` apontando para
  sockets de um diretório temporário — `tests/computer.test.mjs:17-20`), seguindo o padrão
  de `tests/browser-tool.test.mjs`. O app falso responde `/run` (screenshot/extract/navigate/
  click) e `/cancel` (`tests/computer.test.mjs:46-79`).
- Injeções de teste suportadas pelo motor: `config`, `loadPlaywright` (seam do driver,
  `server/browser.js:400-401`) e `oneShotFn` (plano determinístico, `server/computer.js:180-185`).

## O que NÃO existe

- Nenhum ambiente de desktop nativo (ADR-EVO-008 segue com a fronteira desenhada, execução
  de GUI nativa não implementada).
- Nenhum ambiente remoto/cloud; o modo `remote` é recusado em execução por design.
