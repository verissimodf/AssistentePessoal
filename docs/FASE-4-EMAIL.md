# Fase 4 — E-mail (especificação proposta)

**Status: F4.11 aprovada (2026-10-15, §12); titularidade de contas de e-mail decidida
(2026-10-19, §11.3).** A especificação como documento, D7 e as autorizações operacionais (§13, §14)
seguem pendentes. Deriva do Plano Mestre §6
(Fase 4) e da matriz de rastreabilidade F4.1–F4.11 em `docs/CONTINUIDADE.md`. As partes **independentes**
já iniciadas — **núcleo de e-mail**, **rotas/ferramentas com transporte mockado**, **adaptador IMAP/SMTP
injetável (tecnicamente pronto, não ativado)**, **rascunho para aprovação humana** e **tela de rascunhos
no painel** — estão em §10; o transporte real, sua ativação e desativação estão em §13; o procedimento do
primeiro teste real está em §14; o restante segue bloqueado (§9, §11).

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
| F4.11 | Pastas, filtros, limites e retenção | **Aprovada** (2026-10-15) — valores em §12.1; retenção satisfeita por construção (§12.2). |

### 3.1 F4.11 — Pastas, filtros, limites e retenção (**aprovada**)

**Estado:** **aprovada em 2026-10-15, sem ajustes.** A recomendação conservadora abaixo foi implementada
como os **valores aprovados** de **§12.1**; o registro formal da decisão está em **§12**.

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

**Resolvido:** estes valores **foram aprovados** (§12) e já estão implementados e aplicados por padrão.

> **Atualização (2026-10-15):** os valores foram **aprovados sem ajustes** e estão em **§12.1** —
> inclusive **rate limit** (leitura 30/min, envio 20/h), implementado e aplicado por padrão. **Retenção
> não precisa de decisão**: nada de corpo/metadado de e-mail é persistido (§12.2).

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
- D_REC (política de recuperação/propriedade) — **decidida** para contas de e-mail em 2026-10-19
  (Padrão A + exceção B, §11.3); política em `docs/D_REC.md` e `docs/RECUPERACAO.md`.

## 9. Estado e bloqueadores (o que falta para liberar a implementação)

**D7, D9 e D10 estão adotadas como diretrizes da especificação** (ver §2) — **não** precisam de nova
confirmação para efeito documental. O que permanece **pendente**:

| # | Pendência | Estado | Bloqueia implementação? |
|---|---|---|---|
| 1 | Aprovação da especificação como documento | pendente | **Sim** |
| 2 | Autorização explícita para iniciar a implementação | pendente | **Sim** |
| 3 | F4.11 — pastas, filtros, limites e retenção (§3.1) | **Aprovada** (2026-10-15) — §12 | Não |
| 4 | D_REC — titularidade de contas de e-mail após desativação/recuperação (`docs/D_REC.md`, §11.3) | **Decidida** (2026-10-19) — Padrão A + exceção B | Não (este item); o mecanismo mínimo está implementado |
| 5 | Conta dedicada para testes reais (D10) | a preparar pelo responsável | Não (só testes reais) |
| 6 | Controles de conteúdo não confiável (§6.1) | definidos como critérios de aceite | Não (são a própria implementação) |

**Bloqueio remanescente:** os itens **1 e 2**. A decisão do item 4 (§11.3) autoriza apenas o mecanismo
mínimo de transferência explícita de contas de e-mail; **não** aprova a especificação como um todo nem
autoriza operações reais. A aprovação de F4.11 (item 3) **não** autoriza nenhuma operação real — as
autorizações operacionais são **separadas** e continuam pendentes (§13, §14).

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

**Limites (F4.11) são injetáveis** (`createMailService({ limits })`) e centralizados em `LIMITS` —
**aprovados em §12** (sem ajustes). **Não** há persistência de corpo de mensagem (portanto, nenhuma janela
de retenção a definir).

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

