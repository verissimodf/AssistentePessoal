# Roadmap
- [x] Fase 0 — diagnóstico e baseline
- [x] Fase 1 — autenticação/autorização (aguardando revisão do usuário; não mesclar sem autorização)
- [ ] Fase 2 — gestão documental (bloqueada: aguarda aprovação explícita da Fase 1)

## Decisões registradas (remediação 2026-10-23)

- **Agentes e bots — CRUD não implementado por decisão de escopo (P3).** A API expõe leitura/execução
  (`GET /api/bots/:id/runs`, `POST /api/bots/:id/run`, `POST /api/runs/:id/cancel`, `GET /api/executions`)
  e os agentes/bots são provisionados por semente de template + associação de propriedade. Criar rotas
  de criação/edição/exclusão de agentes e bots exige decisão de produto (semântica de identidade,
  agendamento e aprovação) e **não** foi adicionada nesta fase para não expor uma API incompleta.
  Itens marcados como `MISSING` no relatório de remediação, com remediação dependente de aprovação.
- **Rascunhos de e-mail são transientes por design (D9).** O corpo vive apenas em memória (TTL curto),
  nunca é persistido nem auditado. A criação/edição humana (P1-A) usa a MESMA store e o envio continua
  exigindo confirmação explícita (`ENVIAR`).
- **Skills Hub.** O provisionamento padrão é o catálogo determinístico embutido, offline e idempotente
  (`JARVIS_SKILLS_SETUP=builtin`). O modo de rede (`full`), que clona repositórios externos não fixados
  por commit, permanece **opt-in explícito** e não é o padrão seguro.

