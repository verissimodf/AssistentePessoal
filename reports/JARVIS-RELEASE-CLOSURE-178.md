# JARVIS-RELEASE-CLOSURE-178 — Auditoria documental, hardening e integração operacional

**Data:** 2026-10-26
**Repositório:** `/opt/laytech-ai/AssistentePessoal`
**Branch de trabalho:** `chore/jarvis-release-closure-178`
**Veredicto global:** **PASS-WITH-CONDITIONS**
**Produção:** não alterada por esta auditoria (sem deploy, rebuild, restart de aplicação, Nginx,
Cloudflare, DNS, firewall ou credenciais).

---

## 1. Resumo executivo

A release **1.7.8** continua estável em produção: imagem `assistente-pessoal:4ad3ba2`, health
`ok`, `healthy`, `restarts=0`, esquema 12, 11 skills. A documentação foi alinhada ao estado real,
três alertas do Dependabot foram confirmados e corrigidos localmente (`nodemailer@10.1.4`), e um
defeito operacional real foi encontrado e corrigido no backup local (timer falhando por permissão
do script).

O ciclo **não** é declarado `PASS` pleno porque há dependências externas bloqueadas e a correção de
segurança ainda não foi commitada/implantada:

- OpenClaw: endpoint de chat do gateway desabilitado (`404`).
- E-mail real: autenticação IMAP falhou; envio permanece mock.
- Telegram: `getMe` retornou `404` (token inválido/revogado).
- Backup externo/cifrado, RPO/RTO aprovado e restore drill periódico ainda não existem.
- `nodemailer@10.1.4` e a permissão do script de backup estão no working tree, sem commit.

---

## 2. Baseline real (confirmada, não presumida)

| Item | Valor observado |
| --- | --- |
| Branch | `main` antes da auditoria; trabalho local em `chore/jarvis-release-closure-178` |
| HEAD da `main` | `f1965d462c3c30cb9b8d9dbea42f607a8dce2f0d` |
| `origin/main` | sincronizada com a `main` local |
| Tag `v1.7.8` | anotada, aponta para `4ad3ba20a5a6dbccdabe5a8390e45484e1584ce9` |
| `package.json` raiz | `1.7.8` |
| `server/package.json` | era `1.1.0`; alinhado localmente para `1.7.8` |
| Esquema SQLite | **12** (`PRAGMA user_version`) |
| Skills no hub de produção | **11** (4 embutidas + 7 vendorizadas) |
| Imagem em produção | `assistente-pessoal:4ad3ba2` (`sha256:de0017e8…`) |
| Container | `healthy`, `restarts=0` |
| Health | versão 1.7.8, commit `4ad3ba2…`, `commitStatus=Registrado`, schema 12 |
| Backend | **616/616** |
| Frontend | **109/109** (21 arquivos) |
| CI remoto (histórico) | 3/3 PASS (Ubuntu, Windows, container) |
| Segurança HTTP externa | **12 PASS / 0 FAIL / 0 WARN** (reexecutado em 2026-10-26) |
| Banco | `integrity_check=ok`, 1 admin, auditoria 301 |

O `server/package-lock.json` estava com versão raiz `1.0.0` enquanto o `package.json` era `1.1.0`;
foi sincronizado durante a atualização do `nodemailer`.

---

## 3. Matriz documental (Gate A) e alterações

