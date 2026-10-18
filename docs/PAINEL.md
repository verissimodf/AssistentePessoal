# Painel administrativo — novas áreas (P0.1)

> Complementa `docs/EXECUCAO-VERIFICAVEL.md`. Documenta as áreas administrativas adicionadas para
> tornar observável a execução verificável (ledger `execution_evidence`). Nenhuma permissão,
> autonomia ou escopo foi alterado; todas as listagens são **owner-scoped** e só expõem metadados.

## Fonte de verdade por recurso

| Recurso | Fonte de verdade | Endpoint | Autorização | Falha | Teste |
|---|---|---|---|---|---|
| Aprovações do admin | tabela `approvals` + `ownership` | `GET /api/approvals` | `session` + posse | sem sessão → 401; offline → `null` | `tests/execution-evidence.test.mjs` |
| Execuções/evidências | `execution_evidence` + `ownership` | `GET /api/executions` | `session` + posse | 401 / `null` | idem |
| Evidência por aprovação | `execution_evidence` | `GET /api/approvals/:id/evidence` | `session` + posse | 401/404 uniforme | idem |
| Auditoria | tabela `audit` | `GET /api/audit` | `audit:read` | `null` (sem permissão/offline) | `tests/audit-*.test.mjs` |
| Saúde/versão | processo + `PRAGMA user_version` | `GET /api/health`, `GET /api/diagnostics` | público / `session` | `null` | `tests/diagnostics.test.mjs` |

**Nunca** há dado de demonstração apresentado como real: quando o backend está indisponível, as
listagens retornam `null` e a interface mostra **"Indisponível (offline)"**; ausência de registros é
distinta (lista vazia → "Nenhum registro").

## Áreas da interface

- **Visão geral** (`/visao-geral`): saúde+versão+esquema (release), aprovações pendentes, execuções
  que exigem atenção (falha/interrupção/desconhecido ou verificação não confirmada), atividade
  recente (auditoria) e **última atualização**. O **commit implantado** aparece como
  *não registrado* — o servidor não expõe o commit por fonte confiável (não é inventado).
- **Execuções e evidências** (`/execucoes`): ledger por execução — data, operação, **estado
  técnico**, **código de saída**, **verificação da pós-condição** e **método**, correlação e
  `audit_id`. Estados distintos: concluído / falha / negado / interrompido / desconhecido;
  verificação: verificado / não verificado / indeterminado.

## Pós-condição (Fase 4)

`evidenceFor` (server/tools.js) aplica um verificador **determinístico por contrato**:

| Operação | Pós-condição | Verificador (`verifiedBy`) |
|---|---|---|
| `send_message` | provedor aceitou o envio (HTTP 200) | `http_status` → **verified** |
| `openhands_task` | conversa criada (HTTP 200) | `http_status` → **verified** |
| `rea_analyze` | Evidence gravada | `artifact` → **verified** |
| `run_command` | — (exit 0 é evidência **técnica**, não do objetivo) | `exit_code` → **unverified** |
| demais | sem verificador compatível | `contract_text` → **unknown** |

`verified` só é gravado quando o verificador do contrato confirma o **objetivo**; caso contrário,
mantém-se `unverified`/`unknown`. Nenhum sinal de modelo concede autorização.

## Limitações

- Não há verificação de objetivo para comandos de shell arbitrários (só evidência técnica).
- O commit implantado não é exposto pelo servidor (não há fonte confiável) → "não registrado".
- Sem retenção/expurgo do ledger de evidências.
- O "resumo da sessão" (objetivo/next action) não tem campo persistido no backend; a Visão geral
  mostra pendências e atividade reais em vez de inventar um objetivo.
