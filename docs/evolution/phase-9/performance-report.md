# Relatório de Performance — Fase 9

## Escopo honesto

A F9 **não estabelece metas numéricas de performance** (nenhuma foi definida como
requisito no roadmap) e **não mede** latências em carga — o ambiente de consolidação
(single-admin, dados de teste) não representa o ambiente de destino. Este relatório
declara o que foi feito e o que permanece limitado.

## Otimização real: índices v28

Os ticks periódicos de 15–60 s das fases 5–8 consultavam tabelas por colunas sem
índice, executando **full scan** a cada tick — degradando com o crescimento dos
dados. A migração v28 (aditiva) adicionou 12 índices:

| Consulta periódica | Índice |
|---|---|
| Eventos de webhook por status (`if_events`) | `(status, id)` |
| Ações CI pendentes | `(status, approval_id)` parcial |
| Regras temporais (next_run_at) | `pr_rules(state, trigger_kind, next_run_at)` |
| Regras por evento/owner | `pr_rules(owner_admin_id, state, trigger_kind)` |
| Runs de workflow por status | `wf_runs(status)` |
| Sessões multimodais ativas | `mm_sessions(status, updated_at)` |
| Turnos por estado | `mm_turns(state, updated_at)` |
| Sessões CI por owner | `ci_sessions(owner_admin_id, created_at)` |
| Dedupe de oportunidades | `pr_opportunities(dedupe_key)` parcial |
| Oportunidades por regra | `pr_opportunities(rule_id, status)` |
| Conflitos de calendário | `cal_conflicts(account_id, resolved_at)` |
| Notificações não lidas | `pr_notifications(owner_admin_id, read_at)` |

Efeito: os ticks deixam de fazer full scan e passam a usar busca indexada — o custo
por tick passa a ser proporcional ao conjunto de trabalho, não ao tamanho da tabela.

## Medição pontual executada (Fase 9, ambiente de consolidação)

Medições REAIS em banco efêmero local (single-admin, sem carga concorrente — não
representam o ambiente de destino; servem apenas de linha de base):

| Operação | Medido |
|---|---|
| Conversa: inserção (média de 50) | 0,018 ms |
| Conversa: listagem 50 (média de 50) | 0,060 ms |
| FTS5: busca lexical com 200 documentos indexados (média de 20, 10 hits) | 0,463 ms |
| Tick `if_events` por status (300 eventos; nenhum pendente) | 0,019 ms |
| `tickProactive` completo (DB pequeno; média de 10) | 0,088 ms |
| Workflow trivial start→end, sequencial (média de 20 runs reais) | 0,628 ms/run |
| Memória do processo Node após a suíte | heap 15 MB / RSS 100 MB |

Método: `process.hrtime.bigint()` em processo `node` direto (JARVIS_NO_LISTEN), migração
v28 aplicada; script efêmero (não versionado). Nenhum valor projetado para carga.

## Limites existentes (herdados, mantidos)

- Orçamento de execução do workforce (F1) limita trabalho delegado.
- Rate limit e replay window no webhook ingress (F8).
- Limites de runs/provimento nas rotas (`run-limits.test.mjs`).

## Dívidas de performance documentadas (não corrigidas)

| Item | Avaliação | Disposição |
|---|---|---|
| N+1 pontuais | ocorrem em datasets pequenos, perfil single-admin | ACEITO — sem impacto mensurável no perfil alvo; reavaliar se o perfil mudar |
| `khSearch` filtra escopo no JS pós-FTS | custo proporcional ao resultado da busca FTS | ACEITO (single-admin local); ver [threat-model.md](threat-model.md) R1 |
| `index.js` 2.772 linhas | custo de parse/manutenção, não de runtime | ACEITO na consolidação |

## Medição futura

Benchmarks de latência/throughput só fazem sentido no ambiente de destino com dados
reais. Critérios de medição propostos em [production-readiness.md](production-readiness.md).
