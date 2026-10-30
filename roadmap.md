# Roadmap de evolução

Atualizado após a release **1.10.0** (30/10/2026). O roadmap registra o que foi operacionalizado e
separa lacunas restantes de evoluções condicionais; nenhuma sugestão vira funcionalidade ativa sem
validar necessidade, segurança, operação e recuperação.

## Fechamento operacional do ciclo 1.8.0 → 1.10.0 (26/10 a 30/10/2026)

- [x] **1.8.0–1.8.2:** AgentMail server-side com webhook Svix verificado, ownership explícito de
  inboxes (v13/v14), avaliação offline de fluxos agênticos no CI e hardening do scheduler (v15).
- [x] **1.9.0–1.9.3:** fila SQLite durável e idempotente (v16), retenção de memória opt-in com
  quarentena (v17), OAuth Gmail/Graph por PKCE (v18), STT local whisper.cpp como profile isolado,
  TTS validado com XTTS e navegador Playwright em worker sem rede com broker egress pinado (v19).
- [x] **1.10.0:** streaming NDJSON do chat (`/api/chat/stream`), citações com snapshot pontual
  (`meta.citations`), JEV Reflex advisory opt-in e atualização assistida por tag
  (`npm run update:release`). Sem migração nova (schema 19).
- [x] Backend **688/688**, frontend **109/109**, avaliação offline, TypeScript, build e smoke do
  container aprovados. Deploy de produção verificado: imagem `assistente-pessoal:1.10.0`,
  commit `2a3085f`, health `ok`, schema 19.

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
- [ ] **Ciclo de vida de memória:** corrigir, apagar e exportar JSON por admin entregue; política
  opt-in de retenção com prévia, quarentena restaurável e purga em lotes entregue na 1.9.0 (v17).
  A retenção automática permanece desativada por padrão — exige consentimento explícito do
  administrador.
- [ ] **Qualidade do RAG — parcial:** painel mostra trecho, documento, bloco, modo, relevância e motivo do
  fallback; estados de indexação existentes e corpus sintético cobrem fallback/injeção. Falta métrica
  offline comparável de precisão/recall.
- [ ] **Captura de conhecimento opt-in — parcial:** guardar memória manualmente já exige ação explícita;
  resumo de documento/conversa com prévia editável e confirmação antes de persistir ainda não existe.
- [ ] **Calendário — parcial:** ICS somente leitura já é suportado; CRUD local de tarefas não foi
  implementado. OAuth de e-mail (Gmail/Microsoft Graph, PKCE, escopos de envio opcionais com
  confirmação manual) foi entregue na 1.9.0 (v18); OAuth de calendário continua sem requisito de
  produto — manter ICS read-only.
- [x] **Política de conectores de e-mail:** manter IMAP/SMTP como opções avançadas e AgentMail server-side
  para a integração por webhook; envio continua sob D9. OAuth Gmail/Microsoft não será adicionado sem
  requisito de produto e validação de credenciais/escopos.
- [x] **Fila local de tarefas longa — durável:** entregue na 1.9.0 (v16): fila SQLite
  idempotente com payload cifrado, leases e recovery conservador. Pendente apenas a retomada
  automática (idempotência por ferramenta + reconciliação explícita, item abaixo).
- [ ] **Voz conversacional local — parcial:** TTS local validado com XTTS (1.9.1) e STT local por
  whisper.cpp entregue como perfil Docker isolado e opt-in (1.9.0). Streaming de voz ainda não foi
  validado com um motor/host em produção. Não habilitar captura ou persistência de áudio sem
  indicador e consentimento.

## Decisões atualizadas em 2026-10-30

- Sem retenção automática de memória por padrão; política opt-in entregue na 1.9.0 mantém período
  por administrador, preview e confirmação antes de remover dados.
- OAuth de terceiros entregue para **e-mail** (Gmail/Graph, Authorization Code + PKCE, tokens
  cifrados) na 1.9.0; calendário permanece ICS read-only até haver requisito de produto.
- Sem Redis ou novo serviço de jobs: a fila durável da 1.9.0 (v16) usa SQLite com payload cifrado
  e leases; nenhuma infraestrutura externa foi adicionada.
- STT local existe como perfil Docker opt-in e não faz parte do container homologado de produção;
  sem captura ou persistência de áudio sem indicador e consentimento.


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
