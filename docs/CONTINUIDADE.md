# J.A.R.V.I.S. — Documento de Continuidade (Fases 2, 3 e 4)

Data: 2026-10-15 (histórico). Baseline atual: 2026-10-19 — ver §23. Estado histórico: Fase 2 integrada; Fase 3 (gestão documental) implementada com o primeiro formato **TXT** (ver progresso abaixo).

Procedência: **[V]** verificado nesta sessão · **[R]** reportado pelo responsável · **[I]** inferência · **[D]** decisão pendente.

> **Atualização 2026-10-19:** o estado corrente está em **§23** (pós-PRs #45 e #47); as seções 0–22 são históricas e foram preservadas. A §21 registra a baseline pós-#42; a §22, a pós-#44.

## 0. Progresso de execução (histórico — 2026-10-15)

> O estado corrente está em **§23**. Em especial, a Fase 4 foi iniciada, a titularidade foi
> decidida e implementada (PR #47) e o D_REC-1a existe; a especificação como documento e as
> autorizações operacionais continuam pendentes.

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

Terminologia adotada: a do Plano Mestre. D2 resolvido documentalmente em 2026-10-19: o `roadmap.md` foi alinhado ao Plano Mestre e X1/X2 foram corrigidos (ver §19).

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

## 12. Decisões — estado em 2026-10-15

> **Seção histórica.** O estado corrente está em **§23**: D_REC-1a foi implementado, F4.11 e a
> titularidade foram decididas; a especificação como documento e as autorizações operacionais
> continuam pendentes.

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
| Posterior | D2 — numeração | **Resolvido em 2026-10-19**: roadmap alinhado ao Plano Mestre (§19) |


| Prioridade | Decisão | Próximo passo |
|---|---|---|
| Bloqueadora | D1 (e D11) — base e repositório oficiais | Confirmar o repositório e o commit pós-Fase 1 |
| Bloqueadora | D3 — dados sem proprietário | Definir a política de migração e de acesso |
| Alta | D4/D5 — compartilhamento e preferências | Definir o que é privado, pessoal e global |
| Alta | D6 — PDF ou TXT | Escolher o primeiro formato documental |
| Alta | D7/D9 — e-mail | Definir autenticação e confirmações |
| Posterior | D8/D10 | Definir limites e preparar contas de teste autorizadas |
| Posterior | D2 — numeração | **Resolvido em 2026-10-19**: roadmap alinhado ao Plano Mestre (§19) |

- D1 Base oficial: sincronizar `143d042b` aqui (enviar L1) ou aprovar `2ab542c` após comparação.
- D2 Numeração: **resolvido em 2026-10-19** — `roadmap.md` alinhado ao Plano Mestre; histórico em §6 e §19.
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

## 19. Baseline 2026-10-19 — pós-PR #40 (atualização)

Procedência: **[V]** verificado nesta sessão · **[D]** decisão do proprietário · **[I]** não confirmado/inferência.

Esta seção registra a baseline **pós-PR #40**; o estado corrente pós-PRs #45 e #47 está em §23. As seções 0–18 são históricas e foram preservadas.

### 19.1 Repositório e PR #40

| Item | Valor | Proc. |
|---|---|---|
| `origin/main` | `6ec1986ed895e0c57020c09cd880eec3932cbaba` | [V] |
| PR #40 | head `581a077c154a19247876d8c14adb2e3fbc523301`; base `594cec1face28dae19340cbb0913b28a477692ef`; merge `6ec1986ed895e0c57020c09cd880eec3932cbaba`; `mergedAt` 2026-10-19T15:26:44Z | [V] |
| Diff do PR | apenas `.github/workflows/ci.yml` (+37 linhas); job `testes` da matriz Ubuntu/Windows inalterado (7 steps) | [V] |
| SkillSpector no CI | v2.13.0, commit imutável `091a509b3d6ba8ff5be528966e1f43c2e68cf214` | [V] |
| `astral-sh/setup-uv` | v10.3.0, SHA imutável `1c37ad07a6a961277cf70c0d37d6f313000f5884` | [V] |
| CI pós-merge | run `39278025495` concluído **success** às 15:58:38Z; os três jobs **success** (Windows às 15:34:24Z) | [V] |

### 19.2 Contrato do job real

O job dedicado `SkillSpector real (v2.13.0 @ 091a509)`:

- instala o scanner pelo commit imutável, não pela tag móvel;
- confirma `command -v skillspector` e a versão **exata** `SkillSpector v2.13.0`;
- executa `node --no-warnings --test tests/skill-scanner.test.mjs` com o scanner real;
- usa `set -o pipefail` e asserções TAP que exigem o teste `scanner REAL` sem `# SKIP`,
  `# skipped 0` e `# fail 0`;
- falha em ausência, erro de instalação, versão divergente, erro de execução ou skip silencioso;
- declara `permissions: contents: read` e não altera os jobs Ubuntu/Windows existentes.

O run de PR #40 (`39274961499`) teve os três checks verdes: `SkillSpector real`,
`Testes (ubuntu-latest)` e `Testes (windows-latest)`. No run pós-merge, os três jobs concluíram
com sucesso (scanner 15:28:11Z, Ubuntu 15:29:02Z, Windows 15:34:24Z) e o run global concluiu
**success** às 15:58:38Z (`39278025495`).

### 19.3 Melhorias futuras (não bloqueadores)

1. Atestar em runtime o `source_revision` reportado pelo scanner no CI — **concluído no PR #41**
   (ver §20).
2. Avaliar a fixação do executável `uv` e das dependências Python transitivas — **concluído no
   PR #42** (ver §21).
3. Exercitar a saída `incomplete` com o scanner real e, se justificado, o scanner no Windows.
4. Registrar que a indisponibilidade real dos serviços externos não foi testada.

### 19.4 Próxima lacuna recomendada

**Atestar `source_revision` no relatório real do SkillSpector**, comparando-o ao commit fixado e
falhando o job quando não corresponder. Escopo delimitado: expor de forma aditiva o
`source_revision` já presente no relatório interno do scanner e assertá-lo no teste real, sem
instalar/ativar Skills, sem credenciais e sem alterar produção. **Concluído no PR #41**
(`71c0832`; ver §20). As lacunas que dependem de decisão do proprietário (Fase 4/e-mail, política
de Skills, deploy/migração v12, credenciais externas, heartbeat e retenção) permanecem bloqueadas;
as melhorias técnicas restantes estão em §19.3.

### 19.5 Documentos atualizados nesta baseline

- `roadmap.md` — concluído × parcial × decisões do proprietário × próxima tarefa.
- `docs/CONTINUIDADE.md` — esta seção (histórico preservado).
- `docs/RELATORIO-P02-2026-10-18.md` §L — detalhe do CI e das melhorias futuras.
- `docs/ARQUITETURA-FASE1-2026-10-18.md` — correção da afirmação de que o CI só corria stubs.

## 20. Baseline 2026-10-19 — pós-PR #41 (atualização)

Procedência: **[V]** verificado nesta sessão · **[D]** decisão do proprietário · **[I]** não confirmado/inferência.

Esta seção registra a baseline **pós-PR #41**; o estado corrente pós-PRs #45 e #47 está em §23. As seções 0–19 são históricas e foram preservadas.

### 20.1 Repositório e PR #41

| Item | Valor | Proc. |
|---|---|---|
| `origin/main` | `71c083227b999155068ae91a6d1c963d69b6232c` | [V] |
| PR #41 | head `7d1b2dc534a6083c15f9b11c93425be4893f9592`; base `6ec1986ed895e0c57020c09cd880eec3932cbaba`; merge `71c083227b999155068ae91a6d1c963d69b6232c`; `mergedAt` 2026-10-19T17:21:28Z | [V] |
| Diff do PR | `server/skill-scanner.js` e `tests/skill-scanner.test.mjs` (+134 linhas, 0 remoções); nenhum workflow, rota ou dependência alterados | [V] |
| Atestação de proveniência | o relatório real declara a revisão `091a509b3d6ba8ff5be528966e1f43c2e68cf214` com origem `package_vcs_metadata`; o teste real exige os dois, separadamente da versão `2.13.0` | [V] |
| CI pós-merge | run `39293416082` concluído **success** às 17:26:24Z; três jobs **success** (scanner 17:22:09Z, Ubuntu 17:23:24Z, Windows 17:26:23Z) | [V] |

### 20.2 O que o PR #41 fechou

O adaptador expõe de forma **aditiva** `sourceRevision` e `sourceRevisionSource`, extraídos do
formato real do SkillSpector 2.13.0 — por analyzer, em
`metadata.llm_provenance.analyzers[].analyzer_revision.source_revision` (origem
`package_vcs_metadata`, do `direct_url.json` da distribuição instalada). A extração é conservadora:
se a lista estiver vazia ou algum analyzer não declarar a mesma revisão hex válida e a mesma
origem, o valor exposto é `null` — nunca um valor arbitrário. O teste real atesta a versão `2.13.0`
e a revisão fixada **separadamente**; os testes de unidade cobrem revisão correta, ausente,
malformada e divergente; o job pós-merge executou o teste real sem skip (`ok 19`, `# skipped 0`,
`# fail 0`) e os logs não expõem conteúdo de Skills. Limitação: a atestação comprova a
**consistência declarada**, não a integridade criptográfica do binário.

Links: [PR #41](https://github.com/verissimodf/AssistentePessoal/pull/41) ·
[run pós-merge](https://github.com/verissimodf/AssistentePessoal/actions/runs/39293416082).

### 20.3 Melhorias futuras (não bloqueadores)

1. Fixar de forma reproduzível o executável `uv` e as dependências Python transitivas do job do
   scanner — **concluído no PR #42** (`uv 0.13.1` com checksum e 63 pins; ver §21).
2. Exercitar a saída `incomplete` com o scanner real e, se justificado, o scanner no Windows (a
   cobertura atual de `incomplete` é só por stubs; no Windows o teste real é skip).
3. Validar integrações externas (IMAP/SMTP, Telegram, Ollama, TTS) com credenciais e serviços
   reais; a indisponibilidade real desses serviços também não foi testada. Depende do proprietário.

### 20.4 Próxima tarefa recomendada

**Fixar de forma reproduzível o `uv` e as dependências Python transitivas do job do scanner**
(versão explícita do `uv` e lock/constraints), mantendo o commit imutável do SkillSpector e a
atestação de proveniência. É um follow-up de supply chain, pequeno, sem efeito em produção,
credenciais ou política de Skills; **concluído no PR #42** (`03ebb2d`; ver §21).

As pendências que dependem de decisão do proprietário (Fase 4/e-mail, política de Skills,
deploy/migração v12, credenciais externas, heartbeat e retenção) permanecem bloqueadas.

### 20.5 Documentos atualizados nesta baseline

- `roadmap.md` — concluído × parcial × decisões do proprietário × próxima tarefa.
- `docs/CONTINUIDADE.md` — esta seção (a §19 foi preservada como baseline pós-PR #40).
- `docs/RELATORIO-P02-2026-10-18.md` §M — detalhe do PR #41 e do CI.
- `docs/ARQUITETURA-FASE1-2026-10-18.md` — cobertura de 19 testes e atestação de proveniência.

As alterações documentais desta baseline foram integradas à `main` pelo PR #43 (merge `a4b2085`,
2026-10-19T18:46:54Z); nenhum deploy, migração ou alteração de código foi feita.

## 21. Baseline consolidada 2026-10-19 — pós-PRs #40, #41 e #42

Procedência: **[V]** verificado nesta sessão via API do GitHub e git · **[D]** decisão do proprietário · **[I]** não confirmado/inferência.

Esta seção consolidou o estado após os PRs #40, #41 e #42; o estado corrente pós-PRs #45 e #47 está
em §23. As seções 0–20 são históricas e foram preservadas; o detalhe de cada PR continua em §19
(pós-#40) e §20 (pós-#41).

### 21.1 Repositório e PRs integrados

| Item | Valor | Proc. |
|---|---|---|
| `origin/main` | `03ebb2d35e427e5d7b4a1e0457c9f46b9492204e` | [V] |
| PR #40 | merge `6ec1986ed895e0c57020c09cd880eec3932cbaba`; `mergedAt` 2026-10-19T15:26:44Z | [V] |
| PR #41 | merge `71c083227b999155068ae91a6d1c963d69b6232c`; `mergedAt` 2026-10-19T17:21:28Z | [V] |
| PR #42 | head `017e141d54963c7e9f7502ec3bdc22051fcc9fbc`; base `71c083227b999155068ae91a6d1c963d69b6232c`; merge `03ebb2d35e427e5d7b4a1e0457c9f46b9492204e`; `mergedAt` 2026-10-19T18:19:32Z; estado **MERGED** | [V] |
| Diff do PR #42 | 4 arquivos, +540/−3: `.github/workflows/ci.yml` (+17/−3), `.github/skillspector-constraints.txt` (+231), `scripts/verify-skillspector-deps.mjs` (+147), `tests/verify-skillspector-deps.test.mjs` (+145) | [V] |
| CI pós-merge | run `39301820429` (`push` em `03ebb2d`) — global **success**; 3/3 jobs **success** | [V] |

O PR #42 foi integrado por merge commit de dois pais (`71c0832` e `017e141`), não por squash; a
`main` contém o histórico do endurecimento do verificador. O merge não alterou documentos.

### 21.2 O que o PR #42 fixou

- **`uv` reproduzível:** `astral-sh/setup-uv` recebe `version: 0.13.1` e o checksum sha256 oficial
  do artefato linux-x86_64 (`eadd9d27c134ab5ac1ffd4473b97a741407f3ea238288f03121fc4deddf90220`);
  um passo falha se `uv --version` divergir. Fim do `Falling back to latest`.
- **Dependências fixadas:** `.github/skillspector-constraints.txt` com **63 pins `==`** derivados
  do `uv.lock` do commit `091a509b3d6ba8ff5be528966e1f43c2e68cf214` via
  `uv export --locked --no-dev --no-emit-project --no-emit-local --no-hashes` — 62 incondicionais
  + `colorama==0.4.6 ; sys_platform == 'win32'`. Export determinístico (sha256 `e1b4a094…` nas duas
  execuções).
- **Instalação e verificação:** instalação com `--python 3.12 --constraints`; o verificador
  `scripts/verify-skillspector-deps.mjs` confere o **conjunto efetivamente instalado** contra as
  constraints (pacote extra, versão divergente, pin ausente, pin não-`==`, pin Linux ausente,
  Python ≠ 3.12).
- **Verificador endurecido:** parsing estrito de `uv pip list --format freeze` (linha não
  interpretável falha), normalização PEP 503, nomes duplicados rejeitados (sem sobrescrever no
  `Map`) e exigência explícita do pacote principal `skillspector`; funções puras exportadas e
  **16 testes** em `tests/verify-skillspector-deps.test.mjs`.
- **Preservado:** commit imutável do scanner, versão `2.13.0`, atestação `source_revision` /
  `package_vcs_metadata` (PR #41), execução obrigatória sem skip e ausência de conteúdo de Skills
  nos logs.

### 21.3 CI pós-merge confirmado

Run **`39301820429`** ([link](https://github.com/verissimodf/AssistentePessoal/actions/runs/39301820429)),
evento `push`, head `03ebb2d…`, criado em 2026-10-19T18:21:30Z, conclusão **success**.

| Job | ID | Janela | Resultado |
|---|---|---|---|
| `SkillSpector real (v2.13.0 @ 091a509)` | `118228680611` | 18:21:33–18:22:04Z | **success** |
| `Testes (ubuntu-latest)` | `118228679953` | 18:21:33–18:24:05Z | **success** |
| `Testes (windows-latest)` | `118228680646` | 18:21:33–18:26:52Z | **success** |

Evidência do job dedicado: `instalado: uv 0.13.1`; `Resolved 63 packages` / `Installed 63
packages`; `ok: 63 pins conferidos; 62 dependências instaladas; Python 3.12`; a condicional
`colorama==0.4.6 ; sys_platform == 'win32'` foi listada como não aplicável; `ok 19 - scanner REAL`;
`# skipped 0`; `# fail 0`. Na matriz, Ubuntu e Windows registraram `# tests 516` e `# fail 0` (o
teste real do scanner é skip esperado nesses jobs, coberto pelo job dedicado).

### 21.4 Limitações remanescentes (conhecidas e documentadas)

1. **Hashes não são aplicados** pelo `uv tool install` 0.13.1 nesse fluxo: constraints com hash são
   ignoradas (prova negativa com hash corrompido instalou igual) e `--require-hashes` rejeita o
   requisito git. O mecanismo equivalente é pins exatos + verificação de conjunto no CI.
2. **Dependências de build** do próprio projeto (hatchling e transitivas) continuam resolvidas na
   construção — fora do lock e não cobertas pelo verificador.
3. **Constraints precisam ser regeneradas** quando o commit do scanner mudar; nesse caso o job
   falha explicitamente (pacote/pin divergente) em vez de derivar em silêncio.
4. **Checksum do `uv` fixado para linux-x86_64**: mudança de arquitetura do runner exige atualização
   explícita e falha até lá.
5. **`incomplete` real e Windows** continuam sem cobertura real (só stubs); o job do scanner é
   Ubuntu-only.

### 21.5 Melhorias técnicas futuras (não bloqueadores)

1. Fixar as dependências de build com `--build-constraints` (hatchling e transitivas).
2. Exercitar a saída `incomplete` com o scanner real e, se justificado, o scanner no Windows.
3. Validar integrações externas (IMAP/SMTP, Telegram, Ollama, TTS) com credenciais e serviços reais;
   a indisponibilidade real desses serviços também não foi testada.

### 21.6 Decisões que dependem de autorização do proprietário

Continuam abertas e **não foram tocadas**: Fase 4/e-mail (especificação não aprovada; F4.11 e
D_REC pendentes), política de instalação/ativação de Skills (`enabled.json`), deploy e migração de
produção (código atual na v12), validação de integrações com credenciais reais, heartbeat/autonomia
e retenção/expurgo de backups e do ledger.

### 21.7 Itens não verificados em produção

- Deploy, migração e runtime de produção não foram executados nem inspecionados nesta tarefa.
- A indisponibilidade real de serviços externos (GitHub, NVIDIA, PyPI, IMAP/SMTP, Telegram, Ollama,
  TTS) não foi provocada; existem apenas stubs e simulações locais.
- A atestação de proveniência verifica a **consistência declarada**, não a integridade
  criptográfica do binário.

### 21.8 Documentos atualizados nesta baseline

- `roadmap.md` — concluído × parcial × decisões do proprietário × próxima tarefa.
- `docs/CONTINUIDADE.md` — esta seção consolidada (as seções §19 e §20 foram preservadas).
- `docs/RELATORIO-P02-2026-10-18.md` §N — detalhe do PR #42 e do CI pós-merge.
- `docs/ARQUITETURA-FASE1-2026-10-18.md` — pin do `uv`, constraints e verificador endurecido.

Esta baseline documental foi integrada à `main` pelo PR #43 (merge `a4b2085`); nenhum deploy,
migração ou alteração de código/workflow foi feita nesta tarefa.

## 22. Baseline consolidada 2026-10-19 — pós-PR #44

Procedência: **[V]** verificado nesta sessão via API do GitHub e git · **[D]** decisão do proprietário · **[I]** não confirmado/inferência.

Esta seção consolidou o estado após o PR #44; o estado corrente pós-PRs #45 e #47 está em §23. As
seções 0–21 são históricas e foram preservadas; a §21 continua sendo a baseline pós-#42.

### 22.1 Repositório e PR #44

| Item | Valor | Proc. |
|---|---|---|
| `origin/main` | `686dcfd6812568c7e0f8aefdec1278fac17486d5` | [V] |
| PR #44 | head `351b318f1a67ac4263d688e3bdfdcac57ae197ff`; base `a4b208514e6dee685b86daa2de0208e57e9d9598`; merge `686dcfd6812568c7e0f8aefdec1278fac17486d5`; `mergedAt` 2026-10-19T20:45:01Z; estado **MERGED** | [V] |
| Diff do PR #44 | 3 arquivos, +151/−4: `.github/skillspector-build-constraints.txt` (+34), `.github/workflows/ci.yml` (+11/−4), `tests/verify-skillspector-build-constraints.test.mjs` (+106); nenhum código de aplicação, documento, dependência de runtime ou política de Skills alterado | [V] |
| CI pós-merge | run `39321916745` (`push` em `686dcfd`) — global **success**; 3/3 jobs **success** | [V] |

O PR #44 foi integrado por merge commit de dois pais (`a4b2085` e `351b318`), não por squash. O run
de validação do PR (`39309593743`) também teve 3/3 jobs verdes.

### 22.2 O que o PR #44 fixou

O backend de build do scanner no commit `091a509b3d6ba8ff5be528966e1f43c2e68cf214` é
`hatchling.build`, com `requires = ["hatchling"]` e **sem plugins**. O `uv.lock` do mesmo commit
trava `hatchling 1.31.0` e as transitivas `packaging 26.2`, `pathspec 1.1.1`, `pluggy 1.6.0` e
`trove-classifiers 2026.6.1.19`.

O `uv 0.13.1` suporta `--build-constraints` no fluxo `uv tool install`. O PR #44:

1. adicionou `.github/skillspector-build-constraints.txt` com os **5 pins exatos** das cinco
   dependências de build e hashes SHA-256 (sdist + wheel), gerados com
   `uv pip compile --generate-hashes` a partir das versões do `uv.lock` do upstream;
2. passou a instalar com `--build-constraints` **e** `--require-build-hashes`, que exige hash para
   **todas** as dependências de build: uma transitiva não pinada faz a instalação falhar em vez de
   resolver a versão atual;
3. adicionou `--no-cache` ao passo de instalação, para não reutilizar um wheel de build antigo;
4. adicionou `tests/verify-skillspector-build-constraints.test.mjs` (**6 testes**): conjunto exato
   de pins/versões, presença de hash, rejeição de duplicatas e de linhas não pinadas, ligação do
   workflow (`--build-constraints`, `--require-build-hashes`, `--no-cache`) e consistência entre o
   commit do scanner no workflow, nas constraints de runtime e nas de build.

Provas negativas executadas com cache limpo: `hatchling==1.31.0` + `pluggy==0.13.1` falha por
resolução (`No solution found ... pluggy==0.13.1`); apenas `hatchling` com hash, omitindo as
transitivas, falha com `Hash-checking is required, but no trusted hash was provided for: pathspec`.
A suíte total passou a **522 testes** (516 antes; +6 do teste de build), com **0 falhas** (skips de
plataforma no CI); o teste real do scanner continua **19/19**; `npx vitest run` 84/84;
`npm run build` e `git diff --check` ok.

O runtime não foi alterado: 63 pins, `uv 0.13.1` com checksum, commit imutável do scanner e
atestação `source_revision`/`package_vcs_metadata` continuam como no PR #42.

### 22.3 CI pós-merge confirmado

Run **`39321916745`** ([link](https://github.com/verissimodf/AssistentePessoal/actions/runs/39321916745)),
evento `push`, head `686dcfd…`, criado em 2026-10-19T20:45:03Z, conclusão **success**.

| Job | ID | Janela | Resultado | Evidência |
|---|---|---|---|---|
| `SkillSpector real (v2.13.0 @ 091a509)` | `118297842672` | 20:45:07–20:45:34Z | **success** | `instalado: uv 0.13.1`; `ok: 63 pins conferidos; 62 dependências instaladas; Python 3.12`; `SkillSpector v2.13.0`; `ok 19 - scanner REAL`; `# skipped 0`; `# fail 0` |
| `Testes (ubuntu-latest)` | `118297842183` | 20:45:06–20:47:09Z | **success** | `# tests 522`; `# pass 517`; `# fail 0`; `# skipped 5` |
| `Testes (windows-latest)` | `118297842682` | 20:45:06–20:50:12Z | **success** | `# tests 522`; `# pass 498`; `# fail 0`; `# skipped 24` |

Os skips dos jobs de matriz são condicionais de plataforma já existentes; o job dedicado exige e
obteve `# skipped 0` e `# fail 0`. O passo de instalação com `--build-constraints` +
`--require-build-hashes` concluiu sem erro.

### 22.4 Limitações remanescentes (conhecidas e documentadas)

1. **Hashes de runtime não são aplicados** pelo `uv tool install` 0.13.1 nesse fluxo; a garantia de
   runtime continua sendo pins exatos + verificação do conjunto instalado no CI.
2. **Hashes de build** são exigidos e aplicados (`--require-build-hashes`), mas refletem os
   artefatos do PyPI no momento da geração; não há garantia de retenção eterna no índice.
3. **Ambos os arquivos de constraints precisam ser regenerados** quando o commit do scanner mudar
   (runtime e build). O teste de consistência e o job falham explicitamente até lá.
4. **Fallback para sdist:** se alguma dependência de runtime passar a ser instalada a partir de
   sdist, o `--require-build-hashes` também exigirá hashes para as dependências de build dela; o
   job falha explicitamente até revisão. Isso não ocorreu no conjunto validado (Linux/Python 3.12).
5. **`incomplete` real e Windows** continuam sem cobertura real do scanner; o job dedicado é
   Ubuntu-only e o teste real é skip esperado nos jobs de matriz.
6. **Checksum do `uv` fixado para linux-x86_64**; mudança de arquitetura do runner exige atualização
   explícita e falha até lá.
7. **Backend de build sem plugins** hoje; se o upstream adicionar plugins ou requisitos dinâmicos,
   o arquivo de build e o teste precisam ser atualizados.
8. **`--no-cache`** aumenta um pouco o tempo do job, deliberadamente, para não reutilizar builds
   anteriores.
9. **Atestação de proveniência** verifica a consistência declarada, não a integridade criptográfica
   do binário.

### 22.5 Melhorias técnicas futuras (não bloqueadores)

1. Exercitar a saída `incomplete` com o scanner real e, se justificado, o scanner no Windows.
2. Avaliar um mecanismo equivalente de hashes para as dependências de runtime, se o fluxo do `uv`
   evoluir nesse sentido.
3. Validar integrações externas (IMAP/SMTP, Telegram, Ollama, TTS) com credenciais e serviços
   reais; a indisponibilidade real desses serviços também não foi testada. Depende do proprietário.

### 22.6 Decisões que dependem de autorização do proprietário

Continuam abertas e **não foram tocadas**: Fase 4/e-mail (F4.11 aprovada em 2026-10-15 — correção
de estado em relação às seções históricas, que a registravam como pendente —, mas especificação
como documento e autorização de implementação pendentes; a **titularidade de contas de e-mail** foi
decidida em 2026-10-19 — `docs/FASE-4-EMAIL.md` §11.3, Padrão A + exceção B, com mecanismo mínimo
implementado e operação real pendente), política de instalação/ativação de Skills (`enabled.json`),
deploy e migração de produção (código atual na v12), validação de integrações com credenciais reais,
heartbeat/autonomia e retenção/expurgo de backups e do ledger.

### 22.7 Itens não verificados em produção

- Deploy, migração e runtime de produção não foram executados nem inspecionados nesta tarefa.
- A indisponibilidade real de serviços externos (GitHub, NVIDIA, PyPI, IMAP/SMTP, Telegram, Ollama,
  TTS) não foi provocada; existem apenas stubs e simulações locais.
- A atestação de proveniência verifica a **consistência declarada**, não a integridade
  criptográfica do binário.

### 22.8 Documentos atualizados nesta baseline

- `roadmap.md` — concluído × parcial × decisões do proprietário × próxima tarefa.
- `docs/CONTINUIDADE.md` — esta seção consolidada (as seções §19, §20 e §21 foram preservadas).
- `docs/RELATORIO-P02-2026-10-18.md` §O — detalhe do PR #44 e do CI pós-merge.
- `docs/ARQUITETURA-FASE1-2026-10-18.md` — build fixado, `--require-build-hashes` e limitações.

Esta baseline documental foi integrada à `main` pelo PR #45 (merge `f563af5`, 2026-10-19T21:16:45Z).
As alterações documentais locais do worktree principal foram integralmente preservadas; esta
baseline partiu de `origin/main` (`686dcfd`), não do worktree local. Nenhum código, workflow,
dependência ou configuração de produção foi alterado nesta tarefa.

### 22.9 Próxima lacuna funcional (não iniciada)

A maior lacuna funcional é a **Fase 4 — e-mail**: com a F4.11 aprovada, o núcleo de e-mail, as
rotas/ferramentas com transporte mockado e o adaptador IMAP/SMTP já existem, mas o transporte real,
a conta dedicada de teste e as autorizações operacionais continuam inativos. Depende de aprovação
do proprietário; **não foi iniciada nesta execução**.

## 23. Baseline consolidada 2026-10-19 — pós-PRs #45 e #47 (estado corrente)

Procedência: **[V]** verificado nesta sessão via API do GitHub e git · **[D]** decisão do proprietário · **[I]** não confirmado/inferência.

Esta seção consolida o estado após o PR #45 (baseline documental pós-#44) e o PR #47
(transferência explícita de contas de e-mail). As seções 0–22 são históricas e foram preservadas; a
§22 continua sendo o detalhe pós-#44. Esta atualização é **puramente documental**: nenhum código,
workflow, dependência ou configuração de produção foi alterado nesta tarefa.

### 23.1 Repositório e PRs

| Item | Valor | Proc. |
|---|---|---|
| `origin/main` (baseline de trabalho) | `57a991f51174799e96a0897e3b5f380c5e5f50cd` | `git fetch --all`; `git rev-parse origin/main` |
| PR #45 | **MERGED**; “docs: consolida baseline pós-PR #44”; head `a49c14f17927c88c968edc5d036f00fe3125491d`; merge `f563af5f51291306185ee127b97ff9f02de4d251`; `mergedAt` 2026-10-19T21:16:45Z; 4 documentos, +284/−22 | `gh pr view 45`; `git diff --stat 686dcfd f563af5` |
| PR #47 | **MERGED**; “feat(fase4): transferência explícita de contas de e-mail (D_REC-1a)”; head `a7538902f140aaf9d4fdb0bddc529079eed7da65`; merge `57a991f51174799e96a0897e3b5f380c5e5f50cd`; `mergedAt` 2026-10-19T22:21:12Z; 6 arquivos, +578/−35 | `gh pr view 47` |
| PR #46 | **Substituída** por esta baseline; head `cc68a38d6444bef1db237e20ec09c2e2d7c13d40`; merge-base `686dcfd`; checks antigos verdes, mas o conteúdo estava desatualizado | `gh pr view 46`; `git diff origin/main cc68a38` |

### 23.2 Revisão da PR #46

A PR #46 propunha uma baseline pós-PR #44 nos quatro mesmos documentos. A revisão confrontou o diff
original com a `main` atual e concluiu que **não há conteúdo técnico exclusivo a reaplicar**:

- o PR #45 já integrou os quatro documentos com as conclusões do #44, incluindo os **6 testes** de
  constraints de build, os pins/hashes, as provas negativas e o CI pós-merge `39321916745`;
- a versão da `main` é mais precisa em pontos que a PR #46 deixava incompletos (contagem de testes,
  detalhes dos jobs de CI e limitações de runtime/build);
- a PR #46 ficou conflitante porque foi criada antes do #45 e não incorporou a atualização
  documental nem o #47.

A PR substituta reaplica somente as correções de estado necessárias (baseline #45/#47, Fase 4 e
referências cruzadas) e referencia a #46; a justificativa final do encerramento fica registrada no
próprio PR #46. Nenhum conteúdo válido da #46 é descartado.

### 23.3 Fase 4 — estado atual verificado na `main`

| Item | Estado |
|---|---|
| F4.11 (pastas/filtros/limites/retenção) | **aprovada** em 2026-10-15; limites implementados e testados |
| Titularidade de contas de e-mail | **decidida** em 2026-10-19: Padrão A + exceção B (`docs/FASE-4-EMAIL.md` §11.3; `docs/D_REC.md` D_REC-1a) |
| Transferência explícita | API `POST /api/ownership/mail/transfer` e `server/settings.js::transferMailAccount`; 7 testes em `tests/mail-ownership.test.mjs`; sem UI dedicada |
| Especificação como documento / autorização geral | **pendente** (§11, item 2) |
| D7 / transporte real | **pendente**; `JARVIS_MAIL_TRANSPORT` continua mock por padrão |
| O1–O4 (operação real) | **pendentes**: ativar transporte, primeira conexão/leitura, envio e escopo adicional |
| Validação operacional | **não executada**; nenhuma conta real, credencial real, envio ou deploy |

A transferência move o bloco cifrado e grava a cópia no destino com `enabled=false`/`state="reconnect"`.
Ela **não** conecta a conta, **não** ativa o transporte, **não** envia e **não** reativa credenciais.
A decisão de titularidade não substitui as autorizações operacionais.

### 23.4 CI pós-merge

| Run | Head | Evento | Resultado | Jobs |
|---|---|---|---|---|
| [`39326226275`](https://github.com/verissimodf/AssistentePessoal/actions/runs/39326226275) | `f563af5` | `push` | **success** | 3/3 success: SkillSpector, Ubuntu, Windows |
| [`39334333129`](https://github.com/verissimodf/AssistentePessoal/actions/runs/39334333129) | `57a991f` | `push` | **success** | 3/3 success: SkillSpector, Ubuntu, Windows |

O run do PR #47 (`39332693003`) também teve os três jobs verdes antes do merge. Esses resultados
cobrem o CI; **não** cobrem deploy, produção, conta real, credenciais reais ou envio.

### 23.5 Próxima fase recomendada — validação operacional da Fase 4 (requer autorização)

**Objetivo:** validar o caminho real de **leitura e titularidade** de e-mail com uma conta de teste
dedicada e transformar a configuração atual em uma experiência operacional verificável no painel,
sem envio real nesta etapa.

**Escopo funcional proposto:**
1. teste de conexão explícito e estado da conta (mock/real, habilitada, último resultado sanitizado);
2. validação de leitura real e isolamento entre administradores com a conta dedicada;
3. tratamento de erro de autenticação/rede sem expor credenciais ou conteúdo;
4. nenhuma ativação de envio; o envio permanece bloqueado até autorização O3 separada.

**Reutilização:** `server/mail.js`, `server/mail-imap.js`, `server/mail-service.js`, rotas
`/api/mail/*`, `admin_settings` cifrado, auditoria sanitizada e a aba de comunicação em
`src/routes/configuracoes.tsx`. Persistência nova só se o estado do teste precisar sobreviver ao
processo; caso contrário, manter em memória e não criar tabela.

**Lacunas confirmadas:** o formulário atual grava campos e `enabled`, mas não executa um teste de
conexão nem mostra estado real; F4.5 (gestão de conexão) continua pendente; não há UI de
transferência de conta; o adaptador real nunca foi exercitado contra provedor.

**Critérios de aceite:** autorização O1/O2 registrada; conta dedicada configurada para um único
administrador; leitura real retorna corpo sanitizado; segundo admin recebe `404 account_not_found`;
nenhuma senha aparece em resposta/log/auditoria; teste de conexão é server-side e auditado apenas
com metadados; transporte pode ser desligado e volta ao mock; envio real continua inexistente.

**Dependência de decisão:** a execução depende de autorização explícita do proprietário para O1
(transporte real) e O2 (primeira conexão/leitura). Sem ela, o fallback técnico não bloqueador é
exercitar `incomplete` real/Windows do SkillSpector; ele não substitui a validação da Fase 4.

**Riscos/rollback:** o teste usa apenas conta dedicada; em caso de erro, remover
`JARVIS_MAIL_TRANSPORT`, reiniciar o serviço, revogar a senha de aplicativo no provedor e apagar o
campo cifrado. Nenhuma credencial deve ser registrada no repositório, terminal ou relatório.

### 23.6 Bloqueador de deploy — a imagem construída a partir da `main` não arranca

**Descoberto na validação operacional O1/O2 (2026-10-19).** O estágio de runtime do `Dockerfile`
copia `server/`, `.output` e `scripts/`, mas **não** copia o diretório de topo `skills/`. Como
`server/skill-scanner.js` resolve `../skills/` (→ `/app/skills`) no **topo do módulo**, e
`server/index.js` importa esse módulo, o contentor morre no arranque com
`ENOENT ... lstat '/app/skills'` e nunca fica healthy.

| Item | Estado |
|---|---|
| Container em produção | **intacto** — a imagem em uso (`assistente-pessoal:1.2.2-pr31-e9a5e53`, commit `e9a5e53`) é **anterior** ao commit que introduziu o scanner (`bf9b1cd`) e por isso não é afetada |
| CI | **não deteta** — `ci.yml` tem apenas `testes` (ubuntu/windows) e `skillspector`; **nenhum job constrói a imagem**, logo a imagem quebrada passa com CI verde |
| Correção | `COPY skills/ ./skills/` no estágio de runtime, com teste de contrato estático `tests/dockerfile-runtime-assets.test.mjs` que falha na imagem quebrada pelo motivo certo (asset em falta) |

**Consequência:** qualquer *deploy* construído a partir da `main` atual sobe um contentor que não
arranca. Isto tem de ser resolvido **antes** de qualquer promoção de release. O teste é estático de
propósito (sem build de imagem no CI) e o bug de classe mais ampla — "imagem que não arranca sem
nenhum job que o arranque" — fica registado como follow-up.

**Nota de escopo (O1/O2):** a validação operacional correu sobre a imagem construída a partir de
`0fbdc6c` com `skills/` montado **somente-leitura** no contentor descartável, por causa deste
bloqueador. A imagem em si não foi alterada pela validação; o texto acima descreve o defeito
encontrado, e a correção vive em PR própria e revisável.
