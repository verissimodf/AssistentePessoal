# J.A.R.V.I.S. — Documento de Continuidade (Fases 2, 3 e 4)

Data: 2026-10-15 (UTC). Estado: especificação aguardando aprovação.

Procedência: **[V]** verificado nesta sessão · **[R]** reportado pelo responsável · **[I]** inferência · **[D]** decisão pendente.

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
| F3.1 | Primeiro formato PDF ou TXT | PM §6 F3 | Ausente | — | D6 |
| F3.2 | Validação de entrada | PM §6 F3, §5.2 | Ausente (infra parcial) | limite de bytes já existe (`index.js`) | tipo/assinatura/tamanho |
| F3.3 | Armazenamento local privado | PM §6 F3, §5.2 | Ausente | — | — |
| F3.4 | Extração | PM §6 F3 | Ausente | — | depende de D6 |
| F3.5 | Busca/recuperação | PM §6 F3, §5.2 | Ausente (reaproveitável) | embeddings de `memories` | índice por dono |
| F3.6 | Contexto no agente | PM §6 F3, §5.4 | Ausente | — | ferramenta com escopo |
| F3.7 | Acesso por proprietário | PM §6 F3, §5.2 | Ausente | depende de F2.2 | Fase 2 antes |
| F3.8 | Exclusão/reindexação | PM §5.2 | Ausente | — | — |
| F3.9 | Conteúdo não confiável | PM §5.2 | Parcial | hostpolicy + escopo em `callTool` | isolar o texto no prompt |
| F3.10 | Testes válidos/inválidos/erros | PM §6 F3 | Ausente | — | — |
| F3.11 | Valor do limite de tamanho | — | Não localizado | — | D8 |
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

## 12. Decisões pendentes
Nenhuma decisão abaixo foi tomada neste documento.

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
- D6 Primeiro formato: TXT (sem dependência nova) ou PDF (provável biblioteca nova).
- D7 E-mail: OAuth, senha de app ou ambos. Nenhum deles será implementado antes de verificar os requisitos e a documentação oficial atual do Google e da Microsoft.
- D8 Tamanho máximo por documento e cota por admin.
- D9 Operações de e-mail que exigem confirmação.
- D10 Conta de teste autorizada para Gmail e Outlook (sem enviar credenciais por mensagem).
- D11 Repositório de referência: AssistentePessoal ou Jarvis.

Próximo passo após a gravação: revisar o arquivo criado e confirmar a base oficial (D1). A Fase 2 só começa depois de aprovada, com os critérios de migração e isolamento definidos.
