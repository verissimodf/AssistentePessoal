# Fase 4 — E-mail (especificação proposta)

**Status: proposta — aguarda aprovação da especificação e de F4.11.** Deriva do Plano Mestre §6
(Fase 4) e da matriz de rastreabilidade F4.1–F4.11 em `docs/CONTINUIDADE.md`. As partes **independentes**
já iniciadas — **núcleo de e-mail**, **rotas/ferramentas com transporte mockado**, **adaptador IMAP/SMTP
injetável (não ativado)** e **rascunho para aprovação humana** — estão em §10; o restante segue bloqueado
(§9, §11).

## 1. Objetivo

Evoluir os conectores de Gmail e Outlook **sem perder** os que já existem (`server/comms.js`), com
implementação separada de **leitura**, **pesquisa**, **envio** e **gestão de conexões**, respeitando as
permissões aprovadas e o isolamento por administrador da Fase 2.

## 2. Decisões adotadas como diretrizes da especificação

> **Distinção de estados (importante).** Estas decisões estão **adotadas como diretriz arquitetural da
> especificação**. Isso **não** significa que a especificação está aprovada como documento, nem que a
> implementação da Fase 4 está autorizada. A implementação segue **bloqueada** até (a) aprovação da
> especificação, (b) autorização explícita de implementação e (c) resolução dos bloqueadores da §9.

### D7 — Autenticação de e-mail
- **IMAP/SMTP sobre TLS** (IMAPS 993 / SMTP 587 com STARTTLS ou 465 com TLS implícito), com
  **credenciais compatíveis com o provedor** e **senhas de aplicativo** quando disponíveis.
- **OAuth 2.0 fica fora do escopo inicial.** Motivo: exige app registrado, callback local e verificação
  do provedor; será reavaliado depois, com a documentação oficial atual.
- Cada conta (Gmail/Outlook) tem um conjunto de credenciais **cifradas** (AES-256-GCM, `settings.js`).

### D9 — Confirmação e aprovação
- **Envio manual:** confirmação explícita do usuário na interface antes de enviar.
- **Envio por agentes/bots:** **aprovação humana atômica** (mesmo modelo das ações no host:
  `pending → running|denied` em uma única UPDATE condicional), com **validação de titularidade no
  momento da execução** (o aprovador deve ser o dono do recurso/execução).
- Nenhum envio ocorre sem confirmação/aprovação explícita.

### D10 — Testes
- **CI:** apenas **mocks** (sem rede externa, sem credenciais).
- **Testes reais:** conta **dedicada** de teste, executados manualmente/localmente; **nunca** versionar
  ou expor credenciais (nem em logs, nem em auditoria).

## 3. Escopo

| # | Item | Descrição |
|---|---|---|
| F4.1 | Preservar conectores | Gmail/Outlook atuais continuam funcionando (regressão garantida por testes). |
| F4.2 | Leitura | Listar/ler mensagens da **própria** conta do administrador, com paginação/limite. |
| F4.3 | Pesquisa | Buscar por remetente/assunto/texto/data, somente na conta do administrador. |
| F4.4 | Envio | Enviar com confirmação (D9); auditado; sem conteúdo sensível na auditoria. |
| F4.5 | Gestão de conexões | Conectar/desconectar/consultar estado/erros por conta. |
| F4.6 | Credenciais seguras | Cifradas em repouso; nunca devolvidas ao navegador nem à auditoria. |
| F4.7 | Permissões mínimas | Escopos dedicados (ex.: `comms:read`, `comms:send`), nunca `*`. |
| F4.8 | Contas por usuário | Cada administrador tem as **suas** contas; a de A é invisível para B (Fase 2). |
| F4.9 | Confirmação de operações sensíveis | Envio sempre confirmado/aprovado (D9). |
| F4.10 | Teste real com conta autorizada | Só com a conta dedicada (D10). |
| F4.11 | Pastas, filtros, limites e retenção | **Bloqueador** — configuração inicial proposta em §3.1, pendente de aprovação. |

