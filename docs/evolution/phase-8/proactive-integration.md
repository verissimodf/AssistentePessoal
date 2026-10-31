# Integração com o Proactive Engine e Workflow Engine (Fase 8, §11–12)

## Fluxo canônico

```
Integration → evento normalizado (if_events) → Proactive Rule → Condition Engine
  → Opportunity → Workflow Engine → Policy Engine → D9 (se protegido) → resultado
```

- O fabric NUNCA inicia workflow diretamente: registra o evento (fontes
  `integrations`/`calendar`) e o Proactive Engine decide (regra → condições →
  oportunidade/automação nos níveis ≥ 2 com `execution: auto`).
- Cenários de calendário suportados via eventos: sincronização concluída (com contagens
  e conflitos no payload); regras podem recomendar ações (revisar conflito, preparar
  reunião). **Nenhuma regra implícita**: só regras criadas pelo operador disparam.
- **Um compromisso não autoriza ação relacionada** — D9 intocado; aprovação humana
  permanece necessária para operações protegidas (testado: 32-33).

## Requisitos do §12 → implementação

| Requisito | Onde |
|---|---|
| ownership | `if_integration`/`cal_account` em `ownership` + filtros por dono |
| correlation ID | `correlation_id` no evento + trilha da Fase 7 (event→rule→opp→run) |
| idempotência | UNIQUE no banco (evento) + idempotencyKey (run) |
| limites de execução | limites da Fase 7 (taxa/cooldown/pendentes) — herdados |
| auditoria | `if.*` + `pr.*` |
| timeout | 10–20 s com AbortSignal nos providers |
| indisponibilidade | códigos estáveis (`cal_oauth_not_connected`, `cal_provider_unavailable`) — nunca simulação |
| evidências de execução | `getExecutionTrail` + trilha no Integration Studio |

## Proibições preservadas

- Um adaptador NÃO executa ferramentas protegidas diretamente (não há caminho);
- uma integração NÃO altera escopos de agentes (sem vínculo integração→scopes);
- eventos externos não são aprovação humana;
- nenhum evento altera configurações de segurança (payload é dado; settings têm
  validação própria no backend).
