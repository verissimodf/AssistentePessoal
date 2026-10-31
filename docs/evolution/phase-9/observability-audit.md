# Auditoria de Observabilidade — Fase 9

## Princípio

Toda ação significativa produz **um evento de auditoria central**, com cadeia de
correlação que atravessa os módulos. A observabilidade da plataforma é a própria
trilha de auditoria — não há sistema de telemetria externo (por design, tudo fica
local).

## Cadeia de correlação

O fluxo autorizado típico deixa rastro completo:

```
request (HTTP, rota, principal)
  → agent_run (delegação, orçamento)
    → workflow_run (fluxo, passo atual)
      → approval (D9, fingerprint, resolveApproval)
        → tool_call (scope re-checado em callTool)
          → event (resultado, evidências)
```

| Elos | Onde registrar | Cobertura de teste |
|---|---|---|
| request → rota/escopo | audit central (choke point) | `http-auth.test.mjs`, `audit-trail.test.mjs` |
| agent_run → ferramenta | `agent-audit.test.mjs`, `execution-evidence.test.mjs` | PASS |
| workflow → aprovação | `approvals-actions.test.mjs`, `approval-correlation.test.mjs` | PASS |
| recuperação de boot | `approval-correlation-boot.test.mjs`, `audit-interrupted.test.mjs` | PASS |
| resultados/outcomes | `audit-outcomes.test.mjs`, `audit-probe.test.mjs` | PASS |

## Higiene da trilha

- **Sem segredos**: a demo-final-acceptance assexa que a auditoria não contém
  segredos (chaves, tokens, segredos de produtor).
- **Sem áudio/conteúdo sensível**: turnos multimodais registram eventos de estado,
  nunca o áudio (que nem é persistido).
- **Conteúdo externo como dado**: entradas de webhook/KH/research aparecem como
  evidência referenciada, não como instrução.

## Diagnóstico operacional

- Falhas de subsistemas externos (STT/TTS/searxng/provider) produzem códigos estáveis
  (ex.: `cal_oauth_not_connected`) auditáveis — o operador distingue "dependência
  ausente" de "bug".
- A correção da F9 (`SttError`) garante que erros de domínio cheguem ao operador com
  a semântica certa (antes eram mascarados como erro de mail).
- Runbook de uso da trilha para diagnóstico: [runbook.md](runbook.md).

## Limitações

- Não há exportação externa (metrics/traces para Prometheus/OTel etc.) — fora do
  escopo do roadmap e contrário ao requisito "tudo local". Se o ambiente de destino
  exigir monitoramento externo, é item de [production-readiness.md](production-readiness.md).
- Retenção/purga da trilha segue as políticas da base (D-REC: `d-rec*.test.mjs`).