| Caminho | Estado anterior | Ação | Evidência |
| --- | --- | --- | --- |
| `README.md` | v1.7.0, 535+ testes, 250+ skills, health antigo | **reescrito** para 1.7.8, 616/109, 11 skills, topologia real, estado das integrações | links e comandos verificados; build/testes |
| `CHANGELOG.md` | sem entradas 1.7.x | **1.7.8** + seção “Não lançado” para hardening pós-release | diff revisado |
| `HOMOLOGACAO_STATUS.md` | topo 1.7.8, seções antigas misturadas | estado atual, arquitetura, testes, limitações, pendências, referências; seções 1.1.0 marcadas como históricas | histórico preservado |
| `docs/ARQUITETURA.md` | topologia local antiga/127.0.0.1 | topologia Cloudflare→Nginx→container, componentes, confiança, skills, dados, observabilidade | leitura do código/compose/container |
| `docs/CONFIGURACAO.md` | provedores/portas antigos e seção obsoleta (`ENCRYPTION_KEY`, `PORT`) | variáveis reais, providers, OpenClaw, OmniRoute/Headroom, e-mail/Telegram | settings reais + testes |
| `docs/INSTALACAO.md` | v1.7.0, health antigo | v1.7.8, portas/health atuais, nota de produção | leitura |
| `docs/BACKUP-E-RESTAURACAO.md` | procedimento básico | política completa: WAL, `master.key`, cifragem/off-host, retenção, RPO/RTO propostos, alertas, restore drill | script + timer + ensaio local |
| `deploy/BACKUP-RESTORE.md` | schema esperado `5`; timer dito “não instalado” | schema `12`; timer real; link para política; falha `203/EXEC` documentada | `systemctl`, journal |
| `deploy/backup-data.sh` | modo `664` (não executável) | **modo `755`**; backup manual e serviço systemd validados | backup 1.2M íntegro, `integrity_check=ok` |
| `docs/OPERACAO-SLO-E-INCIDENTES.md` | não existia | SLOs propostos, fontes, alertas, runbook e escalonamento | documento novo, sem infra pesada |
| `docs/INDICE.md` | não existia | índice conciso de README/CHANGELOG/arquitetura/segurança/runbooks/homologação/integrações | links validados |
| `INTEGRACOES-LAYTECH.md` | instalação 2026-10-14, OpenClaw 403 | topologia atual, OpenClaw 404, OmniRoute/Headroom, e-mail/Telegram | testes reais de `/models`, chat Headroom, `getMe`, IMAP |
| `reports/JARVIS-AGENT-SKILLS-INTEGRATION-02.md` | HSTS sem nota do template HTTP | nota do guardrail `tests/tls-config.test.mjs` | teste TLS 4/4 |
| `reports/VULNERABILIDADES-2026-10-26.md` | não existia | relatório dos 3 GHSA e correção local | `npm audit` |
| `reports/JARVIS-RELEASE-CLOSURE-178.md` | não existia | este relatório | — |
| `server/package.json` / lock | `1.1.0`/`1.0.0`, nodemailer 10.1.1 | `1.7.8`, nodemailer **10.1.4** exato | `npm audit` 0 |

Documentos históricos (`docs/ENTREGA-*`, `reports/INTEGRATION-01`, `docs/CONTINUIDADE.md`,
`docs/FASE-4-EMAIL.md`) foram preservados; não reescrevi ocorrências/falhas passadas.

---

## 4. Vulnerabilidades (Fase C)

Consulta real via API do GitHub em 2026-10-26. Eram **3 alertas abertos**, todos `nodemailer`
direto, severidade **medium** (CVSS 6.5), corrigidos em **10.1.4**:

| GHSA | Pacote | Instalado | Corrigido | Estado |
| --- | --- | --- | --- | --- |
| GHSA-8c8m-p3m8-cjg8 | `nodemailer` | 10.1.1 | 10.1.4 | corrigido localmente |
| GHSA-m943-m63m-w62w | `nodemailer` | 10.1.1 | 10.1.4 | corrigido localmente |
| GHSA-85x2-q946-cp5h | `nodemailer` | 10.1.1 | 10.1.4 | corrigido localmente |

Foi usada a **primeira versão corrigida** (10.1.4), não a latest (10.2.1), para minimizar mudança.
Nenhum `npm audit fix --force`, nenhum outro pacote atualizado.

```text
antes:  server 1 moderate (nodemailer 10.1.1) | raiz 0
depois: server 0 | raiz 0
```

Testes: `tests/mail*.test.mjs` + `settings-comms-blank` = **93/93**; backend completo **616/616**;
frontend **109/109**; build OK.

