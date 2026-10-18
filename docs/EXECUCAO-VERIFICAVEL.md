# Execução verificável (P0) — contrato, evidências e limites

> Escopo: Etapa 1/P0 do roadmap técnico do J.A.R.V.I.S. Documenta o **retorno estruturado dos
> executores**, o **ledger de evidência por execução** e a **correlação** com a trilha de auditoria
> e as aprovações. Não altera autorização, autonomia nem política de host.

## 1. Contrato de execução

Cada execução percorre estados distintos e **não intercambiáveis**:

| Conceito | Onde vive | Observação |
|---|---|---|
| Ação **solicitada** | `approval_actions.action` (JSON congelado) + evento `(requested)` | fingerprint fixa a operação |
| Ação **autorizada** | evento `(approved)` / `(denied)` | reavaliação do portão na aprovação |
| Ação **iniciada** | evento `(started)` | após o claim único `pending→running` |
| **Resultado retornado** | retorno do executor | agora **estruturado** (ver §2) |
| **Resultado verificado** | `execution_evidence` + eventos `(done|error|unknown)` | pós-condição, ver §4 |
| **Conclusão** | `approvals.status` + `execution_evidence.state` | `done` só com evidência compatível |

Estados terminais: **concluído** (`completed`), **concluído com erro** (`failed`), **negado**
(`denied`), **interrompido/cancelado** (`timeout`/`overflow`/`cancelled`), **desconhecido**
(`unknown`). `done` exige evidência compatível; verificação inconclusiva preserva `unknown`.

## 2. Retorno estruturado dos executores

`runShell` (`server/tools.js`) devolve um objeto — **não** uma string:

```js
{ output, exitCode, timedOut, cancelled, overflow, startedAt, finishedAt, state }
```

`state` ∈ `completed` (exit 0) · `failed` (exit ≠ 0) · `error` (spawn falhou) · `timeout` ·
`overflow` (saída acima do teto → processo morto). `output` mantém o texto anterior (com os
marcadores `[erro] …`) para compatibilidade com o modelo e com o contrato textual.

`resultText(r)` normaliza resultado estruturado **ou** string (usado pelo modelo, pelo banco e
pelos testes). Consumidores atualizados: `callTool` (rota direta) e `resolveApproval`.
`classifyOutcome(kind, r)` **prefere** a evidência estruturada e cai no contrato textual para
resultados legados (string).

## 3. Semântica dos estados

| `state` | Significado técnico | Vira |
|---|---|---|
| `completed` | processo terminou com código 0 | `(done)` |
| `failed` | processo terminou com código ≠ 0 | `(error)` |
| `error` | não foi possível iniciar o processo | `(error)` |
| `timeout` | teto de tempo estourado (grupo morto) | `(unknown)` |
| `overflow` | saída acima do teto → processo morto | `(unknown)` |
| `denied` | cancelado antes de executar (destino/config mudou) | `(denied)` |
| `cancelled` | cancelamento cooperativo (reservado) | — |
| `unknown` | exceção de rede/tempo limite | `(unknown)` |

**Regra central:** `exitCode === 0` é evidência **técnica** do processo, **não** prova de que o
objetivo de negócio foi alcançado (ver §4).

## 4. Verificação de pós-condição (limites)

O ledger registra dois eixos separados:

- `state` — o que aconteceu **tecnicamente**.
- `verification` ∈ `verified` | `unverified` | `failed` | `unknown` — a **pós-condição do objetivo**.
- `verifiedBy` — **qual** verificador rodou (nunca um selo sem nomear a verificação).

Semântica (contrato fechado; `EVIDENCE_VERIFICATIONS` em `server/db.js`):

| `verification` | Significado | Quando ocorre |
|---|---|---|
| `verified` | a pós-condição foi observada por um verificador **específico** da operação | id emitido só pelo provedor (`provider_message_id` no Telegram, `messages[0].id` no WhatsApp), `provider_conversation_id` do OpenHands, `artifact_integrity` da REA (releitura do artefacto gravado: bytes + sha256 + JSON válido) |
| `unverified` | a operação concluiu sem pós-condição observável | exit 0 de shell (`exit_code`), HTTP 2xx sem identificador de provedor (`http_status`), contrato textual (`contract_text`) |
| `failed` | a operação falhou de forma observada | exit ≠ 0, erro do provedor (HTTP ≠ 2xx), exceção de execução |
| `unknown` | não é possível afirmar nada | `timeout`, `overflow`, e operação **negada/cancelada** (`not_executed`, não houve execução) |

Regras: (1) um HTTP 2xx isolado **nunca** vira `verified` — só o identificador que o provedor
emite; (2) exit 0 é evidência técnica, não prova de resultado de negócio → `unverified`; (3)
`verified` exige o verificador nomeado em `verifiedBy`, vindo da observação do executor — nunca de
auto-relato do agente nem de um código HTTP genérico.