**Ainda dependente de decisão (não implementado):** autenticação no provedor (D7); política de retomada
após falha de envio (§11.5); gestão de conexão persistida (F4.5); pastas nomeadas/regras. F4.11 está
**aprovada** (§12). Nada disso é iniciado sem as respostas da §11 e sem autorização explícita de operação
real.

### 10.2 Incremento 3 — F4.11 (limites explícitos) e D7 (adaptador IMAP/SMTP)

**Estado (2026-10-15):** (a) os **limites de F4.11** foram tornados explícitos e continuam configuráveis
por serviço — **aprovados** em §12; (b) o **adaptador IMAP/SMTP** (D7) foi implementado como interface
injetável — **não** ativado por padrão e **não** conectado a provedor algum.

**a) Limites (F4.11) — aprovados (§12).** Todos vêm de `LIMITS` (`server/mail.js`) e podem ser
sobrescritos por `createMailService({ limits })`:

| Chave | Valor aprovado | Corresponde a (§3.1) |
|---|---|---|
| `defaultPage` | 20 | paginação (default) |
| `maxPage` | 50 | paginação — `limit` ≤ 50 |
| `maxTotal` | 500 | paginação — teto por consulta |
| `maxBody` | 100 000 | tamanho máx. de corpo |
| `maxFilter` | 200 | tamanho máx. de filtro |
| `retries` | 2 | falhas do provedor — retry limitado |
| `timeoutMs` | 8 000 | falhas do provedor — timeout |
| `baseDelayMs` | 250 | backoff exponencial |

O **rate limit** (consulta/min, envio/hora) foi implementado e **aprovado** em §12 (30/min leitura,
20/h envio), por administrador/conta e **por processo**. Também **não** há retenção nem persistência de
corpo.

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

**Ainda dependente de decisão:** ativar o transporte real (D7) e a autenticação no provedor. F4.11 está
**aprovada** (§12).

### 10.3 Incremento 3 — rascunho para aprovação (D9) e titularidade

**Estado (2026-10-15):** o envio por **agente/bot** passou de "recusado" para **rascunho para aprovação
humana**, sem persistir o corpo. Contas permanecem vinculadas ao titular original.

> **Atualização 2026-10-19 — decisão de titularidade:** o Padrão A e a exceção B foram decididos em
> **§11.3**. A descrição de 2026-10-15 abaixo permanece como registro histórico do estado anterior; a
> regra padrão continua sendo **não transferir automaticamente**, e a transferência explícita agora tem
> um mecanismo mínimo implementado.

**a) Rascunho em memória (o "canal temporário seguro").** `server/mail-drafts.js` guarda o rascunho
**somente na memória do processo** (um `Map`) — **nunca** em banco, disco, auditoria ou log. Propriedades:

- **Vínculo ao dono:** `get`/`consume` exigem o mesmo `adminId`; rascunho de outro admin é
  **indistinguível** de inexistente (`404`).
