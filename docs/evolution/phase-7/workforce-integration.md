# Integração — Agent Workforce (Fase 7, §12.1)

- Delegação acontece DENTRO dos workflows (nós `agent` do Workflow Engine, Fase 1) —
  coordenador, orçamento e interseção de escopos intactos; o motor proativo não consulta
  nem concede escopos, tokens ou permissões.
- Eventos do Workforce (ex.: falha de especialista, conclusão de run delegado) entram
  como fonte `workforce` na whitelist; regras podem reagir (ex.: recomendar revisão).
- Controle de orçamento hierárquico permanece no Workforce/Workflow Engine — o nível de
  autonomia proativa não amplia orçamento de execução.
