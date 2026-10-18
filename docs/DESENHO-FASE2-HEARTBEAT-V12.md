# Fase 2 — Contrato de desenho do Heartbeat e schema v12

Estado: **proposta para revisão humana**. Este documento não implementa o daemon, não altera o schema, não ativa timers e não autoriza deploy.

Base: `main` após o merge da PR #28. O schema atual termina na v11; `session_focus` é a migração v11. A v12 será aditiva e só poderá ser implementada depois da aprovação deste contrato.

## 1. Objetivos e limites

- Detectar anomalias operacionais estruturadas com custo zero de tokens e sem chamadas a LLM no `tick()`.
- Persistir intenções com ownership explícito, sem herança de registros globais/legados.
- Exigir autenticação de sessão, CSRF em mutações, isolamento por administrador e política de host antes de qualquer operação.
- Preservar as tabelas `PRESERVED` byte/logicamente conforme as invariantes existentes.
- Manter o Heartbeat inerte por padrão e não iniciar timers quando a feature flag estiver desligada.
- Manter produção intocada durante implementação, testes e revisão.

Fora de escopo: execução autônoma de skills, conexão de MCPs/plugins, execução de LLM no tick, execução de shell no tick, ativação da flag em produção, prune/expurgo de dados e publicação de imagem.

## 2. Contrato da feature flag e ciclo de vida

A flag efetiva é habilitada somente se a configuração global persistida `heartbeat.enabled === true` ou a variável `JARVIS_P2_AUTONOMIA` indicar explicitamente habilitação, conforme precedência definida no código e documentada nos testes. Valor ausente, inválido ou qualquer valor não explicitamente verdadeiro significa **desligado**. A variável de ambiente não pode ser interpretada por truthiness genérica (`"false"` não é verdadeiro).

- Flag desligada: não registrar `setInterval`, não executar tick inicial, não gravar no banco e não enfileirar aprovações.
- Flag ligada: iniciar no máximo um timer por instância; `start()` idempotente; `stop()` limpa timer; `unref()` evita manter o processo vivo.
- O daemon não inicia durante importação de módulo. A composição em `createApp(opts)`/bootstrap decide explicitamente quando iniciar, e somente após avaliar a flag.
- `tick()` deve ser serializado por instância para impedir sobreposição de ticks. Não usar locks distribuídos nem presumir exclusividade entre processos.
- Não usar `survival_state` para armazenar conteúdo de sessão, prompts, payloads de ferramentas, credenciais ou dados pessoais.

## 3. Schema v12 proposto (aditivo)

A migração v12 adicionará somente `autonomy_intentions`, `survival_state` e índices próprios dessas tabelas. Não altera, renomeia ou reescreve `session_focus` nem tabelas de `PRESERVED = ["kv","memories","agents","bots","runs","approvals","audit"]`. Não inclui `simulador_indices`.

### 3.1 `autonomy_intentions`

Campos propostos:

- `id TEXT PRIMARY KEY`: UUID gerado no servidor.
- `admin_id TEXT NOT NULL REFERENCES admins(id)`: proprietário imutável, derivado da sessão autenticada; nunca aceito do body.
- `kind TEXT NOT NULL`: enum fechado de anomalias que o detector implementa explicitamente; sem nomes livres.
- `payload TEXT NOT NULL`: JSON estruturado por tipo de `kind`, limitado em bytes UTF-8 e itens antes de qualquer persistência; não incluir prompts, segredos, texto arbitrário nem conteúdo privado.
- `status TEXT NOT NULL`: enum fechado com transições controladas no servidor.
- `correlation_id TEXT NOT NULL`: UUID para idempotência e correlação de auditoria.
- `created_at TEXT NOT NULL`, `updated_at TEXT NOT NULL`.
- `resolved_at TEXT`, `resolution_code TEXT` opcional, limitado a códigos enumerados sem texto livre.

Índices mínimos: `(admin_id, status, created_at)`, `(admin_id, kind, created_at)` e unicidade da chave de idempotência definida para o contrato. A unicidade não deve impedir uma nova anomalia legítima depois do cooldown; usar um identificador de ocorrência/correlação apropriado, não apenas `(admin_id, kind)` para sempre.

Ownership é obrigatório em todas as leituras, listagens, alterações e resoluções: toda query de intenção usa `admin_id = ?` com o `adminId` obtido do contexto autenticado. IDs fornecidos pelo cliente servem apenas para selecionar o recurso dentro desse filtro. Nenhuma migração atribui intenções a admins por inferência.

### 3.2 `survival_state`

Tabela de estado operacional agregado da instalação, sem conteúdo privado:

- chave singleton restrita a um único registro;
- versão da aplicação/schema, início/uptime operacional, último tick concluído, último código de erro permitido e timestamp de atualização;
- sem adminId, resumo de sessão, payload de intenção, prompts, URLs privadas, caminhos, tokens ou mensagens de erro livres.