- **Uso único:** `consume` remove o rascunho antes de enviar (sem replay).
- **Expiração e descarte:** TTL aprovado (10 min, configurável) + limite de entradas (200, com descarte
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
  **Atualização 2026-10-19:** a decisão foi tomada em §11.3; a transferência passou a ser uma operação
  explícita (`POST /api/ownership/mail/transfer`), nunca automática, e move a configuração cifrada para
  o destino **desativada** (`enabled=false`, `state="reconnect"`).

Testes: `tests/mail-drafts.test.mjs` (8 casos) — store (dono, uso único, expiração, capacidade),
rascunho pelo agente sem envio, entrada inválida, revisão só por sessão, confirmação explícita, uso
único, isolamento entre admins, corpo **não** persistido em nenhuma tabela, e titularidade (conta fica
com o dono após desativação).

**Ainda dependente de decisão:** política de retomada após falha (§11.5); ativar o transporte real (D7).
A transferência de conta foi decidida (§11.3) e tem mecanismo mínimo testado; a operação real e uma UI
dedicada continuam fora desta entrega. F4.11 está **aprovada** (§12).

### 10.4 Incremento 4 — interface do painel para rascunhos

**Estado (2026-10-15):** tela **E-mail — rascunhos** no painel (`src/routes/rascunhos.tsx`, nav
"E-mail"), limitada ao administrador autenticado (o servidor valida a titularidade em toda chamada).

- **Listagem** (`GET /api/mail/drafts`, `session`): **apenas metadados** dos rascunhos do próprio admin
  (`id`, conta, destinatário, assunto, **estado**, criação, expiração) — **nunca** o corpo.
- **Revisão** (`GET /api/mail/drafts/:id`): mostra remetente/conta, destinatário, assunto e corpo.
  **Abrir/visualizar NÃO é aprovação** — não dispara envio.
- **Cancelar** (`DELETE /api/mail/drafts/:id`): descarta um rascunho **pendente**; o corpo é apagado.
- **Enviar**: exige **confirmação explícita** em duas etapas na tela; a chamada usa o contrato
  `confirm: "ENVIAR"` (`POST /api/mail/drafts/:id/send`, `session` + CSRF).
- **Estados exibidos**: `pendente`, `enviando…`, `enviado`, `falha`, `desconhecido`, `cancelado`,
  `expirado` — conforme o estado real informado pelo servidor. Rascunhos não pendentes não podem ser
  enviados nem cancelados.
- **Sem confiança no cliente**: identidade, titularidade e estado são decididos no servidor; rascunho de
  outro admin é **indistinguível** de inexistente (`404`). CSRF é exigido nas rotas mutantes.
- **Sem persistência**: o corpo continua **só na memória do processo**; nada em banco, disco, log ou
  auditoria (verificado por teste que varre todas as tabelas).

**Semântica de envio (consumo antes do envio) — proteção contra replay, sem reenvio cego.** O rascunho é
**reivindicado** (pending → `sending`, corpo entregue ao transporte e apagado da memória) **antes** da
tentativa de envio; depois o desfecho é gravado. Uma segunda confirmação **nunca** reenvia (`404`).

- **Envio nunca é repetido** (`retries: 0` na rota de envio): repetir após uma falha ambígua poderia
  **entregar a mensagem duas vezes**. Leitura/pesquisa continuam com retry limitado.
- **Desfecho classificado** (`classifySendError`): `sent` (o provedor aceitou), `failed` (**provadamente
  não transmitida** — DNS/recusa de conexão/TLS/autenticação, antes de a mensagem ser entregue ao
  servidor) ou `unknown` (**ambíguo** — timeout/reset depois da tentativa: a mensagem **pode** ter saído).
- **`unknown` nunca vira reenvio:** o painel mostra "Resultado desconhecido" e explica que a mensagem pode
  ter sido entregue; **não** oferece reenviar. Só criar um **novo** rascunho permite tentar de novo.
- **Limitação (proposital):** o corpo **não existe** depois da tentativa (consumo único), então uma falha
  `failed`/`unknown` exige criar outro rascunho. **Não** prometemos entrega exatamente uma vez (o provedor
  não a garante): o modelo é **no máximo uma tentativa por rascunho**, com desfecho explícito e sem
  reenvio cego. Alternativa proposta (decisão pendente): persistir um rascunho **cifrado com TTL curto**
  apenas enquanto pendente, para permitir retomada — exige política de retenção (§11.5).

Testes do painel: `src/test/drafts.test.tsx` (6 casos) — listagem com estados, abrir ≠ aprovar,
confirmação explícita com `confirm: "ENVIAR"`, não pendente sem ações, **resultado desconhecido sem
reenvio**, cancelamento. Backend: `tests/mail-drafts.test.mjs` (18 casos) — inclui listagem por
titularidade, cancelamento, expiração, CSRF, **falha ambígua → `unknown` sem replay**, **falha
determinística → `failed`**, **envio nunca repetido**, ausência de vazamento.

**Ainda dependente de decisão:** política de retenção para retomada após falha (§11.5); TTL/capacidade
definitivos; ativar o transporte real (D7). A transferência de conta está decidida (§11.3) e tem API
mínima; uma UI dedicada para essa operação é follow-up opcional. F4.11 está **aprovada** (§12).

## 11. Decisões de produto e autorizações operacionais (separadas)

As **decisões de produto** (itens 1–5) são separadas das **autorizações operacionais** (ao final desta
seção). Aprovar uma decisão de produto **não** concede nenhuma autorização operacional.

1. **F4.11 — pastas/filtros/limites/retenção (§3.1, §12) — DECIDIDA.** **Aprovada em 2026-10-15, sem
   ajustes**: valem os valores de **§12.1** e a política de retenção de **§12.2**. Registro da decisão em
   **§12**. Isto é uma **decisão de produto** e **não** autoriza nenhuma operação real — as autorizações
   **operacionais** (D7, primeira conexão, envio, escopo adicional) são **separadas** e continuam
   pendentes (§13, §14).
2. **Aprovação da especificação + autorização de implementação.** Autorizar a construção das rotas e
   ferramentas (com mocks) sem credenciais reais? (a) Sim, com mocks; (b) sim, incluindo o adaptador de
   transporte real (mas ainda sem conta real); (c) não. *Consequência:* define se o próximo incremento
   liga o núcleo às rotas/ferramentas.
3. **Titularidade das contas após recuperação de acesso (D_REC cat. 3 / §8) — DECIDIDA
   (2026-10-19).** Quando um admin é recuperado, as **contas de e-mail** dele: (a) seguem o dono atual
   (nada muda); (b) podem ser **transferidas** explicitamente (como recursos D_REC-1); (c) são
   **expurgadas** manualmente (D_REC-2). *Consequência:* a resposta usa os mecanismos já implementados
   de transferência/expurgo; a conta é tratada como recurso com titularidade, **nunca** reativada por
   inferência. **Decisão:** adotar **(a) como padrão** e **(b) como exceção** — detalhes, escopo e
   limites em **§11.3**. A decisão é de produto; **não** autoriza conta real, transporte IMAP/SMTP nem
   envio real.
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
   *Consequência:* **(c) foi implementado** (§10.3 + §10.4) — rascunho em memória, vinculado ao dono, de
   uso único, com expiração (**TTL aprovado: 10 min**, §12.1), **e a tela do painel** para
   revisar/confirmar/cancelar. **Pendente:** a política de **retomada após falha** (hoje: no máximo uma
   tentativa por rascunho, sem reter o corpo). (b) continua fora do escopo por exigir
   decisão de retenção.

### 11.3 Titularidade das contas de e-mail — **decidida (2026-10-19)**

**Decisão de produto.** Aplica-se a contas de e-mail (Gmail/Outlook) armazenadas em `admin_settings`.
Não altera as decisões de D7, F4.11 nem as autorizações operacionais. **Autorização desta entrega:** o
responsável autorizou explicitamente a implementação e os testes **deste item** (2026-10-19); isso não
concede a autorização geral do item 2 nem qualquer autorização operacional.

**A — padrão (manter com o titular original).** Após desativação ou recuperação de acesso, a conta
permanece vinculada ao administrador original. **Não** há transferência, reivindicação, reativação ou
redistribuição automática:

- a desativação (`removeAdmin`) não altera `admin_settings`;
- a recuperação break-glass (`server/recuperar-acesso.js`) não altera `admin_settings`;
- outro administrador continua vendo `404 account_not_found` (conta alheia e inexistente são
  indistinguíveis).

**B — exceção (transferência explícita e auditada).** Uma conta pode ser movida somente por operação
explícita, com todos os controles abaixo:

| Controle | Regra implementada |
|---|---|
| Autorização | Rota `session` (token de serviço recusado) + **reautenticação recente** vinculada à sessão (D_REC-3) + confirmação literal `TRANSFERIR CONTA` |
| Escopo | **Uma** conta por operação, limitada a `gmail` ou `outlook`; origem **inativa**, destino **ativo** e distinto |
| Titularidade | A conta é procurada **somente** no `admin_settings` da origem; se não existir, `404 account_not_found` |
| Conflito | Se o destino já possui a mesma conta, `409 target_account_exists`; **não** há sobrescrita nem merge |
| Atomicidade/concorrência | `BEGIN IMMEDIATE`: mover a configuração cifrada e removê-la da origem no mesmo commit; repetição concorrente não duplica |
| Auditoria | `audit('mail.account_transferred')` + trilha append-only `ownership_history` (`resource_type='mail_account'`) com `account`, `fromAdmin`, `toAdmin`, `by` e `correlation`; **nunca** usuário, senha, corpo ou conteúdo |
| Não reativação | A cópia no destino é gravada com `enabled=false` e `state="reconnect"`; o destino precisa validar/habilitar explicitamente |

**Contrato:** `POST /api/ownership/mail/transfer` com
`{ from, to, account, confirm: "TRANSFERIR CONTA" }`. A resposta contém apenas `ok`, `account`, `from`,
`to` e `correlation`. A implementação está em `server/settings.js::transferMailAccount` e em
`server/index.js`; os testes estão em `tests/mail-ownership.test.mjs`.

**Limites e follow-ups:** a API é o contrato; **não** há UI dedicada. A transferência move a configuração
cifrada, mas **não** conecta a conta, **não** ativa `JARVIS_MAIL_TRANSPORT=imap`, **não** envia mensagens
e **não** reativa credenciais. Qualquer operação sobre conta real continua dependendo das autorizações
O1–O4 (§13, §14). A descoberta de contas de administradores inativos para uma UI é follow-up; o inventário
`GET /api/ownership/inactive` continua restrito aos tipos de `ownership`.

**A autorização para implementar código não autoriza** acesso a contas reais, uso de credenciais, envio
de mensagens nem alteração de dados reais — essas operações exigem autorização explícita específica.

### Autorizações operacionais pendentes (separadas das decisões de produto)

Estas **não** são decisões de produto e **não** foram concedidas. Cada uma exige autorização **explícita,
específica** (operador + escopo):

| # | Autorização | Estado |
|---|---|---|
| O1 | **D7** — ativar o transporte IMAP/SMTP real (`JARVIS_MAIL_TRANSPORT=imap`) no ambiente designado | **pendente** |
| O2 | **Primeira conexão** — conectar a **conta de teste dedicada** e executar **apenas** o passo 1 (leitura + titularidade, §14.2) | **pendente** |
| O3 | **Envio real** — autorização **independente** para **uma** mensagem de teste, com conta remetente e destino **controlados e previamente definidos** (§14.3) | **pendente** |
| O4 | **Escopo adicional** — qualquer outra conta, destinatário ou operação | **pendente** (autorização própria) |

> A aprovação de F4.11 (§12) **não** concede nenhuma destas autorizações; `JARVIS_MAIL_TRANSPORT` continua
> desligado por padrão.

## 12. Política operacional consolidada (F4.11) — **aprovada**

**Estado (2026-10-15):** **F4.11 aprovada, sem ajustes.** Os valores de **§12.1** e a política de retenção
de **§12.2** estão implementados em `LIMITS` (`server/mail.js`) e nos defaults do store de rascunhos, e
**aplicados por padrão**. Ajustar qualquer valor = trocar uma constante (ou passar
`createMailService({ limits })`).

### Registro da decisão — F4.11 aprovada (2026-10-15)

| Campo | Conteúdo |
|---|---|
| **Data** | 2026-10-15 |
| **Escopo** | F4.11 — pastas, filtros, limites e retenção (§3.1), **sem ajustes** |
| **Decisão** | Aprovar os valores de **§12.1** e a política de retenção de **§12.2** |
| **Valores aprovados** | paginação 20 / 50 / 500 · corpo 100 000 B · filtro 200 · timeout 8 000 ms · retries leitura 2, envio **0** · backoff 250 ms · rate limit leitura **30/min**, envio **20/h** · TTL rascunho 10 min · TTL desfecho 5 min · capacidade 200 |
| **Justificativa** | valores conservadores, já implementados e testados; protegem memória, tempo de resposta, o provedor e a privacidade; a retenção é satisfeita **por construção** (§12.2) |
| **Limites conhecidos** | rate limit é **por (administrador, conta)** e **por processo** — **sem coordenação entre múltiplas instâncias**; pastas nomeadas/regras fora de escopo; envio é **no máximo 1 tentativa por rascunho** |
| **Não autoriza** | ativar o transporte real (D7), conectar contas, enviar mensagens ou ampliar escopo — cada uma exige autorização **operacional própria** (§13, §14) |

> **Decisão de produto ≠ autorização operacional.** A aprovação de F4.11 **não** libera nenhuma operação
> real: `JARVIS_MAIL_TRANSPORT` continua desligado por padrão e as autorizações de §14 seguem pendentes.

### 12.1 Limites

| Parâmetro | Valor | Chave | Justificativa | Impacto operacional |
|---|---|---|---|---|
| Paginação — padrão | 20 | `defaultPage` | leitura típica de caixa | resposta pequena por padrão |
| Paginação — máximo | 50 | `maxPage` | protege memória/tempo (§3.1) | acima disso o servidor corta |
| Teto por consulta | 500 | `maxTotal` | limita varredura profunda (§3.1) | teto duro |
| Corpo no envio | 100 000 bytes | `maxBody` | cobre e-mail normal sem anexo | acima → `413` |
| Filtro de busca | 200 caracteres | `maxFilter` | evita padrão abusivo | acima → `400` |
| Timeout por tentativa | 8 000 ms | `timeoutMs` | provedor lento ainda responde | 8 s e desiste |
| Retries (leitura/pesquisa) | 2 | `retries` | falhas transitórias de rede | até 3 tentativas |
| Retries (envio) | **0** | (fixo no envio) | **evitar entrega dupla** | **1 tentativa por rascunho** |
| Backoff base | 250 ms | `baseDelayMs` | alívio do provedor | 250/500/1000 ms |
| Rate limit — leitura | 30/min | `readPerMin` | evita throttling (§3.1) | `429` + `retryAfter` |
| Rate limit — envio | 20/hora | `sendPerHour` | evita spam/bloqueio (§3.1) | `429` + `retryAfter` |
| TTL do rascunho (aprovado) | 10 min | `ttlMs` | janela de revisão humana | expira → `expirado` |
| TTL do desfecho | 5 min | `outcomeTtlMs` | mostrar `sent`/`failed`/`unknown` | some depois |
| Capacidade de rascunhos | 200 | `max` | limita memória | descarta o mais antigo |

O rate limit é por **(administrador, conta)** e por tipo (`read`/`send`), com janela deslizante em
memória, e é **por processo**: instâncias distintas **não** compartilham contadores. `429` traz `retryAfter` (segundos) no corpo e no cabeçalho `retry-after`. Um envio bloqueado
por rate limit **não consome** o rascunho (verificação antecipada).

### 12.2 Retenção — inventário (o que existe e o que é mantido)

| Dado | Onde vive | Retenção | Observação |
|---|---|---|---|
| Corpo do rascunho | **memória do processo** | só enquanto `pending` (≤ 10 min) | nunca em banco/disco/log/auditoria; apagado em transição terminal |
| Corpo de mensagem lida | memória (resposta HTTP) | não persiste | sanitizado a cada chamada |
| Metadados de mensagem | memória (resposta HTTP) | não persiste | não há tabela de e-mail |
| Estado de conexão (F4.5) | — | não persistido | gestão de conexão ainda pendente |
| Credenciais | `admin_settings` (cifradas) | enquanto a conta existir | AES-256-GCM; nunca devolvidas |
| Eventos de auditoria | tabela `audit` | política existente do projeto | só `kind` + metadados sanitizados |

**Conclusão:** F4.11 pede "**não** persistir corpo; no máximo metadados com TTL curto". O sistema **não
persiste corpo nem metadados de e-mail** — portanto **não há política de retenção a definir**: a linha de
retenção de F4.11 está satisfeita **por construção**. A única persistência relacionada são as
**credenciais** (já cifradas, governadas por `settings.js`) e a **auditoria** (governada pela allowlist).

### 12.3 O que continua fora (não implementado)

- **Pastas nomeadas / regras**: apenas `INBOX` (a busca usa a caixa de entrada). Pastas são escopo futuro.
- **Ativar o transporte real (D7)** e conectar contas — depende de decisão e de credenciais do operador.
- **Retomada após falha de envio** (rascunho cifrado com TTL curto) — exige política própria (§11.5).

## 13. Transporte real IMAP/SMTP (D7): prontidão, configuração e desativação

**Estado (2026-10-15):** o adaptador está **tecnicamente pronto e revisado**. Isto **não** é autorização
nem ativação: o **padrão continua o mock** e **nenhuma conta foi conectada** nesta execução.

> **Distinção explícita:** "adaptador tecnicamente pronto" ≠ "transporte real autorizado e ativado".

### 13.1 Revisão de segurança (achados e correções)

| Item | Achado | Correção |
|---|---|---|
| TLS / certificados | `secure`/`requireTLS` estavam corretos, mas a validação de certificado era **implícita** | `tls: { rejectUnauthorized: true, minVersion: "TLSv1.2" }` **explícito** em IMAP e SMTP |
| Encerramento de conexões | `connect()` ficava **fora** do `try/finally`: uma falha de conexão **vazava o socket** | `connect()` dentro do `try`; `finally` faz `logout()` e, se falhar, `close()`; o transporte SMTP é sempre fechado |
| Timeout | Aplicado pelo **núcleo** (8 s por tentativa), não pelo adaptador | Mantido: um lugar só, com retry limitado na leitura |
| Erros | O adaptador **lança** o erro do provedor | O núcleo converte em `502 provider_error` **genérico** e audita sem conteúdo |
| Segredos | `auth` só entra nas opções do cliente | Nunca em erro, resposta, log ou auditoria (testado) |
| Destinatários | Vêm do cliente | `validateOutgoing` valida o endereço (CRLF reprovado); `from` é **sempre** a conta do admin, nunca do cliente |
| Aprovação humana | Envio manual é `session` + `confirm: "ENVIAR"`; agente/bot só **cria rascunho** | Sem caminho de envio direto por agente/bot |
| Ativação | O adaptador **não era ligado a nada** (nem por engano, nem de propósito) | Opt-in **explícito** e **server-side** (§13.2) |

### 13.2 Configuração e ativação (server-side, explícita)

- **Chave:** `JARVIS_MAIL_TRANSPORT` (variável de ambiente do **servidor**).
- **Ativa o real:** **somente** o valor exato `imap`.
- **Mantém o mock:** ausente, vazio, outro valor ou caixa diferente (`IMAP`) — **nunca** ativa por engano.
- **Nunca** é lida de requisição, cabeçalho ou configuração do cliente.

```bash
# ativar (após a decisão D7 e com contas configuradas)
JARVIS_MAIL_TRANSPORT=imap node --no-warnings server/index.js

# desativar (volta ao mock)
unset JARVIS_MAIL_TRANSPORT     # ou: JARVIS_MAIL_TRANSPORT=mock
```

**Pré-requisitos para ativar:**
1. Decisão **D7** aprovada (§11.4).
2. Conta(s) Gmail/Outlook configuradas em **Configurações → Comunicação**, com **senha de aplicativo**
   (cifradas em `admin_settings`).
3. Saída de rede para `imap.gmail.com:993` / `smtp.gmail.com:587` (ou os hosts do Outlook).
4. Aceite de que o envio é **no máximo uma tentativa por rascunho** e que o resultado pode ser `unknown`.

### 13.3 Riscos residuais

- **Provedor não garante entrega exatamente uma vez**; um resultado `unknown` pode significar mensagem
  entregue — por isso não há reenvio automático.
- O adaptador foi validado com **clientes falsos** (contrato), não contra um servidor real: o
  comportamento de um provedor específico (pastas, limites, mensagens de erro) só se confirma no uso real.
- Rate limit é **por processo** (em memória); múltiplas instâncias não compartilham contadores.
- `dotenv` está nas dependências do servidor mas **não é usado** (pendência de limpeza).

### 13.4 Desativação imediata (kill switch)

1. **Desligar o transporte:** remover a variável e reiniciar o serviço — `unset JARVIS_MAIL_TRANSPORT`
   (ou `JARVIS_MAIL_TRANSPORT=mock`). A próxima chamada já usa o mock; nada a limpar no servidor.
2. **Se a conta estiver comprometida:** revogar a **senha de aplicativo no provedor** e apagar o campo em
   Configurações → Comunicação (o valor cifrado deixa de valer). Sessões/tokens não são afetados.
3. **Rascunhos:** vivem só em memória — reiniciar o serviço os descarta; **não** há corpo persistido para
   expurgar.
4. **Auditoria:** permanece (é o registro de que a operação ocorreu); contém apenas metadados sanitizados.

## 14. Procedimento do primeiro teste real (conta dedicada)

**Isto é um procedimento, não uma autorização.** A execução exige autorização **explícita e específica**
(§11.4) e uma conta de **teste dedicada**. Nada aqui foi executado.

### 14.1 Pré-condições

1. Autorização registrada para **a operação e o escopo** (D7), não uma autorização genérica.
2. Conta de **teste dedicada** (Gmail/Outlook) — **nunca** credenciais de produção.
3. Senha de aplicativo criada **no provedor** e entregue por **canal seguro** — nunca em chat, terminal,
   log, relatório ou neste repositório.
4. **Destino de teste controlado** (caixa do próprio operador) — nunca terceiros.
5. Transporte ligado **apenas** no ambiente de teste: `JARVIS_MAIL_TRANSPORT=imap`.
6. A conta de teste configurada para **um único** administrador (dono).

### 14.2 Passo 1 — leitura e titularidade (sem envio)

- `GET /api/mail/accounts` → a conta aparece para o dono, com endereço **mascarado** e `hasPassword: true`.
- `GET /api/mail/<conta>/messages` → leitura real; conferir que o corpo volta **sanitizado** (texto).
- **Titularidade:** um segundo admin **não** vê a conta (`404 account_not_found`).
- **Sucesso:** leitura ok + isolamento confirmado.
- **Interromper se:** vazamento entre admins, markup no corpo, ou credencial em resposta/auditoria.

### 14.3 Passo 2 — envio (somente após autorização específica)

- `send_email` por agente/bot → cria **rascunho**; nada é enviado.
- Revisar no painel (E-mail) e confirmar com `ENVIAR` — **uma** tentativa, sem retry.
- **Destino:** apenas a caixa de teste controlada.
- **`sent`:** chegou ao destino de teste.
- **`failed`:** não saiu; recriar o rascunho se quiser tentar de novo.
- **`unknown`:** **não** reenviar automaticamente; conferir a caixa de destino antes de qualquer nova
  tentativa (pode ter sido entregue).
- **Interromper se:** envio para destino não previsto, ou resultado `unknown` → §13.4.

### 14.4 Nunca

- Reutilizar credenciais de produção.
- Imprimir/registrar senhas (terminal, log, relatório, PR).
- Ampliar o escopo (outra conta, outro destino) sem **nova** autorização.

### 14.5 Registro do resultado

Registrar apenas: data, conta (**mascarada**), passo, resultado (`sent`/`failed`/`unknown`) e se houve
interrupção. **Nunca** o corpo, a senha ou o endereço completo do destinatário.
