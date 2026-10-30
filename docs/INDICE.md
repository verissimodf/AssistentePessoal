# Índice documental

Atualizado em 2026-10-30 (release implantada **1.10.0**; schema de origem **19**). Relatórios de
entrega, especificações superadas e fotografias de releases anteriores estão em
[`historico/`](historico/README.md).

## Comece por aqui

| Documento                         | Para quê                                             |
| --------------------------------- | ---------------------------------------------------- |
| [`README.md`](../README.md)       | visão geral, arquitetura, instalação, testes e links |
| [`CHANGELOG.md`](../CHANGELOG.md) | mudanças por release e hardening                     |
| [`roadmap.md`](../roadmap.md)     | pendências operacionais e decisões de evolução       |

## Arquitetura e configuração

| Documento                                                                    | Para quê                                                            |
| ---------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| [`ARQUITETURA.md`](ARQUITETURA.md)                                           | topologia, componentes, fluxos (incl. streaming), confiança e dados (schema 19) |
| [`CONFIGURACAO.md`](CONFIGURACAO.md)                                         | variáveis, provedores, integrações, canais e voz (inclui AgentMail) |
| [`OPERACAO-FILA-STT-OAUTH-RETENCAO.md`](OPERACAO-FILA-STT-OAUTH-RETENCAO.md) | operação da fila, retenção, OAuth e STT local                       |
| [`PAINEL.md`](PAINEL.md)                                                     | áreas administrativas do painel (ledger de execução)                |
| [`NAVEGADOR.md`](NAVEGADOR.md)                                               | ferramenta de navegador, worker isolado e política de rede          |

## Operação e segurança

| Documento                                                      | Para quê                                            |
| -------------------------------------------------------------- | --------------------------------------------------- |
| [`SECURITY.md`](../SECURITY.md)                                | política de segurança e reporte de vulnerabilidades |
| [`OPERACAO-SLO-E-INCIDENTES.md`](OPERACAO-SLO-E-INCIDENTES.md) | SLOs propostos, alertas e runbook de incidentes     |
| [`RECUPERACAO.md`](RECUPERACAO.md)                             | backup, migrações, rollback e restore (schema 19)   |
| [`deploy/BACKUP-RESTORE.md`](../deploy/BACKUP-RESTORE.md)      | runbook operacional de backup/restore               |
| [`RUNBOOK-RELEASE-2026-10-18.md`](RUNBOOK-RELEASE-2026-10-18.md) | release, build, verificação e rollback            |
| [`D_REC.md`](D_REC.md)                                         | recuperação de acesso, titularidade e expurgo       |

## Integrações

| Documento                                             | Para quê                                                       |
| ----------------------------------------------------- | -------------------------------------------------------------- |
| [`INTEGRACOES-LAYTECH.md`](../INTEGRACOES-LAYTECH.md) | estado operacional conhecido de provedores, AgentMail e canais |

## Homologação e relatórios

| Documento                                                                                           | Para quê                              |
| --------------------------------------------------------------------------------------------------- | ------------------------------------- |
| [`reports/JARVIS-AGENT-SKILLS-INTEGRATION-01.md`](../reports/JARVIS-AGENT-SKILLS-INTEGRATION-01.md) | integração inicial (histórico)        |
| [`reports/JARVIS-AGENT-SKILLS-INTEGRATION-02.md`](../reports/JARVIS-AGENT-SKILLS-INTEGRATION-02.md) | homologação definitiva 1.7.8          |
| [`reports/JARVIS-RELEASE-CLOSURE-178.md`](../reports/JARVIS-RELEASE-CLOSURE-178.md)                 | auditoria de encerramento 1.7.8       |
| [`reports/VULNERABILIDADES-2026-10-26.md`](../reports/VULNERABILIDADES-2026-10-26.md)               | Dependabot e correção de dependências |

## Desenvolvimento e testes

| Documento                                                                                                  | Para quê                                                    |
| ---------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------- |
| [`VALIDACAO.md`](VALIDACAO.md)                                                                             | validação e evidências por release                          |
| [`ADR-001-primeiro-acesso-e-identidade-de-sistema.md`](ADR-001-primeiro-acesso-e-identidade-de-sistema.md) | decisão registrada sobre setup e identidade                 |
| [`SOLUCAO-DE-PROBLEMAS.md`](SOLUCAO-DE-PROBLEMAS.md)                                                       | problemas comuns                                            |
| [`AJUSTES.md`](AJUSTES.md)                                                                                 | ajustes finos (palmas, embeddings)                          |
| [`EXECUCAO-VERIFICAVEL.md`](EXECUCAO-VERIFICAVEL.md)                                                       | contrato de execução verificável e evidências               |
| [`CONTRIBUTING.md`](../CONTRIBUTING.md)                                                                    | fluxo de contribuição e política por risco                  |
| [`AGENTS.md`](../AGENTS.md)                                                                                | regras do repositório para agentes                          |

## Evolução (programa multi-fase)

| Documento | Para quê |
|---|---|
| [`evolution/phase-0/README.md`](evolution/phase-0/README.md) | Fase 0 — arquitetura e segurança da evolução: inventário, alvo, contratos, ameaças, ADRs, backlog |
| [`evolution/phase-1/README.md`](evolution/phase-1/README.md) | Fase 1 — Agent Workforce: definições, runs, orçamento hierárquico, delegação e reconciliação |

## Histórico

| Documento                                   | Para quê                                                              |
| ------------------------------------------- | --------------------------------------------------------------------- |
| [`historico/README.md`](historico/README.md) | índice dos documentos arquivados e por que foram arquivados          |