A ausência de registro deve ser um estado válido. Não gravar em cada tick ocioso: atualizações só em eventos de ciclo de vida ou diagnóstico com mudança significativa, conforme implementação aprovada. Os valores de versão/build não devem ser inferidos do branch atual.

### 3.3 Invariantes da migração

- Incrementar `targetVersion()` de 11 para 12 apenas na implementação aprovada.
- Uma única migração v12, contígua, com nome e expectativa de schema explícitos.
- Atualizar deliberadamente os guardiões em `tests/migration-invariants.test.mjs`; não remover as invariantes de versão, preservação, recusa destrutiva ou rollback.
- Validar backup e hash/conteúdo das tabelas preservadas antes/depois.
- Testar v11 → v12, banco novo até v12, repetição/idempotência do caminho de migração, SQL inválido, rollback integral e `PRAGMA integrity_check`.
- Ensaiar recuperação em banco isolado. Não executar migração em produção nesta fase.

## 4. Detector e contrato de `createHeartbeat`

Assinatura proposta:

```js
createHeartbeat({
  db, getSettings, audit, decide, safeFetch, callTool, queueApproval,
  now, uid, intervalMs = 60_000, cooldownMs = 300_000
})
```

Os parâmetros existentes podem ser injetados por DI para facilitar testes; dependências não utilizadas pelo detector não devem ser chamadas por conveniência. `callTool` não pode ser invocado pelo `tick()`. Não usar LLM direta ou indiretamente.

### Tick ocioso

- Fazer apenas as leituras mínimas necessárias, com cache TTL curto se comprovadamente útil.
- Não abrir transação de escrita, não atualizar timestamp de “último tick” a cada ciclo, não chamar LLM, não executar shell, não fazer fetch externo e não enfileirar aprovações.
- A prova do caminho ocioso deve observar chamadas e escritas reais no banco de teste, não apenas mocks que não representam a integração.

### Anomalia estruturada

- Cada detector retorna um objeto de schema fechado com `kind` conhecido e payload tipado.
- Validar tipos, número de itens e bytes UTF-8 do payload antes de serializar ou gravar.
- Exceder limites ou receber tipo inválido deve resultar em erro de validação explícito (HTTP 400 nos endpoints HTTP), nunca truncamento silencioso.
- O cooldown em memória evita gravações repetidas na mesma instância; a persistência/idempotência também precisa resistir a múltiplas instâncias e reinícios. Não declarar “lock-free” como garantia de coordenação distribuída.
- Só uma anomalia nova e válida pode iniciar uma escrita transacional.
- Auditoria somente com metadados aprovados, por exemplo `audit("heartbeat.anomaly_detected", { admin, kind, count })`; nunca serializar payload, descrição, prompt ou mensagem de erro.
- O campo `admin` deve corresponder a um proprietário autenticado e autorizado pelo serviço chamador; o detector não deve inventar uma identidade global nem atribuir anomalias a todos os admins por padrão.

## 5. Estados e transições de intenção

Enum inicial proposto: `pending`, `approved`, `rejected`, `queued`, `running`, `done`, `failed`, `cancelled`.

Transições válidas devem ser codificadas explicitamente, com compare-and-set/transação para impedir duplo processamento e resolução concorrente. O cliente não pode definir diretamente `status`, `admin_id`, `correlation_id` ou timestamps.

- `pending → rejected`: decisão autenticada do proprietário.
- `pending → approved`: registra somente a decisão humana sobre a intenção; **não executa a operação**.
- Qualquer operação com efeito externo deve, após a decisão humana, passar pelo contrato de aprovação existente, com autorização vinculada à operação concreta, e por `decide()` de `hostpolicy.js` antes da execução.
- `decide() === "deny"`: não enfileirar nem executar; registrar código de motivo não sensível.
- `decide() === "ask"`: usar o fluxo existente de aprovação humana e manter estado que não sugira execução autorizada.
- `decide() === "run"`: não executar diretamente nesta fase; produzir apenas a ação autorizada pelo fluxo explicitamente aprovado. O escopo inicial não habilita execução autônoma.
- Ao reiniciar, qualquer estado `running` deve ser reconciliado para `pending` ou `failed` com código explícito. Nunca retomar execução automaticamente.

A revisão humana da intenção e a aprovação de uma operação concreta são conceitos diferentes. A implementação deve evitar dupla aprovação ambígua e não pode tratar uma aprovação genérica como autorização para payload diferente.

## 6. Rotas HTTP e autenticação

Rotas propostas:

- `GET /api/heartbeat/status`: estado resumido, sem dados privados; exige escopo `session`.
- `GET /api/heartbeat/alerts`: lista paginada das intenções do admin autenticado; exige `session`; nunca aceita `admin_id` como filtro de propriedade.
- `POST /api/heartbeat/alerts`: ação explícita `approve` ou `reject` sobre uma intenção do admin autenticado; exige `session` + CSRF, validação estrita do body e verificação de ownership na mesma transação da mudança.

