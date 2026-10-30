# 09 — Operação da Workforce (Fase 1)

## 1. Configuração

Nada a configurar para começar: a Workforce é parte do container principal (mesma API, mesmo
SQLite). Após a migração v20 (automática no boot, com backup verificado):

1. Painel → **Workforce** → "Modelos prontos" → criar um especialista a partir de um template
   (ou criar do zero no formulário).
2. O especialista nasce **habilitado** quando criado (com escopos do template); definições
   criadas via API sem `enabled: true` nascem desabilitadas.
3. Executar: campo de objetivo → "Executar". A execução é assíncrona; acompanhe em "Execuções".

Escopos novos (`workforce:read/write/run`) são de sessão administrativa; tokens de serviço só os
recebem se explicitamente criados com eles; **bots não podem recebê-los** (fora de
`BOT_SCOPES`, `server/auth.js`).

## 2. Estados de um run e o que fazer

| Estado | Significado | Ação |
|---|---|---|
| `queued` | enfileirado, ainda não iniciou | aguardar |
| `running` | especialista em execução | aguardar ou Cancelar |
| `awaiting_approval` | há aprovação D9 pendente no painel de Aprovações | aprovar/negar lá |
| `completed` | terminou tecnicamente | conferir badge "Verificado" |
| "Verificado" | efeitos externos do run com evidência `verified` | pode confiar no resultado |
| `failed` | erro conhecido (código em `error_code`) | investigar/mudar instrução e reexecutar |
| `cancelled` | cancelado cooperativamente | — |
| `unknown` | execução interrompida (ex.: queda do processo) | **Reconciliar** |

### Reconciliação de `unknown`

A reconciliação decide **apenas por evidência autoritativa** (aprovações D9 correlacionadas +
`execution_evidence`):

- Aprovação ainda pendente → volta para `awaiting_approval` (decida no painel).
- Efeitos com evidência `verified` → `completed`.
- Efeitos negados/não executados → `failed` (códigos `effects_denied` / `not_executed`).
- Resultado parcial ou indeterminável → permanece `unknown` (nunca inventa sucesso).

`decision: "deny"` do operador força `failed` com segurança; `decision: "confirm"` **sem
evidência é recusado** (409 `workforce_reconcile_no_evidence`).

## 3. Troubleshooting

| Sintoma | Causa provável | O que fazer |
|---|---|---|
| Run não aparece para o outro admin | isolamento por design (ownership) | cada admin só vê o que criou/recebeu por transferência |
| "Delegação recusada: orçamento esgotado" | soma de sub-orçamentos atingiu o teto do pai | aumentar `resource_budget.max_tool_calls` do orchestrator ou reduzir delegações |
| "profundidade máxima" | `max_depth` do pai esgotado | aumentar `max_depth` no orchestrator (teto absoluto 5) |
| Run `failed` com `workforce_executor_error` | provedor LLM indisponível/falhou | verificar provedores em Diagnósticos; reexecutar |
| Especialista não chama ferramenta X | ferramenta fora de `permitted_tools` ou escopo fora do efetivo | editar definition; lembrar que escopo pedido ∩ concedido (pai) |
| Migração v20 falha no boot | ver `docs/RECUPERACAO.md` (backup verificado é pré-requisito) | restaurar backup e reabrir; a migração é atômica |
| `workforce_definition_active_runs` ao excluir | há runs ativos da definition | cancelar/aguardar conclusão e excluir depois |

## 4. Limitações conhecidas (Fase 1)

1. **Tokens estimados** (fórmula da telemetria) — `max_tokens` contabilizado, não enforced
   preventivamente; nenhum custo monetário é calculado (sem dado confiável = desconhecido).
2. **Retry automático não implementado** — `max_retries` é reservado no contrato; retentativa é
   manual (novo run; a idempotência deduplica re-submissões).
3. **Retomada pós-aprovação** — um run `awaiting_approval` cuja aprovação é resolvida não retoma
   o loop sozinho; a retomada estruturada chega com o motor de workflows (Fase 3).
4. **`instruction_checksum` reservado** — instruções inline não têm verificação criptográfica em
   runtime (checksum de skills em runtime segue em aberto, TH-03 do modelo de ameaças).
5. **Smoke E2E multi-especialista completo** (orchestrator delegando a 2 especialistas via
   modelo real) não está na suíte automatizada — os testes exercitam delegação direta com
   runners fake; cenário com modelo real é verificação manual.
