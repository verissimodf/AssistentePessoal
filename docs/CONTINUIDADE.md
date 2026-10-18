# J.A.R.V.I.S. — Documento de Continuidade (Fases 2, 3 e 4)

Data: 2026-10-15 (UTC). Estado: Fase 2 integrada; Fase 3 (gestão documental) implementada com o primeiro formato **TXT** (ver progresso abaixo).

Procedência: **[V]** verificado nesta sessão · **[R]** reportado pelo responsável · **[I]** inferência · **[D]** decisão pendente.

## 0. Progresso de execução (atualizado)

- **Fase 2 — Preferências e isolamento:** integrada na `main` (PR #3, merge `514c8ff`). Tabela `ownership` (v2), configurações pessoal/global, bloqueio de dados sem dono com reivindicação explícita e auditada. CI verde (Linux + Windows).
- **Fase 3 — Gestão documental:** implementada com o **primeiro formato TXT** (sem dependência nova), conforme o PM §6 (“começando por PDF ou TXT, conforme a análise técnica”). Módulo `server/documents.js`, migração **v3** (tabela `documents` + extensão do CHECK de `ownership` para `document`), rotas `/api/documents*`, ferramenta de agente `document_search`, página **Documentos** e `tests/documents.test.mjs`. Validação de entrada, armazenamento local privado, busca por dono, exclusão e tratamento de conteúdo não confiável.
- **Decisão técnica registrada (D6):** o primeiro formato é **TXT** — nenhuma biblioteca nova, menor superfície de risco; PDF fica para depois de validar o TXT (PM §6: “adicionar novos formatos somente após validar o anterior”).
- **Pendências:** recuperação da propriedade dos recursos após recuperação de acesso continua em aberto; PDF, pesquisa semântica de documentos e Fase 4 (e-mail) não iniciados.
- **Preparação da Fase 4 (2026-10-15):** especificação proposta em `docs/FASE-4-EMAIL.md` (D7/D9/D10 adotados) e política **D_REC** proposta em `docs/RECUPERACAO.md` §D_REC. **Implementação não iniciada** — aguarda aprovação.
- **Testes de isolamento com embeddings:** ajustados para verificar propriedade (não resultado vazio) e comprovados com Ollama ativo (98/98 nas duas condições); ver PR de preparação.

## 1. Repositório e base
| Item | Valor | Proc. |
|---|---|---|
| Repositório | projeto Lovable `2044cd04-…` (remoto interno `origin`) | [V] |
| Branch | `edit/edt-b807ee0b-…`; existem `main` e `origin/main` | [V] |
| Último commit de código | `2ab542c` "Endureceu autenticação do admin" (2026-10-14 22:16 UTC); acima dele há só commits do arquivo de plano | [V] |
| `76737393…` e `143d042b…` | não existem neste repositório (`git cat-file` falha) | [V] |
| Merge na main, 58/58, CI Linux+Windows | não verificável aqui | [R] |

Divergência de base: os commits informados não foram confirmados **no repositório examinado**. Isso não prova que o merge não exista no GitHub. Causas possíveis [I]: merge feito em outro repositório (o Plano Mestre cita `laytech-ia-debug/AssistentePessoal`; o pedido inicial, `laytech-ia-debug/Jarvis`); GitHub não conectado a este projeto; ou aplicação do diff/ZIP, o que gera hashes diferentes. Não foi possível comparar o conteúdo. A base não foi alterada. Nenhuma fase será implementada antes do recebimento do diff ou bundle da base oficial (L1). → D1, D11.

## 2. Fontes consultadas
Plano Mestre (510 linhas; §1, §3.3, §4, §5.1–5.4, §6); Diretriz Mestra de Continuidade; plano inicial (`.lovable/plan/jarvis-assistente-pessoal-100-local-2026-10-13.md`); `roadmap.md`; `AGENTS.md`; `docs/ARQUITETURA.md`, `docs/RECUPERACAO.md`, `SECURITY.md`, `CHANGELOG.md`; revisões da Fase 1 (4 uploads); `RELATORIO-VALIDACAO-FASE1.md`; código em `server/`, `src/lib/bridge.ts` e `tests/`.

Lacunas (arquivos a pedir):
- L1: commits `143d042b`/`76737393` (bundle ou diff da main pós-merge).
- L2: log do CI 58/58 Linux+Windows.
- L3: detalhes da Fase 4 além do §6/§5.3 (pastas, filtros, limites) — não localizado.
- L4: política aprovada para dados antigos sem dono, exceto bots — não localizada.

## 3. Visão (PM §1, citação)
"evoluir essa aplicação existente para um assistente pessoal mais completo, com múltiplos administradores autorizados, preferências individualizadas, gestão documental e integrações externas, preservando os recursos que já funcionam." Plano inicial: 100% local, Windows/Linux, ZIP pronto para GitHub.

## 4. Arquitetura real [V]
Painel React/TanStack (`src/`) → HTTP → serviço Node 22 em `127.0.0.1:7777` (`server/index.js`). Módulos: `auth.js` (máx. 2 admins, sessão HttpOnly, CSRF, tokens de serviço, rate limit, `can()`/`isVerifiedAdmin()`), `migrations.js` (v1, backup verificado + SHA-256), `db.js` (node:sqlite; tabelas kv, memories, agents, bots, runs, approvals, audit), `settings.js` (registro kv único, AES-256-GCM), `tools.js` (callTool reavalia o escopo), `comms.js`, `bots.js`, `llm.js`, `voice.js`, `mcp.js`, `hostpolicy.js`, `recuperar-acesso.js`.

Fatos para as próximas fases [V]:
- `memories`, `agents`, `approvals`, `runs` e settings não têm dono; só os bots têm `owner_admin_id`.
- `recall()` lê todas as memórias (`tools.js` l.61-62), sem filtro por usuário.
- `/api/memories`, `/api/agents` e `/api/settings` exigem só o escopo, sem checar o dono.
- Não há preferências individuais; não existe tabela de conversas.
- E-mail via IMAP/SMTP com `user` + `appPassword`; uma conta Gmail e uma Outlook por instalação; sem OAuth.
- Não existe módulo de documentos; o único upload é `/api/voice/clone`, com limite real de bytes.

## 5. Estado da Fase 1
| Afirmação | Proc. |
|---|---|
| Auth/authz em `auth.js`, `index.js`, `tools.js`, `bots.js`, `mcp.js` | [V] |
| `node --test tests/*.test.mjs` nesta sessão: 58 testes, 58 pass, 0 fail (Node v22.22.0, Linux do sandbox, 02:41 UTC) | [V] |
| `bunx vitest run` nesta sessão: 2 arquivos, 7 testes, 7 pass (mesmo ambiente) | [V] |
| 58/58 e 7/7 no ambiente do responsável; build OK; CI Linux+Windows | [R] |
| Não testado com serviço real: MCP/Claude Desktop, Telegram, IA real | [V] |
| Riscos herdados: 0600 não vale no Windows; memórias compartilhadas entre admins; cli_agent aprovado com timeout de 60 s | [V] |

Testes rodados com as dependências existentes, sem instalação, em bancos temporários (sem tocar em `data/`). Esses resultados valem só para o ambiente desta sessão e não substituem a confirmação do CI em Linux/Windows nem os testes com integrações reais.

## 6. Divergências
| # | Divergência | Proc. |
|---|---|---|
| X1 | PM §6: Fase 2 = Preferências e isolamento, Fase 3 = Gestão documental, Fase 4 = E-mail; `roadmap.md` l.4: "Fase 2 — gestão documental" | [V] |
| X2 | `roadmap.md` diz que a Fase 1 aguarda revisão; a Diretriz informa que já está integrada | [V]/[R] |
| X3 | commits informados ausentes | [V] |
| X4 | repositório de referência AssistentePessoal × Jarvis | [V] |
| X5 | PM §5.3 pede para avaliar OAuth; o código usa senha de app | [V] |

Terminologia adotada: a do Plano Mestre. Roadmap não alterado (D2).

## 7. Especificação original (PM §6, literal)
**Fase 2 — Preferências e isolamento dos dados.** Objetivo: separar os dados de cada administrador. Escopo: Preferências individuais. Proprietários e permissões dos recursos. Separação entre configurações globais e pessoais. Políticas de compartilhamento. Migrações compatíveis com os dados existentes. Critérios: Um usuário não consegue acessar dados privados do outro. O isolamento é aplicado no backend e nas ferramentas dos agentes. Recursos compartilhados possuem regras explícitas. Os dados existentes continuam disponíveis de acordo com a política de migração aprovada. (Complementos: §3.3 — separação "nas consultas, gravações, ferramentas de agentes, rotas HTTP, tarefas agendadas e integrações"; §4; §5.1.)

**Fase 3 — Gestão documental.** Objetivo: permitir ingestão e consulta contextual de documentos. "Executar inicialmente com um formato documental de cada vez, começando por PDF ou TXT, conforme a análise técnica." Por formato: Validação de entrada. Armazenamento local. Extração de conteúdo. Busca e recuperação. Integração contextual com o agente. Controle de acesso. Testes com arquivos válidos, inválidos e casos de erro. "Adicionar novos formatos somente após validar o anterior." (Complemento: §5.2 — documentos são "fontes de dados não confiáveis".)

**Fase 4 — E-mail.** Objetivo: evoluir Gmail e Outlook sem perder os conectores existentes. "Implementar separadamente leitura, pesquisa, envio e gestão de conexões, de acordo com as permissões aprovadas." Critérios: Credenciais armazenadas com segurança. Permissões mínimas necessárias. Separação das contas por usuário. Confirmação para operações sensíveis, quando aplicável. Testes reais somente com conta de teste autorizada. (Complemento: §5.3 — "avaliar OAuth e permissões específicas"; verificar a documentação oficial; conexão, desconexão, estado, erros, auditoria.)

## 8. Matriz de rastreabilidade
Estados: Implementado / Parcial / Ausente / Não localizado.

| ID | Requisito | Origem | Estado | Evidência | Pendência |
|---|---|---|---|---|---|
| F2.1 | Preferências individuais | PM §6 F2, §5.1 | Ausente | settings em kv único (`settings.js`) | D5 |
| F2.2 | Proprietário dos recursos | PM §6 F2, §5.1 | Parcial | só bots (`index.js` l.132-135); `db.js` l.16-20 sem dono | migração v2 + D3 |
| F2.3 | Global × pessoal | PM §6 F2, §3.3 | Ausente | `/api/settings` global (`index.js` l.114-115) | D5 |
| F2.4 | Compartilhamento explícito | PM §6 F2, §4 | Ausente | — | D4 |
| F2.5 | Isolamento nas ferramentas dos agentes | PM §6 F2, §3.3 | Ausente | `recall()` sem filtro (`tools.js` l.61) | filtrar pelo principal |
| F2.6 | Tarefas agendadas e integrações | PM §3.3 | Parcial | bots com dono (`bots.js` l.15-20); Telegram/MCP sem dono | identidade dos canais |
| F2.7 | Migrações compatíveis | PM §6 F2, §2.4 | Parcial (infra) | `migrations.js` | nova v2, sem editar a v1 |
| F2.8 | Lista de preferências | — | Não localizado | — | D5 |
| F3.1 | Primeiro formato PDF ou TXT | PM §6 F3 | Implementado | TXT (`server/documents.js`, migração v3) | PDF depois |
| F3.2 | Validação de entrada | PM §6 F3, §5.2 | Implementado | `validateDocument` (nome/tipo/vazio/tamanho/NUL) | — |
| F3.3 | Armazenamento local privado | PM §6 F3, §5.2 | Implementado | `data/documents/<adminId>/`, modo 0600 | — |
| F3.4 | Extração | PM §6 F3 | Implementado (TXT) | texto UTF-8 integral | PDF depois |
| F3.5 | Busca/recuperação | PM §6 F3, §5.2 | Implementado | `searchDocuments` por dono (keyword) | semântica depois |
| F3.6 | Contexto no agente | PM §6 F3, §5.4 | Implementado | ferramenta `document_search` (escopo) | — |
| F3.7 | Acesso por proprietário | PM §6 F3, §5.2 | Implementado | `ownership` tipo `document` | — |
| F3.8 | Exclusão/reindexação | PM §5.2 | Implementado | `deleteDocument` (linha+ownership+arquivo) | — |
| F3.9 | Conteúdo não confiável | PM §5.2 | Implementado | texto devolvido como dado, nunca executado | isolar no prompt |
| F3.10 | Testes válidos/inválidos/erros | PM §6 F3 | Implementado | `tests/documents.test.mjs` (6) | — |
| F3.11 | Valor do limite de tamanho | — | Implementado | `JARVIS_MAX_DOCUMENT` (2 MB) | ajustar se preciso |
| F4.1 | Preservar conectores | PM §6 F4 | Implementado (base) | `comms.js` | regressão |
| F4.2 | Leitura | PM §6 F4 | Parcial | `readEmail` (`comms.js` l.45) | escopo próprio |
| F4.3 | Pesquisa | PM §6 F4 | Ausente | — | — |
| F4.4 | Envio | PM §6 F4 | Parcial | `sendEmail` (`comms.js` l.32), auditado | confirmação + escopo |
| F4.5 | Gestão de conexões | PM §6 F4, §5.3 | Parcial | só formulário de configurações | conectar/desconectar/estado |
| F4.6 | Credenciais seguras | PM §6 F4 | Implementado | AES-256-GCM (`settings.js`) | revisar com D7 |
| F4.7 | Permissões mínimas | PM §6 F4 | Ausente | senha de app dá acesso total | D7 |
| F4.8 | Contas por usuário | PM §6 F4 | Ausente | uma conta por instalação | Fase 2 antes |
| F4.9 | Confirmação de operações sensíveis | PM §6 F4 | Ausente | envio sem aprovação | D9 |
| F4.10 | Teste real com conta autorizada | PM §6 F4 | Ausente | — | D10 |
| F4.11 | Pastas, filtros e limites | — | Não localizado | — | L3 |

## 9. Dependências e sequência recomendada
```text
D1 (base) -> Fase 2 -> Fase 3 (1 formato -> validar -> próximo)
                  \-> Fase 4 (leitura -> pesquisa -> envio -> conexões)
```
F3.7 e F4.8 dependem de F2.2. Módulos potencialmente afetados [I]: Fase 2 — `migrations.js` (v2), `db.js`, `index.js`, `tools.js`, `settings.js`, `bots.js`, `mcp.js`, `comms.js`, `bridge.ts`, `configuracoes.tsx`. Fase 3 — novo `server/documents.js`, `index.js`, `tools.js`, `migrations.js`, nova página. Fase 4 — `comms.js`, `tools.js`, `auth.js` (escopos), `settings.js`, `configuracoes.tsx`.

## 10. Testes e critérios de aceite
Os critérios **originais** são os citados literalmente na seção 7. Os itens abaixo são **critérios técnicos derivados [proposta]**, que só valem se forem aprovados; o Plano Mestre não os define literalmente.

Sempre [derivado]: suíte atual (58 + 7) passando; testes novos com dois admins reais, no padrão de `tests/http-auth.test.mjs`.
- Fase 2 [derivado]: B recebe 403/404 nos dados privados de A via HTTP, `callTool`, MCP e bots; o compartilhamento libera só o item compartilhado; a migração v2 preserva as linhas (contagem + hash SHA-256 antes e depois), aplica a política escolhida em D3 sem dono silencioso, é idempotente e tem rollback.
- Fase 3 [derivado]: arquivo válido é indexado e recuperado só pelo dono; tipo falso, vazio, acima do limite ou corrompido é rejeitado; a exclusão remove arquivo e índice; instrução maliciosa embutida em documento não executa ferramenta.
- Fase 4 [derivado]: cada operação é negada sem o escopo; o envio segue D9; contas de A ficam invisíveis para B; credenciais nunca aparecem em respostas ou na auditoria; testes reais só com a conta D10.

## 11. Riscos
Base divergente (X3) — regressão [V]; migração de dados sem dono pode ocultá-los ou transferir privilégio [I]; filtrar `recall` muda o comportamento de agentes e bots [I]; prompt injection por documentos [I]; biblioteca de PDF = dependência nova [I]; OAuth exige app registrado e callback local, e a verificação do Google pode restringir escopos [I]; senha de app contraria permissões mínimas [I]; 0600 não vale no Windows [V].

## 12. Decisões — estado
Atualizado em 2026-10-15: decisões resolvidas pela implementação (D1/D3/D4/D5/D6) ou **adotadas para a
especificação da Fase 4** (D7/D9/D10). **D_REC** é proposta nova, aguardando aprovação.

### Decisões adotadas
| Decisão | Adoção | Evidência |
|---|---|---|
| D1/D11 — base e repositório | `verissimodf/AssistentePessoal`, `main` | Fases 1–3 integradas |
| D3 — dados sem dono | invisíveis até reivindicação explícita, atômica e auditada | migração v2 + `ownership.js` |
| D4 — compartilhamento | por item (nesta fase) | Fase 2 |
| D5 — pessoal × global | pessoal por admin (`admin_settings`), global (`global_settings`) | Fase 2 |
| D6 — primeiro formato documental | **TXT** | §0 acima (Fase 3) |
| D7 — e-mail | **IMAP/SMTP sobre TLS + senha de app**; OAuth fora do escopo inicial | `docs/FASE-4-EMAIL.md` §2 |
| D9 — confirmações de e-mail | confirmação manual + **aprovação humana atômica** para agentes/bots, com titularidade no momento da execução | `docs/FASE-4-EMAIL.md` §2 |
| D10 — testes de e-mail | **mocks no CI** + conta dedicada para testes reais; sem expor/versionar credenciais | `docs/FASE-4-EMAIL.md` §2 |

### D_REC (nova) — recuperação, reivindicação e propriedade
- **Proposta formalizada** em `docs/RECUPERACAO.md` §D_REC (categorias 1–4, invariantes e pendência):
  recuperação de credenciais local, validação de identidade, reivindicação voluntária e granular de
  recursos **sem dono comprovável**, auditoria sanitizada e **proibição de transferência automática**.
- **Bloqueio explícito:** a reivindicação de recursos **vinculados a administrador desativado**
  (categoria 3) permanece **indisponível** até existir procedimento **aprovado e implementado**. Não há
  endpoint de transferência nem de expurgo nesta fase.

### Fase 4 — estado
- **D7, D9 e D10 adotadas como diretrizes da especificação** (`docs/FASE-4-EMAIL.md` §2) — **não**
  significam especificação aprovada nem autorização de implementação.
- **Bloqueadores de implementação:** (1) aprovação da especificação; (2) autorização explícita;
  (3) **F4.11** (pastas/filtros/limites/retenção — §3.1); (4) **D_REC** (categoria 3). Enquanto não
  resolvidos, a Fase 4 permanece **bloqueada**.

### Itens ainda em aberto
| Prioridade | Decisão | Próximo passo |
|---|---|---|
| Alta | D_REC — reivindicação de recursos de admin desativado | Aprovar a política; **implementação indisponível** até decisão |
| Alta | F4.11 — pastas, filtros, limites, retenção | Aprovar a recomendação inicial (§3.1) |
| Alta | Aprovação da especificação da Fase 4 + autorização de implementação | Revisão do PR #6 |
| Posterior | D8 — limites/cota por documento | Definir valores |
| Posterior | D2 — numeração | Ajustar ou registrar a equivalência no roadmap |


| Prioridade | Decisão | Próximo passo |
|---|---|---|
| Bloqueadora | D1 (e D11) — base e repositório oficiais | Confirmar o repositório e o commit pós-Fase 1 |
| Bloqueadora | D3 — dados sem proprietário | Definir a política de migração e de acesso |
| Alta | D4/D5 — compartilhamento e preferências | Definir o que é privado, pessoal e global |
| Alta | D6 — PDF ou TXT | Escolher o primeiro formato documental |
| Alta | D7/D9 — e-mail | Definir autenticação e confirmações |
| Posterior | D8/D10 | Definir limites e preparar contas de teste autorizadas |
| Posterior | D2 — numeração | Ajustar ou registrar a equivalência no roadmap |

- D1 Base oficial: sincronizar `143d042b` aqui (enviar L1) ou aprovar `2ab542c` após comparação.
- D2 Numeração: corrigir `roadmap.md` para o Plano Mestre ou registrar a equivalência.
- D3 Dados antigos sem dono (decisão de produto e segurança, não detalhe de migração): (a) somente leitura e compartilhados; (b) ocultos até um admin assumir, com auditoria; (c) compartilhados com leitura e escrita, marcados como legado; (d) outra. Preferência técnica registrada pelo revisor [R]: preservar os dados, fazer backup verificável e exigir uma política explícita de acesso antes de torná-los disponíveis aos administradores.
- D4 Compartilhamento: (a) por item; (b) espaço comum entre os dois admins; (c) nenhum nesta fase.
- D5 Quais configurações são globais e quais são pessoais (provedores e chaves, idioma, voz, agente ativo, host).
- D6 Primeiro formato: **TXT** (adotado — ver §0).
- D7 E-mail: **IMAP/SMTP sobre TLS + senha de aplicativo**; OAuth 2.0 fora do escopo inicial (adotado — `docs/FASE-4-EMAIL.md`).
- D8 Tamanho máximo por documento e cota por admin.
- D9 Operações de e-mail que exigem confirmação: **envio manual confirmado; agentes/bots com aprovação humana atômica** (adotado — `docs/FASE-4-EMAIL.md`).
- D10 Conta de teste autorizada: **mocks no CI + conta dedicada para testes reais**, sem expor/versionar credenciais (adotado — `docs/FASE-4-EMAIL.md`).
- D11 Repositório de referência: **`verissimodf/AssistentePessoal`** (adotado).

Próximo passo após a gravação: revisar o arquivo criado e confirmar a base oficial (D1). A Fase 2 só começa depois de aprovada, com os critérios de migração e isolamento definidos.

## 13. Fase 2 — correções da revisão do diff (15/10/2026)
Origem: revisão de `fase-2-isolamento.diff` (SHA-256 d6a67cd7…6f92c) e duas aprovações do plano de correção. Fase 2 **não encerrada**: aguarda conferência deste diff pelo responsável.

| Item | Implementação | Teste automatizado |
|---|---|---|
| Auditoria sem conteúdo privado | `audit()` em `db.js` grava só campos de uma allowlist explícita (ids, códigos, escopos, contagens); campos fora dela são descartados e contados em `dropped`. Comandos, prompts, mensagens e caminhos de arquivo não são mais enviados. | `phase2-fixes`: token sintético em comando, prompt, mensagem e gatilho ausente da tabela `audit` e de `GET /api/audit` |
| Aprovações 404 | Rota e `resolveApproval()` verificam a propriedade; aprovação alheia, legada ou inexistente → HTTP 404 `{error:"not_found"}` | `phase2-fixes`, `isolation`, `http-auth` |
| Resolução atômica | Estados: `pending → running → done/error`, `pending → denied`. Um único `UPDATE … WHERE status='pending'` decide quem executa; perdedores recebem 409. Falha na execução → `error`. Processo interrompido em `running` vira `interrupted` ao reiniciar (nunca reexecuta). Host desligado consome como `denied`. | 3 aprovações simultâneas → 200/409/409, uma única execução |
| Bots legados | Bloqueio auditado (`authz.bot_denied`, `legacy_blocked`, `trigger_type`) na rota manual (resposta 404 idêntica a bot inexistente), em `triggerByText` e no agendador (só no instante real de disparo; o laço de 20 s não audita). Sem texto nem caminho. | `phase2-fixes`: manual, voz e agendador; nenhuma `run` criada |
| Reivindicar `runs` | Na mesma transação: se o bot da execução tem dono diferente do solicitante → 403 `foreign_bot_run`, rollback total | lista mista → nada atribuído |
| Reivindicar aprovações | Pendentes passam a `legacy_expired` na mesma transação; `command`/`created_at` preservados; evento `legacy.approvals_expired`. Só `pending` é executável em todo o código. | aprovação expirada → 409, sem execução; lista com id inválido → rollback, continua `pending` |

Resultado nesta sessão [V]: `node --test tests/*.test.mjs` 84/84; `vitest` 7/7. Não validado: CI Linux/Windows, IA real, Telegram real.
Limite conhecido: bots legados com gatilho de arquivo nunca são observados (não há tentativa real a auditar). `GET /api/audit` continua visível às duas administradoras — agora sem conteúdo privado.

## 14. Fase 2 — correção final da auditoria (diff v3, 15/10/2026)

Status: implementado e testado automaticamente; **Fase 2 continua aberta** até a revisão do diff v3.

- `server/db.js`: `path`, `backup` e `token` removidos de `AUDIT_FIELDS`; `reason` aceito só de um conjunto fechado (`AUDIT_REASONS`); `agent` só nomes canônicos (`AUDIT_AGENTS`) ou UUID v4; novo campo `route` aceita apenas padrões estáticos `/api/...`; `backup_verified` booleano.
- `migration.v2_report`: grava só `from`, `to`, `backup_verified: true` e contagens — nunca o caminho do backup.
- `server/index.js`: `authz.csrf_rejected` e `authz.denied` gravam `route` (padrão declarado, ex. `/api/memories/:id`), nunca `url.pathname` nem query.
- `tests/audit-probe.test.mjs`: sonda `TOKEN_SECRETO_SONDA` em path, backup, token, reason, agent, rejeição de rota (CSRF com sonda no caminho e na query), `authz.denied` e relatório de migração (diretório de dados com a sonda no nome); verifica tabela `audit` e `GET /api/audit`.
- Resultados: `node --test` 90/90; vitest 7/7; `vite build` OK. Sem migrações alteradas, sem dependências novas, sem commit/push/banco real.
- Pendente: CI Linux/Windows, IA real, Telegram real; devolução de propriedade após recuperação de acesso.

## 16. Fase II — trilha de execução P1 (correlação persistente, 17/10/2026)

Status: implementado e testado automaticamente; **Fase II segue aberta** até revisão do diff P1.

- Estratégia de correlação (sem migração): `ctx.correlation` (UUID v4) gravado dentro de `approval_actions.action` (JSON, v6) no momento do pedido; `resolveApproval` relê e republica em `approved/started/done/error/unknown/denied`. Cadeia ordenada por id (append-only), demonstrada por `tests/audit-trail.test.mjs`.
- Eventos novos: `${kind}(started)`, `${kind}(done)`, `${kind}(unknown)` (timeout/abort e interrupção no boot). Falha confirmada mantém `${kind}(error)`. `rea_analyze(refused)` mantém.
- Boot: aprovações presas em `running` viram `interrupted` + evento `run_command(unknown) {reason:"interrupted"}` (sem retroativo de sucesso), testado em `tests/audit-interrupted.test.mjs`.
- Sanitização: segredo no comando nunca entra na trilha (sonda estendida); correlação é UUID validado.
- Concorrência: 3 resoluções → 200/409/409, cadeia única.
- Cancelamento: aprovação não resolvida permanece `pending`, sem started/done.
- Migração v9: **implementada e testada em cópia isolada** (coluna `correlation_id` em `approval_actions`, índice, triggers anti-UPDATE/DELETE em `audit`). **Não aplicada ao banco de produção** nesta fase; ver §18.
- Limitações: correlação ainda não ligada à conversa (clientMsgId) — a v9 dá a coluna estruturada, mas o vínculo com a mensagem do usuário continua pendente; auto-resposta do Telegram inalterada; expurgo/hash chain não implementados; Telegram/IA/CI reais não validados.

Resultados nesta sessão: `node --test` **330/330**; `vitest` **44/44**; `vite build` não executado; sem migrações alteradas, sem dependências novas, sem commit/push/banco real.

## 17. Fase II — P1.1: semântica de resultados e correlação (17/10/2026)

Status: implementado e testado automaticamente; **Fase II segue aberta** até revisão do diff P1.1.

- `classifyOutcome(kind, output)` (exportada de `tools.js`): classifica o retorno normal do executor por contrato — `confirmed` / `failed` / `denied` (cancelado antes da execução: destino/config mudou) / `unknown`. Não usa mais ausência de exceção como evidência de sucesso.
- `resolveApproval`: sucesso confirmado → `(done)`; falha confirmada → `(error)`; cancelamento pré-execução → `(denied) {reason:"policy_changed"}` com a mensagem original preservada; retorno ambíguo → `(unknown) {reason:"ambiguous_result"}`; timeout/abort de rede → `(unknown) {reason:"timeout"}`. Nenhum é reexecutado.
- Correlação: `rea_analyze(refused)` e `send_email(draft_created)` passaram a incluir `...corr(ctx)`.
- `AUDIT_REASONS`: `unknown_action`, `ambiguous_result`, `policy_changed` adicionados.
- Regressão corrigida: cancelamento por mudança de destino (fingerprint) voltou a ser `denied` com a mensagem original, não `error`.
- Testes: `tests/audit-outcomes.test.mjs` (11 casos: contratos reais, denied, unknown, timeout, correlação nos eventos corrigidos, sem efeito externo).
- Resultados: `node --test` **341/341**; `vitest` **44/44**. Sem migração, sem commit/push, sem banco real, sem auto-resposta do Telegram, sem ampliação de permissões.
- Limitações: `openhands 200` sem `conversation_id` ainda confirma (contrato atual); `run_command` com saída contendo `[erro]` no stdout próprio pode ser classificado como falha (heurística documentada); correlação ausente em `callTool` direto sem `ctx.correlation` (caminhos de teste/legado).

- Lacuna da revisão do v3: o teste de `authz.denied` chamava `audit()` diretamente.
- `tests/audit-probe.test.mjs`: novo teste emite um token de serviço real (`POST /api/auth/tokens`, escopo só `memories:read`) e faz `DELETE /api/memories/TOKEN_SECRETO_SONDA?probe=TOKEN_SECRETO_SONDA&TOKEN_SECRETO_SONDA=1` por HTTP. Verifica 403 `forbidden`, exatamente um `authz.denied` com `{ route: "/api/memories/:id", need: "memories:write", principal: "service" }`, e ausência da sonda e do token na tabela `audit` e em `GET /api/audit`.
- Nenhum código do serviço alterado. Resultados: `node --test` 91/91; vitest 7/7.
- Pendente: CI Linux/Windows, IA real, Telegram real; devolução de propriedade após recuperação de acesso.

## 18. Fase II — P2/P2.1: migração v9 e integração da correlação (17/10/2026)

Status: **implementado e testado em cópia isolada**; a v9 **não** foi aplicada ao banco de produção. Fase II segue aberta até a aprovação da janela de implantação.

- Migração v9 (`server/migrations.js`): `ALTER TABLE approval_actions ADD COLUMN correlation_id TEXT` + backfill de `action.correlation` (NULL quando ausente) + índice `idx_approval_actions_correlation` + triggers `trg_audit_no_update`/`trg_audit_no_delete` (append-only via SQL). Aditiva, idempotente, transacional e reversível por backup verificado; `approval_actions` não está em PRESERVED. Os triggers só são criados quando a tabela `audit` existe (esquema base do serviço) — em banco sem `audit` não há trilha a proteger.
- Integração (P2.1): `queueApproval` grava a coluna **quando existe** e mantém `action.correlation` no JSON; `approvalCorrelation` prefere a coluna e usa o JSON como fallback legado; divergência registra `audit.correlation_mismatch` (sanitizado) e mantém a coluna como valor seguro. Capacidade de esquema detectada explicitamente (`detectApprovalCorrelation`, via `PRAGMA`), sem esconder erros SQL genéricos.
- Boot: aprovações presas em `running` viram `interrupted` e emitem `${kind}(unknown) {reason:"interrupted"}` com a correlação lida da coluna (fallback JSON).
- `AUDIT_REASONS`: `correlation_mismatch` adicionado.
- Testes: `tests/migration-v9.test.mjs` (9), `tests/approval-correlation.test.mjs` (9), `tests/approval-correlation-boot.test.mjs` (2) — bancos temporários, sem efeitos externos.
- Documentação: `docs/RECUPERACAO.md` §v9 (procedimento, ordem segura de implantação/rollback código+banco, retenção).
- Resultados: `node --test` **361/361** (execução por arquivo; a suíte combinada pode apresentar flakiness pré-existente em `run-limits` sob carga paralela); `vitest` **44/44**. Sem commit/push, sem banco real, sem auto-resposta do Telegram, sem ampliação de permissões.
- Limitações: os triggers protegem a trilha contra o SQL do serviço, **não** contra acesso direto ao arquivo do banco; `trg_audit_no_delete` impede um `DELETE` normal (política de retenção exige decisão explícita); hash chain não implementado; vínculo com `clientMsgId` pendente; validação em produção pendente.