**Limitação:** a correção está no working tree, sem commit/push/deploy; os alertas do Dependabot
continuam abertos até a publicação. Detalhes em `reports/VULNERABILIDADES-2026-10-26.md`.

---

## 5. Observabilidade, SLOs e incidentes (Fase D)

Instrumentação existente inspecionada: `/api/health`, `/api/diagnostics`,
`/api/router/telemetry`, Docker healthcheck/`RestartCount`, auditoria, `PRAGMA integrity_check` e
backups. **Não** há Prometheus/Grafana/alertmanager instalados.

Foi criado `docs/OPERACAO-SLO-E-INCIDENTES.md` com SLOs **propostos** (não aprovados), fontes,
fórmulas, janelas, limites de alerta, runbook, escalonamento e higiene de logs. A baseline é
pontual (chat Ollama ~71 s em cold start, Headroom ~6,4 s, health OK), não estatística; os números
devem ser recalibrados antes de virarem compromisso.

---

## 6. Backup e recuperação (Fase E)

### Achado real

O timer `jarvis-data-backup.timer` estava **habilitado**, mas o serviço falhava desde 2026-10-25:

```text
Failed at step EXEC spawning .../deploy/backup-data.sh: Permission denied
Main process exited, code=exited, status=203/EXEC
```

Causa: `deploy/backup-data.sh` estava `664` (sem bit de execução). Correção local: `chmod 755`.

### Validação

- Execução manual: backup em `/opt/laytech-ai/jarvis-data-backups/20261025T225557` com
  `jarvis.db` + `master.key` + `voices/`, `SHA256SUMS.txt` OK, `integrity_check=ok`, schema 12.
- `systemctl --user start jarvis-data-backup.service`: `status=0/SUCCESS`; novo backup
  `20261025T225602`.

### Estratégia documentada

`docs/BACKUP-E-RESTAURACAO.md` cobre WAL, `master.key`, cifragem antes da transferência, destino
externo, retenção, verificação, alertas e restore drill. **RPO 24 h / RTO 2 h são propostas**, não
aprovadas. Backup externo, cifragem e alerta de idade **não** estão implementados. Nada foi
enviado para destino externo nesta auditoria.

---

## 7. OpenClaw (Fase F)

Estado real (sem alterar configuração):

| Item | Resultado |
| --- | --- |
| Integração no J.A.R.V.I.S. | `enabled: true`, `kind: http`, token presente |
| URL | `http://openclaw:18789/v1` |
| `GET /healthz` | **200** |
| `GET /models` | **200** |
| `GET /v1/models` | **404** |
| `POST /v1/chat/completions` | **404** |
| `gateway.http.endpoints` | `null` (chat desabilitado) |
| `gateway.trustedProxies` | `["127.0.0.1/32","::1/128"]` (correto) |
| `auth.mode` | `token` |

O adaptador `server/http-integration.js` já tem allowlist, Bearer do settings, timeout 30 s,
limite de prompt/resposta e auditoria sem conteúdo. **Falta habilitar o endpoint de chat no
gateway**; até lá a integração deve permanecer desabilitada para agentes. Nenhuma ferramenta
remota/shell foi exposta. Estado: **BLOCKED-CONFIGURATION**.

---

## 8. OmniRoute e Headroom (Fase G)

| Componente | Evidência | Estado |
| --- | --- | --- |
| Headroom | `/models` 200 (9), chat sintético 200 (~6,4 s) | **OPERATIONAL** |
| OmniRoute | `/models` 200 (268), `auto/best-coding` presente; chat não reexecutado | **PASS-WITH-CONDITIONS** |
| Hermes | `/models` 200 (1); chat depende de gateway/sessão | **PASS-WITH-CONDITIONS** |
| Ollama | `/models` 200 (9); chat real | **OPERATIONAL** |