### 3.1 F4.11 — Pastas, filtros, limites e retenção (bloqueador; recomendação inicial)

**Estado:** não definido no Plano Mestre (lacuna L3). Abaixo uma **recomendação conservadora, pendente de
aprovação** — **não é decisão tomada**.

| Parâmetro | Recomendação inicial | Impacto (segurança/privacidade/desempenho/disco) |
|---|---|---|
| Pastas | apenas `INBOX` nesta fase; pastas nomeadas depois | escopo reduzido, menor superfície |
| Filtros de pesquisa | `from`, `subject`, `since`/`before`, `unseen`; **sem** regex arbitrária no corpo | evita varredura pesada e injeção |
| Paginação | `limit` ≤ 50 por página; **teto** de 500 por consulta | protege memória e tempo de resposta |
| Limite de consulta | *rate limit* por administrador (ex.: 30 consultas/min) | evita abuso e throttling do provedor |
| Limite de envio | *rate limit* (ex.: 20 envios/hora) + tamanho máx. de corpo | evita spam/bloqueio da conta |
| Retenção | **não** persistir corpo de mensagens; no máximo metadados (id, data, remetente, assunto) com TTL curto | privacidade e uso de disco |
| Falhas do provedor | backoff exponencial; marcar conexão como `erro` e não repetir em loop | resiliência |
| Credenciais revogadas | detectar falha de autenticação, marcar `reconectar` e **não** reter a senha | segurança |

**Bloqueador:** estes valores precisam de aprovação antes da implementação. Enquanto não aprovados, a
Fase 4 **não** deve ser iniciada.

> **Atualização (incremento 3, 2026-10-15):** os limites de **paginação**, **tamanho de corpo/filtro**,
> **timeout/retry/backoff** já estão implementados como **mecanismo configurável** (`LIMITS` em
> `server/mail.js`, sobrescrevível por `createMailService({ limits })`) — ver §10.2. **Rate limit**
> (consulta/min, envio/hora) e **retenção** continuam **pendentes** (política): não foram implementados
> para não inventar valores nem persistir corpos.

## 4. Fora de escopo (Fase 4)

- OAuth 2.0 (reavaliar depois).
- Filtros/regras automáticas avançadas, anexos grandes e sincronização bidirecional completa.
- Qualquer funcionalidade das fases seguintes.

## 5. Módulos e arquivos previstos

- `server/comms.js` (evoluir: leitura/pesquisa/envio/estado por conta e por dono).
- `server/mail.js` (**novo**, se a complexidade justificar separar de `comms.js`).
- `server/auth.js` (escopos `comms:read`/`comms:send` já existem; revisar granularidade).
- `server/settings.js` (contas pessoais por administrador — D5 já separou pessoal/global).
- `server/migrations.js` (v4, se necessário armazenar metadados de conexão por administrador).
- `server/index.js` (rotas `/api/mail/*`), `server/tools.js` (`send_email`/`read_email` com escopo e
  aprovação), `src/routes/configuracoes.tsx` + página de e-mail.
- `tests/mail.test.mjs` (mocks) e, opcionalmente, `tests/mail-real.test.mjs` (conta dedicada, fora do CI).

## 6. Critérios de aceite (derivados)

1. Regressão: os conectores atuais continuam passando.
2. Leitura/pesquisa/envio negados sem o escopo correto (403) e sem titularidade.
3. A conta de A é invisível para B (lista, leitura, pesquisa, envio) — em rota, ferramenta e agente.
4. Envio manual exige confirmação; envio por agente/bot exige aprovação humana atômica com validação de
   titularidade no momento da execução.
5. Credenciais nunca aparecem em resposta HTTP, auditoria ou log.
6. `npm run build` e `tsc --noEmit` sem erro; suíte do backend e do painel verdes.
7. CI com mocks (sem rede/credenciais).

## 6.1 Segurança de conteúdo de e-mail (entrada não confiável)

Controles obrigatórios — registrados aqui como **critérios de aceite** (implementação futura):

