# Roadmap de evolução

Atualizado após a release **1.8.2** (27/10/2026). O roadmap registra o que foi operacionalizado e
separa lacunas restantes de evoluções condicionais; nenhuma sugestão vira funcionalidade ativa sem
validar necessidade, segurança, operação e recuperação.

## Fechamento operacional da 1.8.2

- [x] Inbox AgentMail reivindicada explicitamente; zero eventos sem owner. Nenhum corpo de mensagem foi lido.
- [x] Commit `88a3ce55` publicado; imagem 1.8.2 reconstruída com SHA completo, schema 15 e metadados verificados.
- [x] Backend 636/636, frontend 109/109, avaliação offline 86/86, TypeScript, build e smoke do container aprovados.
- [x] Migração v14→v15 concluída com backup verificado, integridade SQLite e FKs sem erros.

## Pendências operacionais

- [ ] Decidir se os clientes diretos do MCP hospedado AgentMail em `.mcp.json`/`opencode.json` devem
  ser removidos/desabilitados. Eles são um caminho independente que não herda ownership, aprovação
  D9 ou auditoria do Jarvis; a integração server-side já oferece o caminho protegido.
- [ ] Reduzir dívida do lint em lotes pequenos; a execução da 1.8.2 encontrou 407 ocorrências
  Prettier e 8 violações `no-explicit-any` nos 14 arquivos analisados, além de 1 aviso. Evitar
  reformatar todo o código de uma vez junto de mudanças funcionais.

## Melhorias aprovadas e estado de operacionalização

### P1 — Qualidade do núcleo e operação

- [x] **Avaliação offline dos fluxos agênticos:** cenários versionados de chat, escolha de
  ferramentas, recusa/approval D9, injeção em documentos/e-mail e fallback entre provedores. Critério:
  execução sem rede/chaves e resultados determinísticos; `npm run eval:agents` produz relatório JSON
  por cenário e o CI executa os cenários.
- [ ] **Observabilidade local do router — parcial:** o endpoint protegido existente expõe contagens,
  latência, falhas, fallback e tokens estimados, mas os dados são voláteis e não há retenção configurável.
  Próximo passo: retenção local com limite/expurgo configurável e testes de ausência de conteúdo/PII.
- [x] **Hardening do scheduler — dedupe e concorrência:** limite de duas execuções por admin, uma por bot
  em voo e ledger SQLite para daily/interval/file; replay do mesmo gatilho é bloqueado após restart.
- [ ] **Retomada do scheduler — parcial:** execução interrompida vira `interrupted` sem replay automático,
  pois o efeito externo pode ter ocorrido. Implementar retomada segura exige idempotência por ferramenta
  e fluxo explícito de reconciliação; cancelamento cooperativo já existe.
- [ ] **Portão de release — parcial:** CI executa migração/testes e smoke descartável; o script verifica
  metadados OCI/build-info/API/painel. Ainda falta ensaio automatizado de rollback da aplicação com DB
  compatível, sem dados reais.
- [ ] **Ciclo de vida de memória — parcial:** corrigir, apagar e exportar JSON por admin foi entregue;
  auditoria guarda apenas metadados e atualização descarta embedding antigo. Retenção automática segue
  desativada até definir período e consentimento explícito do administrador.
- [ ] **Qualidade do RAG — parcial:** painel mostra trecho, documento, bloco, modo, relevância e motivo do
  fallback; estados de indexação existentes e corpus sintético cobrem fallback/injeção. Falta métrica
  offline comparável de precisão/recall.
- [ ] **Captura de conhecimento opt-in — parcial:** guardar memória manualmente já exige ação explícita;
  resumo de documento/conversa com prévia editável e confirmação antes de persistir ainda não existe.
- [ ] **Calendário e tarefas — parcial:** ICS somente leitura já é suportado; CRUD local de tarefas e OAuth
  Google/Microsoft não foram implementados. Sem requisitos de escrita/credenciais, manter ICS read-only.
- [x] **Política de conectores de e-mail:** manter IMAP/SMTP como opções avançadas e AgentMail server-side
  para a integração por webhook; envio continua sob D9. OAuth Gmail/Microsoft não será adicionado sem
  requisito de produto e validação de credenciais/escopos.
- [ ] **Fila local de tarefas longas:** o ledger do scheduler fornece dedupe, mas não é uma fila durável
  de jobs. Adotar fila SQLite somente se medições mostrarem que execução atual não atende; então adicionar
  cancelamento, retomada e idempotência de efeitos por ferramenta.
- [ ] **Voz conversacional local — parcial:** TTS local opcional já funciona; STT local e streaming ainda
  não foram validados com um motor/host disponível. Não habilitar captura ou persistência de áudio sem
  indicador e consentimento.

## Decisões atualizadas em 2026-10-27

- Sem retenção automática de memória por padrão; primeiro definir período por administrador, preview e confirmação antes de remover dados.
- Sem OAuth de terceiros nesta fase; ICS read-only e IMAP/SMTP/AgentMail existentes cobrem os fluxos disponíveis.
- Sem Redis ou novo serviço de jobs: falta evidência de que o scheduler atual exija infraestrutura externa.
- Sem STT local ativo: o container homologado não inclui motor de reconhecimento de fala local.


## Regras para priorização

1. Resolver pendências de ownership e os caminhos de integração que contornam os controles antes de
   adicionar novos canais com efeitos externos.
2. Preferir capacidades de bibliotecas/SQLite existentes; uma nova dependência ou serviço precisa de
   benefício medido, custo operacional e plano de recuperação.
3. Toda funcionalidade que cruza dados de admins precisa de teste de isolamento e caminho fail-closed.
4. Toda ação externa precisa de idempotência, evidência de resultado e confirmação proporcional ao
   impacto.
5. Manter provedores externos opcionais; dados e configuração do assistente permanecem na máquina do
   operador por padrão.

## Decisões históricas (2026-10-23)

- Agentes e bots não receberam CRUD genérico sem decisão de produto sobre identidade, agendamento e
  aprovação; as APIs implementadas e o estado atual estão em `docs/ARQUITETURA.md`.
- Rascunhos de e-mail permanecem transitórios por design; envio por agente usa aprovação humana D9.
- Skills usam catálogo embutido, offline e idempotente por padrão. O modo de rede `full` continua
  opt-in explícito.