OmniRoute e Headroom são **independentes e complementares** (gateway multi-provedor vs. proxy de
contexto). O chat do OmniRoute não foi repetido para evitar consumo externo; logs do gateway
mostram pools `auto/*` vazios em alguns aliases. O fallback local (Ollama) permanece disponível e
não há loops de retry infinito (timeout + circuit breaker no router). Não habilite chamadas pagas
sem confirmar provedores/cota/orçamento.

---

## 9. E-mail e Telegram (Fase H)

| Canal | Configuração | Teste | Estado |
| --- | --- | --- | --- |
| Telegram | token + chatId presentes | `getMe` **404** | **BLOCKED-CONFIGURATION** |
| Gmail | user + appPassword presentes | IMAP **authenticationFailed** | **BLOCKED-CONFIGURATION** |
| Envio de e-mail | `JARVIS_MAIL_TRANSPORT` ausente | não testado | **mock** |
| WhatsApp | não testado | — | **NOT-TESTED** |
| Signal | desabilitado | — | desabilitado |

Nenhuma mensagem real foi enviada. O teste IMAP foi somente leitura; o teste Telegram foi apenas
`getMe` (sem mensagem). Ações necessárias: novo token no @BotFather e correção da senha de
app/permissão IMAP; depois habilitar `JARVIS_MAIL_TRANSPORT=imap` e testar com aprovação humana.

---

## 10. Inventário de artefatos (Fase I) — sem remoção

| Artefato | Tamanho | Classificação | Observação |
| --- | --- | --- | --- |
| `assistente-pessoal:4ad3ba2` (+`latest`) | 2,18 GB | **ativo** | imagem em produção; não remover |
| `crawl4ai-egress:failclosed-69e8afb` | 6,02 GB | **ativo** | usado por `crawl_page`; preservar |
| `nginx:stable` | 242 MB | **ativo** | base do `nginx-app`; preservar |
| Imagens antigas do assistente | — | **ausentes** | não há imagem anterior retida; rollback exige rebuild da tag/commit |
| `/opt/laytech-ai/backups/srv_app_1_volumes_20261019_030001.tar.gz` | 39 GB | histórico/desconhecido | não remover sem verificar conteúdo e autorização |
| `/opt/laytech-ai/backups/site` | 557 MB | histórico | não relacionado ao app; preservar |
| `/opt/laytech-ai/backups/openclaw-pre-20260802-20260902` | 181 MB | rollback histórico | candidato após confirmação |
| Backups JARVIS pequenos (`g9`, `pre-1.7.7`, `pre-1.7.8`, reset) | 36–464 KB cada | rollback/auditoria | preservar |
| `/opt/laytech-ai/jarvis-data-backups/20261025T2255*` | 1,2 MB cada | **novo/ativo** | backups verificados desta auditoria |
| `data/backups` | 8,2 MB, 49 arquivos | histórico de migração | preservar até política de retenção |
| `.output/` | 5,3 MB | build regenerável | candidato a limpeza após build |
| `node_modules/` + `server/node_modules/` | 406 MB + 10 MB | dependências de dev | não remover sem reinstalação |
| `/tmp/opencode/agent-skills-src` | 3,7 MB | temporário | clone upstream; candidato |
| `/tmp/opencode/hub-*`, `hub7-*`, `cand-health*.json` | < 200 KB cada | temporário | candidatos |
| Logs do container | — | operacional | rotação do Docker; não contêm segredos |

Nenhuma remoção foi executada. Não use `docker system prune -a --volumes`.

---

## 11. Validação final (Fase J)