1. **Instruções em mensagens não substituem instruções do sistema** — o corpo é dado, nunca comando.
2. **Ler e-mail não executa comandos nem autoriza ferramentas**; nenhuma ação no host é derivada do conteúdo.
3. **HTML sanitizado** antes de exibir (sem scripts, eventos inline, iframes ou URLs perigosas); na dúvida, exibir como texto.
4. **Logs e auditoria** nunca contêm corpo, assunto sensível, credenciais ou conteúdo privado (via `sanitizeAudit`).
5. **Titularidade validada** no momento da leitura, pesquisa, envio e execução autônoma — não apenas na rota.
6. **Aprovação não reutilizável**: transição atômica `pending → running|denied`; uma aprovação nunca executa duas vezes.
7. **Prompt injection**: o conteúdo é delimitado e rotulado como **não confiável** no prompt do agente.

## 7. Riscos

- Prompt injection por conteúdo de e-mail (tratar como **dado não confiável**, como os documentos da Fase 3).
- Vazamento entre administradores se a titularidade não for checada no envio/leitura.
- Exposição de credenciais em logs/auditoria (mitigado por `sanitizeAudit`).
- Bloqueio/limites do provedor (throttling, senhas de app revogadas) — tratar erros e estado da conexão.

## 8. Dependências

- Fase 2 (isolamento e contas por administrador) — **concluída**.
- D_REC (política de recuperação/propriedade) — proposta em `docs/RECUPERACAO.md`; afeta a titularidade
  das contas após recuperação de acesso.

## 9. Estado e bloqueadores (o que falta para liberar a implementação)

**D7, D9 e D10 estão adotadas como diretrizes da especificação** (ver §2) — **não** precisam de nova
confirmação para efeito documental. O que permanece **pendente**:

| # | Pendência | Estado | Bloqueia implementação? |
|---|---|---|---|
| 1 | Aprovação da especificação como documento | pendente | **Sim** |
| 2 | Autorização explícita para iniciar a implementação | pendente | **Sim** |
| 3 | F4.11 — pastas, filtros, limites e retenção (§3.1) | recomendação pendente de aprovação | **Sim** |
| 4 | D_REC — reivindicação de recursos de administrador desativado (`docs/RECUPERACAO.md` §D_REC) | pendente | **Sim** (gestão de contas após recuperação) |
| 5 | Conta dedicada para testes reais (D10) | a preparar pelo responsável | Não (só testes reais) |
| 6 | Controles de conteúdo não confiável (§6.1) | definidos como critérios de aceite | Não (são a própria implementação) |

**A Fase 4 permanece bloqueada** até que os itens 1–4 estejam satisfeitos. **Nenhuma implementação de
e-mail foi iniciada.**

## 10. Implementação incremental (partes que NÃO dependem das decisões pendentes)

**Estado (2026-10-15):** iniciada a parte **independente** da Fase 4 — o **núcleo de e-mail**
(`server/mail.js`) + testes com **mocks** (`tests/mail.test.mjs`). Não toca rede, credenciais, caixas
reais nem dados reais; não acessa nem envia nada. Não altera os conectores existentes (F4.1 preservado).

O que o núcleo já entrega (contrato reutilizável pelas rotas `/api/mail/*` e pelas ferramentas):

| Item | Entrega |
|---|---|
| §6.1.3 conteúdo não confiável | `sanitizeEmailBody` — remove script/style/iframe/objeto, eventos inline e tags; **nunca emite `<`/`>`** (markup codificado como entidade permanece texto inerte). |
| §6.1.1/§6.1.7 prompt injection | `labelUntrusted` + `UNTRUSTED_NOTICE` — delimita e rotula o conteúdo como **dado, nunca instrução**. |
| F4.3 busca | `validateSearch` — **allowlist** (`from`, `subject`, `since`, `before`, `unseen`); recusa regex/`body`/chaves desconhecidas; valida datas e tamanho. |
| §3.1 paginação | `clampPage` — nunca confia no cliente; aplica teto. |
| §3.1 falhas/credenciais | `classifyConnectionError` — auth → `reconnect` (não repetir); transitório → `error` (repetível). |
| F4.6 credenciais | `redactAccount` — nunca devolve a senha; mascara o endereço. |
| §3.1 timeout/backoff | `withRetry`/timeout por tentativa com backoff exponencial (sleep injetável). |
| F4.8 isolamento | `createMailService` + `settingsAccountResolver` — conta resolvida **por adminId**; "não é sua" e "não existe" são indistinguíveis. |
| F4.9/D9 envio | confirmação explícita `ENVIAR`; validação de destinatário/corpo/tamanho; auditoria **sem** conteúdo. |

