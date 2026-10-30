# Histórico

Documentos de valor histórico apenas: relatórios de entrega, especificações superadas e
fotografias de estado de releases anteriores. **Nada aqui descreve o estado atual do sistema.**

A fonte da verdade do estado em operação é: `README.md`, `CHANGELOG.md`, `docs/ARQUITETURA.md`,
`docs/RUNBOOK-RELEASE-2026-10-18.md` e `roadmap.md`. Documentos vivos que apontavam para arquivos
desta pasta foram atualizados para apontar ao documento atual correspondente. Links relativos
**dentro** dos documentos arquivados podem apontar para locais antigos (ex.: `../HOMOLOGACAO_STATUS.md`)
— isso é intencional: os arquivados são fotografias pontuais e seu conteúdo não é reescrito.

| Documento | O que era | Por que foi arquivado |
| --- | --- | --- |
| `ENTREGA-*.md`, `RELATORIO-P02-2026-10-18.md` | Relatórios de entrega (P0/G5–G10, 1.7.5) | Evidência pontual de missão concluída; estado atual no CHANGELOG e RUNBOOK |
| `CONTINUIDADE.md` | Estado de fases 2–4 (2026-10-15) | Registro histórico; fases concluídas |
| `FASE-4-EMAIL.md` | Especificação IMAP/SMTP de 2026-10-15 | Superada pela integração server-side AgentMail (1.8.0) |
| `POLITICA-RETENCAO-2026-10-18.md` | Proposta de política de retenção | Implementada na 1.9.0 (migração v17, opt-in); operação em `docs/OPERACAO-FILA-STT-OAUTH-RETENCAO.md` |
| `BACKUP-E-RESTAURACAO.md` | Backup/RPO/RTO (1.8.2, schema 15) | Substituído por `docs/RECUPERACAO.md` (schema 19) e `deploy/BACKUP-RESTORE.md` |
| `HOMOLOGACAO_STATUS-1.9.3.md` | Auditoria de homologação da 1.9.3 | Fotografia da 1.9.3; estado atual no RUNBOOK e CHANGELOG |
| `superpowers/` | Especificação e plano de segurança do navegador (2026-10-28) | Executados e entregues na 1.9.3 (migração v19) |
