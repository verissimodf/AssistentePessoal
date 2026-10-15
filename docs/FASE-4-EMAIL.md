# Fase 4 — E-mail (especificação proposta)

**Status: proposta — aguarda aprovação.** Não implementar antes da aprovação. Deriva do Plano Mestre §6
(Fase 4) e da matriz de rastreabilidade F4.1–F4.11 em `docs/CONTINUIDADE.md`.

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