| Verificação | Resultado |
| --- | --- |
| Backend `node --no-warnings --test tests/*.test.mjs` | **616/616** |
| Frontend `npx vitest run` | **109/109** (21 arquivos) |
| Build `npm run build` | **OK** |
| `sha256sum -c skills/.../SHA256SUMS` | **OK** (10 arquivos) |
| `bash -n scripts/container-entrypoint.sh deploy/backup-data.sh` | **OK** |
| `tests/tls-config.test.mjs` | **4/4** |
| `tests/mail*.test.mjs` + `settings-comms-blank` | **93/93** |
| `npm audit` raiz / server | **0 / 0** |
| `git diff --check` | **OK** |
| Links relativos em 36 documentos | **OK** (após criar este relatório) |
| Segredos em docs/relatórios | **0 padrões** (`eyJ`, `jst_`, `jss_`, chave privada, token de bot) |
| `test_jarvis_security.sh` externo | **12 PASS / 0 FAIL / 0 WARN** |
| Health/DB de produção | `ok`, schema 12, `integrity_check=ok` |

O teste de segurança externo gerou eventos de auditoria (`auth.login_failed` etc.) na produção;
nenhum dado de negócio foi alterado.

---

## 12. Estado do Git e da produção

### Git

- Branch de trabalho: `chore/jarvis-release-closure-178`.
- **Nenhum commit, push, merge, tag ou deploy** foi realizado nesta auditoria.
- `main` permanece `f1965d4`; tag `v1.7.8` permanece em `4ad3ba2`.
- Alterações não commitadas: docs, README/CHANGELOG/HOMOLOGACAO, `nodemailer@10.1.4`,
  `server/package.json`/lock, permissão `755` do backup, correção do rascunho Nginx.
- Novos arquivos: `docs/INDICE.md`, `docs/OPERACAO-SLO-E-INCIDENTES.md`,
  `reports/VULNERABILIDADES-2026-10-26.md`, este relatório.

### Produção

| Item | Estado |
| --- | --- |
| Imagem | `assistente-pessoal:4ad3ba2` |
| Digest | `sha256:de0017e8…` |
| Container | `healthy`, `restarts=0` |
| Health | 1.7.8, commit `4ad3ba2…` Registrado, schema 12 |
| Hub | 11 skills, `bundled.commit=aeac41d4…` |
| Banco | `integrity_check=ok`, schema 12, 1 admin |
| Nginx/Cloudflare/DNS/firewall | não tocados nesta auditoria |
| Credenciais | não alteradas/exibidas |

A única escrita operacional foi a criação de backups locais (script manual + serviço systemd) e
eventos de auditoria do teste HTTP; nenhum deploy/reinício de aplicação foi feito.

---

## 13. Pendências e riscos residuais

| Item | Severidade | Estado |
| --- | --- | --- |
| `nodemailer@10.1.4` não commitado/implantado | Alta (segurança) | corrigido local; alertas abertos |
| OpenClaw chat desabilitado | Média | BLOCKED-CONFIGURATION |
| E-mail real/Telegram inválidos | Média | BLOCKED-CONFIGURATION |
| Backup externo/cifrado/off-host ausente | Alta (DR) | não implementado |
| RPO/RTO não aprovados | Média | proposta |
| Sem imagem anterior para rollback imediato | Média | rebuild a partir da tag/commit |
| Sem monitoramento contínuo/SLO aprovado | Média | proposta/documentação |
| Token do `cloudflared` a rotacionar | Média | pendência de segurança anterior |
| HSTS no edge Cloudflare não verificado no painel | Baixa | header externo já presente |
| 3 alertas Dependabot | Média | fecham após commit/deploy |
| Chat OmniRoute não reexecutado | Baixa | evitar custo externo |

---

## 14. Próximo passo recomendado

1. Revisar o diff da branch `chore/jarvis-release-closure-178` (especialmente `nodemailer` e docs).
2. Abrir PR pequeno, rodar CI (backend/frontend/container) e publicar uma release **1.7.9** com o
   `nodemailer@10.1.4` + permissão do backup + documentação.
3. Após deploy, verificar `npm audit` no container e fechar os 3 alertas do Dependabot.
4. Tratar em etapas separadas, com autorização: backup externo cifrado + restore drill; correção
   de Telegram/IMAP; habilitação do endpoint de chat do OpenClaw; orçamento/provedores do
   OmniRoute; rotação do token do `cloudflared`.
5. Só então declarar o ciclo 100% encerrado.