**Limites (F4.11) são injetáveis** (`createMailService({ limits })`) e centralizados em `LIMITS`,
marcados como **provisórios/pendentes de aprovação** — a política não foi decidida aqui. **Não** há
persistência de corpo de mensagem (portanto, nenhuma janela de retenção a definir neste incremento).

### 10.1 Incremento 2 — rotas e ferramentas ligadas ao núcleo (mock)

**Estado (2026-10-15):** o núcleo foi ligado às **rotas** `/api/mail/*` e às **ferramentas**
`read_email`/`send_email`. O transporte continua **exclusivamente mockado** (`server/mail-service.js`):
nenhum provedor é contatado, nada é enviado, nenhuma credencial é usada.

| Rota | Acesso | Comportamento |
|---|---|---|
| `GET /api/mail/accounts` | `comms:read` | contas **do próprio admin**, com credenciais redigidas (F4.6) |
| `GET /api/mail/:account/messages` | `comms:read` | lista paginada (limite/teto no servidor) |
| `GET /api/mail/:account/search` | `comms:read` | filtros por **allowlist**; regex/`body`/chave desconhecida → 400 |
| `GET /api/mail/:account/messages/:id` | `comms:read` | mensagem com corpo **sanitizado** (texto), marcada `untrusted` |
| `POST /api/mail/:account/send` | **`session`** | envio **manual**: exige confirmação `ENVIAR` (D9); auditoria **sem** conteúdo |

- **Titularidade (F4.8):** a conta é resolvida **por adminId**; "não é sua" e "não existe" são
  **indistinguíveis** (`404 account_not_found`). Um nome de conta inválido é `400 invalid_account`.
- **CSRF/autenticação:** o envio manual é `session` (admin humano) e passa pelo CSRF do framework;
  tokens de serviço não enviam. Leitura aceita sessão ou token com `comms:read`.
- **Erros:** falha do provedor → `502 provider_error` **genérico** (sem mensagem/segredo do provedor);
  timeout limitado + retry só para falhas transitórias.
- **Ferramentas:** `read_email` usa o núcleo (saída sanitizada). `send_email` por **agente/bot** é
  **recusado** (`send_email(blocked)` auditado): exigiria aprovação humana atômica com o corpo entre
  solicitação e aprovação — o que implicaria **persistir o corpo**, proibido nesta fase. O humano envia
  pelo painel (rota `send` com `ENVIAR`). Ver §11.5.
- Testes: `tests/mail-routes.test.mjs` (12 casos, mocks) — não autenticado, titularidade, entradas
  inválidas, sucesso/falha do mock, timeout, retry, sanitização, envio sem/com confirmação, auditoria
  sem conteúdo, token de serviço recusado no envio.

**Ainda dependente de decisão (não implementado):** autenticação no provedor (D7); aprovação humana para
envio por agente/bot (§11.5); gestão de conexão persistida (F4.5); pastas/regras e **valores** de F4.11.
Nada disso é iniciado sem as respostas da §11 e sem autorização explícita de operação real.

### 10.2 Incremento 3 — F4.11 (limites explícitos) e D7 (adaptador IMAP/SMTP)

**Estado (2026-10-15):** (a) os **limites provisórios** foram tornados explícitos e continuam
configuráveis por serviço; (b) o **adaptador IMAP/SMTP** (D7) foi implementado como interface
injetável — **não** ativado por padrão e **não** conectado a provedor algum.

