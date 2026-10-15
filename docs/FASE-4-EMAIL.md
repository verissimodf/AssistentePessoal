# Fase 4 — E-mail (especificação proposta)

**Status: proposta — aguarda aprovação.** Não implementar antes da aprovação. Deriva do Plano Mestre §6
(Fase 4) e da matriz de rastreabilidade F4.1–F4.11 em `docs/CONTINUIDADE.md`.

## 1. Objetivo

Evoluir os conectores de Gmail e Outlook **sem perder** os que já existem (`server/comms.js`), com
implementação separada de **leitura**, **pesquisa**, **envio** e **gestão de conexões**, respeitando as
permissões aprovadas e o isolamento por administrador da Fase 2.

## 2. Decisões adotadas (aprovadas para a especificação)

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
| F4.11 | Pastas, filtros e limites | Definir (ex.: INBOX + pastas nomeadas; limite de N mensagens). |

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

## 7. Riscos

- Prompt injection por conteúdo de e-mail (tratar como **dado não confiável**, como os documentos da Fase 3).
- Vazamento entre administradores se a titularidade não for checada no envio/leitura.
- Exposição de credenciais em logs/auditoria (mitigado por `sanitizeAudit`).
- Bloqueio/limites do provedor (throttling, senhas de app revogadas) — tratar erros e estado da conexão.

## 8. Dependências

- Fase 2 (isolamento e contas por administrador) — **concluída**.
- D_REC (política de recuperação/propriedade) — proposta em `docs/RECUPERACAO.md`; afeta a titularidade
  das contas após recuperação de acesso.

## 9. Pendências a aprovar antes de implementar

- Confirmar **D7** (IMAP/SMTP/TLS + senha de app; OAuth fora), **D9** e **D10**.
- Definir F4.11 (pastas/filtros/limites) e a política de retenção.
- Resolver a pendência D_REC (reatribuição de recursos de administrador desativado).