Injetar o serviço via `createApp(opts)` com `opts.heartbeat`; não iniciar timers como efeito colateral da criação de rotas nem no import do módulo. Reutilizar o padrão de auth/CSRF já usado por `/api/session-focus` e preservar `tests/http-auth.test.mjs`.

Respostas não devem revelar se um ID pertence a outro admin; usar resposta uniforme apropriada para não encontrado/não autorizado, consistente com contratos existentes. Erros de validação retornam 400 sem ecoar o payload privado. As rotas não executam ferramenta, shell ou LLM.

## 7. Contrato de auditoria e privacidade

- Usar apenas códigos e metadados allowlisted pelo sanitizador de auditoria existente. Antes de implementar novos campos, confirmar que o sanitizador os preserva; não contornar o allowlist.
- Eventos possíveis: `heartbeat.anomaly_detected`, `heartbeat.intention_approved`, `heartbeat.intention_rejected`, `heartbeat.intention_queued`, `heartbeat.intention_failed`.
- Metadados máximos: identificador do admin, kind fechado, contagem, status/código enumerado e correlation UUID validado, se permitido pelo contrato atual.
- Não registrar payload, comandos, URLs completas, prompts, texto de sessão, segredos nem mensagens livres.
- As consultas administrativas de auditoria/evidências continuam protegidas pelos contratos de autorização atuais.

## 8. Testes de aceite obrigatórios

### Heartbeat
1. Feature flag ausente/false/string `"false"` → nenhum timer, tick, escrita ou aprovação.
2. `start()` repetido não cria timers duplicados; `stop()` limpa timer; timer `unref()`.
3. Tick ocioso → zero chamadas LLM, zero `callTool`, zero fetch externo e zero escrita.
4. Anomalia nova → uma intenção com proprietário correto, correlation ID e payload válido.
5. Cooldown evita duplicação local; múltiplas instâncias/restart não duplicam a mesma ocorrência.
6. Payload acima do limite em bytes UTF-8, excesso de itens, kind desconhecido e tipos inválidos são rejeitados sem truncamento.
7. Falhas de DB não geram auditoria de sucesso nem estado parcial.
8. Auditoria sanitizada não contém payload privado nem campos fora da allowlist.

### Isolamento e HTTP
9. Admin A não lista, lê, aprova, rejeita ou infere a existência de intenção de B.
10. Sem sessão → 401; sem CSRF em mutação → rejeição consistente com os testes existentes.
11. Body inválido → 400; método/ação desconhecida não muda o estado.
12. Duas resoluções concorrentes não podem aprovar e rejeitar a mesma intenção.
13. A aprovação não executa ferramenta; `decide()` é consultado na etapa apropriada e `hostpolicy.js` permanece inalterado.
14. Regressão completa de `tests/http-auth.test.mjs`, `tests/hostpolicy.test.mjs`, testes de migração e suites de servidor/cliente.

### Migração e recuperação
15. v11 → v12 com tabelas preservadas sem alterações; backup verificável antes da mudança.
16. Falha induzida no meio da migração → rollback integral, sem objetos parciais.
17. `PRAGMA integrity_check = ok`; restauração testada em banco isolado.

## 9. Implementação, publicação e rollback

- Implementar em branch dedicada após aprovação deste desenho.
- Manter `server/hostpolicy.js` intacto; qualquer diff nesse arquivo bloqueia o PR e exige explicação/revisão separada.
- Feature flag permanece desligada por padrão e não será ativada em produção.
- Executar testes backend completos, frontend, build e CI Ubuntu/Windows; reportar skips honestamente.
- Criar PR separada para migração e Heartbeat, com diff revisável e evidências.
- Não fazer merge automático, deploy, migração de produção, ativação da flag, expurgo ou exclusão de backups.
- Rollback do código deve manter compatibilidade com schema v11; depois de uma migração v12 em ambiente de teste, validar a estratégia de restauração por backup em vez de presumir que o schema possa ser revertido com segurança.

## 10. Decisões que a revisão humana precisa confirmar

1. Lista inicial e semântica de `kind` permitidos.
2. Limites numéricos finais para payload em bytes UTF-8, quantidade de itens e tamanho de lista.
3. Precedência da flag persistida versus variável de ambiente e procedimento de desligamento emergencial.
4. Estados/transições finais e diferença entre aprovar uma intenção e aprovar uma operação concreta.
5. Dados operacionais mínimos permitidos em `survival_state`.
6. Retenção das intenções e evidências, alinhada à política de retenção aprovada; até lá, nenhuma exclusão automática.
7. Critérios de sucesso, rollback e autorização para um futuro deploy.

**Critério de aprovação:** aprovar este contrato ou solicitar alterações explícitas. A aprovação do documento não ativa a feature nem autoriza execução em produção.