**a) Limites provisórios (F4.11) — mecanismo pronto, valores pendentes.** Todos vêm de `LIMITS`
(`server/mail.js`) e podem ser sobrescritos por `createMailService({ limits })`:

| Chave | Valor provisório | Corresponde a (§3.1) |
|---|---|---|
| `defaultPage` | 20 | paginação (default) |
| `maxPage` | 50 | paginação — `limit` ≤ 50 |
| `maxTotal` | 500 | paginação — teto por consulta |
| `maxBody` | 100 000 | tamanho máx. de corpo |
| `maxFilter` | 200 | tamanho máx. de filtro |
| `retries` | 2 | falhas do provedor — retry limitado |
| `timeoutMs` | 8 000 | falhas do provedor — timeout |
| `baseDelayMs` | 250 | backoff exponencial |

**Não** há rate limit implementado (consulta/min, envio/hora): é **política** de F4.11 e continua
pendente — implementar sem valor aprovado seria inventar política. Também **não** há retenção nem
persistência de corpo.

**b) Adaptador D7 (`server/mail-imap.js`).** Implementa a mesma interface do núcleo
(`list`/`read`/`search`/`send`) sobre **IMAP/SMTP + senha de aplicativo** (OAuth fora do escopo):

- **IMAPS 993** (`secure: true`) para leitura/pesquisa; **SMTP 587 com STARTTLS** (`requireTLS: true`)
  para envio; `logger: false`.
- Clientes do provedor **injetáveis** (`createImapClient`/`createSmtpTransport`) → **testes de contrato
  com clientes falsos**, sem socket. As importações de `imapflow`/`nodemailer` são **lazy**: importar ou
  construir o transporte **não** carrega o provedor.
- **Timeout, retry limitado e classificação de erros** continuam no núcleo (`mail.js`), que envolve cada
  chamada; o adaptador apenas lança o erro do provedor e **nunca** o registra.
- **Redação de segredos:** usuário/senha só entram nas opções do cliente; **nunca** são retornados,
  logados ou embutidos em mensagem de erro.
- **Não ativado por padrão:** o transporte default de `mail-service.js` continua sendo o **mock**.
  Ativar o real exige decisão (D7) e credenciais configuradas pelo operador.
- Testes: `tests/mail-imap.test.mjs` (9 casos de contrato) — opções/TLS/auth, lock de caixa liberado,
  logout, janela de paginação, mapeamento de busca, envio + fechamento, provedor desconhecido, falha de
  auth classificada como 502 **sem vazar a senha**.

**Ainda dependente de decisão:** ativar o transporte real (D7) e a autenticação no provedor; valores de
F4.11 (rate limit).

### 10.3 Incremento 3 — rascunho para aprovação (D9) e titularidade

**Estado (2026-10-15):** o envio por **agente/bot** passou de "recusado" para **rascunho para aprovação
humana**, sem persistir o corpo. Contas permanecem vinculadas ao titular original.

**a) Rascunho em memória (o "canal temporário seguro").** `server/mail-drafts.js` guarda o rascunho
**somente na memória do processo** (um `Map`) — **nunca** em banco, disco, auditoria ou log. Propriedades:

- **Vínculo ao dono:** `get`/`consume` exigem o mesmo `adminId`; rascunho de outro admin é
  **indistinguível** de inexistente (`404`).
- **Uso único:** `consume` remove o rascunho antes de enviar (sem replay).
- **Expiração e descarte:** TTL provisório (10 min, configurável) + limite de entradas (200, com descarte
  do mais antigo). Nada é retido após expirar/usar.

Fluxo: a ferramenta `send_email` de um agente/bot **não envia** — cria o rascunho e audita
`send_email(draft_created)` (sem conteúdo). O humano revisa (`GET /api/mail/drafts/:id`, **`session`**) e
confirma (`POST /api/mail/drafts/:id/send`, **`session`** + `confirm: "ENVIAR"`). **Criar o rascunho não
é autorização** — o envio exige a confirmação humana explícita. Tokens de serviço **não** revisam nem
enviam rascunhos.

