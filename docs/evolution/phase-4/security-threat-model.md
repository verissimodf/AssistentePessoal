# Security & Threat Model — Deep Research & Learning (Fase 4)

Sobre os modelos anteriores (Fases 0–3). Ameaças novas desta fase com controles implementados
(referências ao código) e risco residual.

| # | Ameaça | Controles implementados | Residual |
|---|--------|-------------------------|----------|
| P4-1 | **Prompt injection em página web recuperada** | Conteúdo recuperado é texto plano (sem scripts, `htmlToText`), marcado DADO NÃO CONFIÁVEL nos prompts; nada executado; efeitos externos sob D9 | Baixo-médio (residual herdado) |
| P4-2 | **Injeção em fonte do Hub** | Mesmo tratamento (Fase 2 KH-1); evidências só entram com citação verbatim validada | Baixo-médio |
| P4-3 | **Citação alucinada / falsa atribuição** | `nodeResearchEvidence` valida VERBATIM: citação que não existe no conteúdo da fonte é REJEITADA e auditada; citações do relatório vêm dos registros de fonte (nunca do modelo) | Baixo — testado |
| P4-4 | **SSRF / DNS rebinding na recuperação** | `assertSafeUrl` + `assertPublicHost` + `safeFetch` (IP fixado pós-DNS) — mesmos controles das Fases 2-3; esquemas não-HTTP e alvos privados bloqueados | Baixo |
| P4-5 | **Cross-owner em pesquisas/projetos** | `owns()` em toda leitura/escrita (`getResearch`, `getLearningProject`, journal, progresso); 404 uniforme | Baixo — testado |
| P4-6 | **Bypass do Policy Engine / D9** | Nós tool passam por `toolPolicyVerdict` + `callTool` (política + can() + D9); nós agent pela Workforce (interseção + orçamento); nenhuma via nova | Baixo |
| P4-7 | **Dados privados enviados a provedores** | Busca web envia apenas a CONSULTA (pergunta/subpergunta); conteúdo do Hub NUNCA sai da máquina (só vai ao modelo local via router existente); relatórios citam fontes locais sem enviar conteúdo | Baixo |
| P4-8 | **Vazamento em logs/audit** | Audit `research.*`/`learn.*` só metadados (ids, contagens, status) — testado contra conteúdo de página e citações | Baixo |
| P4-9 | **Execução fora do orçamento** | Limites do workflow (nós/agent_runs/profundidade/timeout) + subquestions ≤ 5 + fontes/questão ≤ 5 + retrievals ≤ 12/projeto | Baixo — testado |
| P4-10 | **Inferência pessoal sensível** | Progresso de aprendizagem é CONTAGEM explícita (attempts/correct/incorrect/undetermined) — sem rótulos de "domínio" ou traços de personalidade | Baixo |
| P4-11 | **Replay de investigação** | Idempotência no workflow (v22) + dedupe de fontes por hash; retomada pula nós concluídos | Baixo — testado |

## Invariantes específicas (Fase 4)

1. Toda evidência tem citação VERBATIM validada contra o conteúdo da fonte — sem exceção.
2. Provedor indisponível → `partial`/`inconclusive` EXPLÍCITO; nunca resultados fictícios.
3. Plano de pesquisa é hipótese (`kind: 'hypothesis'`), não fato.
4. Origem de cada evidência é registrada e nunca misturada (web ≠ hub ≠ memória).
5. Progresso de aprendizagem é contagem; nada vira memória automática.
6. O tutor distingue (a) conteúdo de fonte, (b) didática, (c) ausência na fonte.

## Riscos aceitos

- O modelo pode SINTETIZAR mal mesmo com citações corretas — a revisão humana do relatório é
  o controle final; a rastreabilidade (evidência → fonte → trecho) permite auditoria.
- Busca via provedor sem credenciais (DDG HTML) pode degradar sem aviso — o motor degrada
  para `partial` com motivo auditado (`research.web_unavailable`).
