# Registro de Integrações e Contratos de Adaptadores (Fase 8, §6)

## Contratos

| Contrato | Onde vive |
|---|---|
| IntegrationDefinition | registro em CÓDIGO (`ADAPTERS` em integrations.js; providers em calendar.js) — nunca do cliente |
| IntegrationInstance | `if_integrations` (por admin; ownership `if_integration`) |
| IntegrationCapability | `capabilities_json` (declarado pelo adapter em código) |
| IntegrationCredentialReference | segredo do produtor: `if_producers.secret_encrypted` (AES-256-GCM); OAuth: `oauth_connections` existente |
| IntegrationHealth | `health_json` (último contato, último erro SEM segredos) |
| IntegrationEvent | `if_events` (contrato canônico — event-normalization.md) |
| IntegrationDelivery | entrega do evento ao Proactive Engine (`status`: received→forwarded/error) |
| IntegrationAuditRecord | eventos `if.*` no audit central |

## Estados (CHECK no banco)

`unconfigured → configured → active ⇄ degraded → disabled / error` — desativação
individual (`deactivateIntegration` desliga produtores + contas de calendário juntos) e
desativação global via pausa do Proactive Engine (nível/controles da Fase 7).

## O que cada integração declara

identificador · nome · versão · tipo (`webhook`/`calendar`/`custom`) · capacidades ·
configuração validada no backend (`validateConfig` — strings/números/booleanos limitados) ·
proprietário (`owner_admin_id` + ownership) · estado de saúde · último contato ·
último erro (sem dados sensíveis) · política de execução (delegada ao Policy Engine).

## Regras duras

- **Nenhuma integração registra permissões/escopos automaticamente** — não há vínculo
  entre integração e scopes; ferramentas seguem `TOOL_SCOPES` e o Workflow Engine.
- Adaptadores independentes: um adaptador não importa outro; falha de um não derruba
  outros (health checks isolados, try/catch por integração).
- Timeout e cancelamento em toda operação de rede (10–20 s, `AbortSignal`).