## 5. Ledger de evidência e correlação

Tabela `execution_evidence` (migração **v10**), **não** em `PRESERVED`, ligada à trilha de
auditoria por `audit_id`:

```
id (executionId) · approval_id · kind · state · exit_code ·
verification · verified_by · input_hash · correlation · audit_id · at
```

- `input_hash` = SHA-256 canônico da **identidade** da operação (`{kind, command}` ou
  `{kind, target, channel, path, fingerprint}`) — **não** do conteúdo livre (mensagem/tarefa).
  Serve para correlação/deduplicação; **não** prova execução correta.
- `correlation` = UUID v4 da trilha (v9), republicado em todos os eventos.
- `audit_id` = referência ao evento de auditoria correspondente; o evento também carrega
  `executionId`, `verification`, `verifiedBy`, `exitCode` (allowlist em `server/db.js`).

**Privacidade:** só metadados. Nunca prompts, mensagens, caminhos sensíveis, tokens ou segredos
(coberto por `tests/execution-evidence.test.mjs`).

## 6. Migração, backup e recuperação

- v10 cria apenas a tabela + índices (`idx_execution_evidence_approval`, `..._correlation`).
  `approval_actions` e `audit` não são tocados; v9 permanece intacta.
- O framework de migração faz **backup verificado** (`VACUUM INTO` + `integrity_check` + snapshot
  SHA-256 das tabelas preservadas) antes de aplicar, e roda em uma transação única.
- **Rollback:** restaurar o backup `jarvis-<data>-v9.db` e voltar o código. Ver `docs/RECUPERACAO.md`.
- Validado em banco temporário (`tests/execution-evidence.test.mjs`): `user_version=11`
  (v10 do ledger + v11 `session_focus`), integridade `ok`, índices e v9 presentes.

## 7. Endpoints e autorização

`GET /api/approvals/:id/evidence` — rota **`session`**, com o **mesmo portão de posse** da
aprovação: dono vê; estrangeiro/legado/desconhecido → **404** uniforme; sem sessão → **401**.
Retorna `{ approvalId, evidence: [...] }` (só metadados). Não há endpoint público novo.

## 8. Integração com o painel

O painel (`src/lib/bridge.ts` → HTTP) pode consultar `/api/approvals/:id/evidence`. Estados
distintos: concluído, falha, negado, interrompido, desconhecido e verificado/não verificado.
Nenhum selo de "verificado" sem indicar **qual** verificação rodou (`verifiedBy`). Dados de
demonstração (fallback localStorage) nunca são apresentados como resultado real do backend.

## 9. Testes e comandos

```bash
node --test tests/execution-evidence.test.mjs     # contrato + evidência + API + migração + privacidade
node --test tests/*.test.mjs                      # suíte completa do serviço
npx vitest run                                    # painel
npm run build                                     # build do painel
```

Cobertura nova: exit 0/≠0, timeout, overflow, saída vazia/excessiva, sucesso técnico sem
pós-condição, desconhecido sem reexecução, correlação ponta a ponta, persistência, migração v10,
ausência de segredos, isolamento entre administradores, regressão de escopos/aprovações e
compatibilidade dos consumidores. Verificadores por operação
(`tests/verifiers.test.mjs`): conjuntos fechados de `state`/`verification`, extração do id de
provedor (Telegram/WhatsApp/OpenHands), 2xx sem id → `unverified`, HTTP ≠ 2xx → `failed`,
releitura de artefacto da REA e ausência de segredos no texto de saída.

## 10. Limitações conhecidas

- `verification` nunca é `verified` por auto-relato: sem verificador específico (ex.: comando de
  shell arbitrário), o resultado é `unverified`/`unknown` conforme a tabela da §4.
- O estado `error` (spawn) é defensivo; com `shell: true`, "comando inexistente" resulta em
  `failed` (exit ≠ 0 do shell).
- A evidência cobre execuções **aprovadas**; execuções diretas (autonomia `full`) retornam texto e
  não geram linha no ledger (a trilha de auditoria continua registrando o evento).
- Não há expurgo/retenção de evidência (política pendente).
- As garantias acima valem para o código do serviço; não protegem contra acesso direto ao arquivo
  do banco.

## 11. Rollback

1. Parar o serviço.
2. Restaurar o backup verificado `jarvis-<data>-v9.db` (ver `docs/RECUPERACAO.md`) e voltar o
   código para a versão anterior à v10.
3. Subir e validar `/api/health` e a suíte.

## 12. Métricas futuras (a medir, não estimadas)

- **Falsos sucessos:** execuções `done` cuja pós-condição falha numa verificação posterior.
- **Taxa de estados desconhecidos:** `unknown` / total de execuções com efeito externo.
- **Taxa de verificação:** execuções com `verification = "verified"` / total.
- **Latência e custo por tarefa** (instrumentar `runAgent`).
