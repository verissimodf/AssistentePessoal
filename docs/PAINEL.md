# Painel administrativo — novas áreas (P0.1)

> Complementa `docs/EXECUCAO-VERIFICAVEL.md`. Documenta as áreas administrativas adicionadas para
> tornar observável a execução verificável (ledger `execution_evidence`). Nenhuma permissão,
> autonomia ou escopo foi alterado; todas as listagens são **owner-scoped** e só expõem metadados.

## Fonte de verdade por recurso

| Recurso | Fonte de verdade | Endpoint | Autorização | Falha | Teste |
|---|---|---|---|---|---|
| Aprovações do admin | tabela `approvals` + `ownership` | `GET /api/approvals` | `session` + posse | sem sessão → 401; offline → `null` | `tests/execution-evidence.test.mjs` |
| Execuções/evidências | `execution_evidence` + `ownership` | `GET /api/executions` | `session` + posse | 401 / `null` | idem |
| Evidência por aprovação | `execution_evidence` | `GET /api/approvals/:id/evidence` | `session` + posse | 401/404 uniforme | idem |
| Auditoria | tabela `audit` | `GET /api/audit` | `audit:read` | `null` (sem permissão/offline) | `tests/audit-*.test.mjs` |
| Saúde/versão | processo + `PRAGMA user_version` | `GET /api/health`, `GET /api/diagnostics` | público / `session` | `null` | `tests/diagnostics.test.mjs` |
| Metadados de build | `server/build-info.json` (gravado no build) | `GET /api/health`, `GET /api/diagnostics` | público / `session` | `null` | `tests/build-info.test.mjs` |

**Nunca** há dado de demonstração apresentado como real: quando o backend está indisponível, as
listagens retornam `null` e a interface mostra **"Indisponível (offline)"**; ausência de registros é
distinta (lista vazia → "Nenhum registro").

## Áreas da interface

- **Visão geral** (`/visao-geral`): saúde+versão+esquema (release), aprovações pendentes, execuções
  que exigem atenção (falha/interrupção/desconhecido ou verificação não confirmada), atividade
  recente (auditoria) e **última atualização**. O **commit implantado** e a **versão** vêm dos
  metadados de build injetados na imagem (ver abaixo); sem eles a interface mostra *não
  registrado* — o commit nunca é inferido do branch atual.
- **Execuções e evidências** (`/execucoes`): ledger por execução — data, operação, **estado
  técnico**, **código de saída**, **verificação da pós-condição** e **método**, correlação e
  `audit_id`. Estados distintos: concluído / falha / negado / interrompido / desconhecido;
  verificação: verificado / não verificado / indeterminado.

## Pós-condição (Fase 4)

`evidenceFor` (server/tools.js) aplica um verificador **determinístico por contrato**:

| Operação | Pós-condição | Verificador (`verifiedBy`) |
|---|---|---|
| `send_message` | provedor aceitou o envio (HTTP 200) | `http_status` → **verified** |
| `openhands_task` | conversa criada (HTTP 200) | `http_status` → **verified** |
| `rea_analyze` | Evidence gravada | `artifact` → **verified** |
| `run_command` | — (exit 0 é evidência **técnica**, não do objetivo) | `exit_code` → **unverified** |
| demais | sem verificador compatível | `contract_text` → **unknown** |

`verified` só é gravado quando o verificador do contrato confirma o **objetivo**; caso contrário,
mantém-se `unverified`/`unknown`. Nenhum sinal de modelo concede autorização.

## Metadados de build (versão e commit)

O painel exibe a **versão** e o **commit** da árvore de código que foi de fato construída, não do
branch que está no disco. A cadeia é: `--build-arg GIT_SHA=...` → `scripts/write-build-info.mjs` →
`server/build-info.json` → `GET /api/health` (`version`/`commit`/`buildTime`) e
`GET /api/diagnostics` (`versao.app`/`versao.commit`/`versao.buildTime`).

- **Commit**: vem exclusivamente do `--build-arg GIT_SHA`. O serviço não executa `git` — inferir do
  branch atual mentiria sobre a imagem em produção. Sem o argumento, o valor é `unknown` e o painel
  mostra *não registrado*.
- **Versão**: um `--build-arg APP_VERSION` substitui; sem ele, o script cai no manifesto do
  repositório (`package.json`, gravado em `.app-version` durante o build) — reportar a fonte
  versionada não é adivinhar.
- **Label OCI**: a imagem carrega `org.opencontainers.image.revision` e
  `org.opencontainers.image.version` para auditoria via `docker inspect`. O marcador literal
  `sem-build` pode aparecer no label de versão quando nenhum `APP_VERSION` é passado; ele nunca é
  exibido no painel, porque a versão vem do JSON e não do label.
- O compose (`docker-compose.jarvis.yml`) declara esses `build.args` a partir de variáveis de
  ambiente, com `GIT_SHA` vindo do commit em construção.

## Limitações

- Não há verificação de objetivo para comandos de shell arbitrários (só evidência técnica).
- Sem retenção/expurgo do ledger de evidências.
- O "resumo da sessão" (objetivo/next action) não tem campo persistido no backend; a Visão geral
  mostra pendências e atividade reais em vez de inventar um objetivo.