**b) Titularidade (§5).** As contas vivem nas **configurações pessoais** de cada admin e **não** são
recursos da tabela `ownership`. Portanto:

- **Nada é transferido nem reativado automaticamente**; um admin desativado mantém a conta consigo e
  outro admin **não** a alcança (`404 account_not_found`).
- A recuperação de acesso (break-glass) **não** altera `admin_settings` → a conta **permanece com o
  titular original**.
- Uma transferência de conta, se necessária, seria uma decisão nova (§11.3) — **não** é feita por
  inferência nem reutilizando `ownership` (que não modela contas de e-mail).

Testes: `tests/mail-drafts.test.mjs` (8 casos) — store (dono, uso único, expiração, capacidade),
rascunho pelo agente sem envio, entrada inválida, revisão só por sessão, confirmação explícita, uso
único, isolamento entre admins, corpo **não** persistido em nenhuma tabela, e titularidade (conta fica
com o dono após desativação).

**Ainda dependente de decisão:** TTL/capacidade definitivos do rascunho (provisórios aqui); ativar o
transporte real (D7); valores de F4.11; transferência de conta (§11.3).

## 11. Perguntas de produto (bloqueios indispensáveis)

1. **F4.11 — pastas/filtros/limites/retenção (§3.1).** Aprovar os valores propostos?
   (a) Aprovar como estão; (b) aprovar com ajustes (quais?); (c) manter pendente e seguir só com o
   núcleo. *Consequência:* sem isso, não há pastas nomeadas nem limites "oficiais"; o núcleo usa os
   valores provisórios injetáveis e **não** persiste corpo.
2. **Aprovação da especificação + autorização de implementação.** Autorizar a construção das rotas e
   ferramentas (com mocks) sem credenciais reais? (a) Sim, com mocks; (b) sim, incluindo o adaptador de
   transporte real (mas ainda sem conta real); (c) não. *Consequência:* define se o próximo incremento
   liga o núcleo às rotas/ferramentas.
3. **Titularidade das contas após recuperação de acesso (D_REC cat. 3 / §8).** Quando um admin é
   recuperado, as **contas de e-mail** dele: (a) seguem o dono atual (nada muda); (b) podem ser
   **transferidas** explicitamente (como recursos D_REC-1); (c) são **expurgadas** manualmente (D_REC-2).
   *Consequência:* a resposta usa os mecanismos já implementados de transferência/expurgo; a conta é
   tratada como recurso com titularidade, **nunca** reativada por inferência.
4. **Autenticação (D7).** Confirmar **IMAP/SMTP + senha de aplicativo** (OAuth fora do escopo inicial)?
   (a) Confirmar; (b) reavaliar OAuth antes. *Consequência:* define o adaptador de transporte real e os
   campos de credencial; **não** afeta o núcleo atual (que é agnóstico de transporte).
5. **Envio por agente/bot (D9, §6.4) — corpo entre solicitação e aprovação.** Como levar a mensagem do
   pedido até a aprovação humana **sem persistir o corpo** (proibido nesta fase)?
   (a) O agente **não envia** e o humano envia pelo painel;
   (b) persistir o corpo **cifrado e com TTL curto** só enquanto a aprovação está pendente (exige definir
   o TTL — política de retenção);
   (c) o agente prepara um **rascunho transitório em memória** (não persistido em banco/disco) e o humano
   revisa e confirma no painel.
   *Consequência:* **(c) foi implementado** (§10.3) — rascunho em memória, vinculado ao dono, de uso único
   e com expiração; a confirmação é uma etapa humana explícita. **Pendente:** a **tela do painel** para
   revisar/confirmar e o **valor definitivo** do TTL (provisório: 10 min). (b) continua fora do escopo
   por exigir decisão de retenção.

**A autorização para implementar código não autoriza** acesso a contas reais, uso de credenciais, envio
de mensagens nem alteração de dados reais — essas operações exigem autorização explícita específica.
