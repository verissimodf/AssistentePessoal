# Roadmap de evolução

Atualizado após a release **1.8.1** (27/10/2026). Este roadmap separa pendências operacionais de
ideias de produto; as propostas abaixo **não estão aprovadas nem comprometidas**. O foco é primeiro
fechar e medir os fluxos existentes, mantendo a diretriz local-first e as barreiras de autorização.

## Pendências de conclusão da 1.8.1

- [ ] Um administrador reivindicar a inbox AgentMail configurada em **Configurações → Integrações**.
  A migração v14 deliberadamente não atribui owner a registros antigos; após o claim, validar leitura
  de metadados/eventos. Não enviar e-mail real durante a validação sem autorização do operador.
- [ ] Decidir se os clientes diretos do MCP hospedado AgentMail em `.mcp.json`/`opencode.json` devem
  ser removidos/desabilitados. Eles são um caminho independente que não herda ownership, aprovação
  D9 ou auditoria do Jarvis; a integração server-side já oferece o caminho protegido.
- [ ] Publicar os commits locais da release no remoto por meio do fluxo normal do repositório. Até lá,
  o deployment local é reproduzível pelo SHA do build documentado em `HOMOLOGACAO_STATUS.md`, mas não
  está disponível em `origin/main`.
- [ ] Reduzir dívida do lint em lotes pequenos; o diagnóstico da 1.8.1 encontrou 363 ocorrências
  Prettier nos arquivos analisados, além de poucas regras antigas. Evitar reformatar todo o código de
  uma vez junto de mudanças funcionais.

## Próximas melhorias propostas

### P1 — Qualidade do núcleo e operação

- [ ] **Avaliação offline dos fluxos agênticos:** adicionar cenários versionados de chat, escolha de
  ferramentas, recusa/approval D9, injeção em documentos/e-mail e fallback entre provedores. Critério:
  execução sem rede/chaves, resultados determinísticos e relatório comparável entre releases.
- [ ] **Observabilidade local do router:** expor métricas agregadas de latência, timeout, fallback,
  erro por provider e tokens/custo quando fornecidos pelo backend. Critério: sem conteúdo de prompts,
  chaves ou identificadores pessoais nos registros; retenção configurável e armazenamento local.
- [ ] **Hardening do scheduler:** auditar deduplicação, concorrência, retomada após reinício, limites
  por admin e cancelamento de tarefas. Critério: operação repetida não dispara efeitos externos duas
  vezes; ações com efeito continuam usando approval e ownership.
- [ ] **Portão de release repetível:** automatizar migração a partir do schema imediatamente anterior,
  smoke de API/painel, conferência de metadados da imagem e rollback de aplicação mantendo o banco
  compatível. Critério: pipeline usa banco descartável e nunca credenciais/dados de produção.

### P2 — Memória e conhecimento

- [ ] **Ciclo de vida de memória controlado pelo usuário:** revisar, corrigir, apagar, exportar e
  definir retenção por admin. Critério: isolamento por ownership, exclusão verificável e auditoria sem
  registrar o conteúdo da memória.
- [ ] **Qualidade do RAG observável:** mostrar origem/citação dos trechos, estado de indexação e
  motivo de fallback lexical. Adicionar corpus sintético de avaliação para precisão/recall sem enviar
  documentos reais a terceiros.
- [ ] **Rotinas de captura de conhecimento opt-in:** resumir documentos ou conversas somente sob
  solicitação/consentimento claro, com revisão humana antes de gravar na memória persistente.

### P3 — Integrações e novos serviços opcionais

- [ ] **Conectores de calendário e tarefas:** começar por ICS somente leitura ou serviço local; depois
  avaliar Google/Microsoft OAuth com escopos mínimos, tokens cifrados por admin e confirmação para
  escrita. Critério: consulta isolada por proprietário; criar/alterar evento passa por aprovação.
- [ ] **Consolidar conectores de e-mail:** decidir entre manter IMAP/SMTP como opção avançada ou
  evoluir OAuth de Gmail/Microsoft. Reutilizar interface de transporte, D9, sanitização e ownership;
  não persistir corpos por padrão.
- [ ] **Fila local para tarefas longas:** avaliar SQLite jobs antes de introduzir Redis ou serviço
  externo. Só adotar nova infraestrutura se medições mostrarem que o scheduler atual não atende;
  jobs devem sobreviver a reinícios, ser idempotentes e canceláveis.
- [ ] **Voz conversacional local:** avaliar STT local opcional e streaming de TTS, mantendo o painel
  funcional sem hardware/serviço de voz. Critério: botão de privacidade visível, indicador de gravação
  e áudio não persistido sem consentimento.

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
