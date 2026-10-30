# Validação — release 1.9.3

Atualizado em 2026-10-28 para a publicação de 1.9.3. Distingue testes automatizados, smoke de
imagem, validação do deploy e validação pendente contra provedores externos.

## Verificações da release implantada

| Área                   | Verificação                                                                      | Resultado                                                                              |
| ---------------------- | -------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Backend                | `node --no-warnings --test ../tests/*.test.mjs` (via `npm --prefix server test`) | **681/681 PASS**                                                                       |
| Migrações v16–v18      | backup, preservação de linhas, ownership, constraints e rollback                 | **PASS**                                                                               |
| Fila/scheduler         | idempotência, concorrência, atraso em disputa e recovery conservador             | **PASS**                                                                               |
| Retenção               | desativada por padrão, isolamento por dono, quarentena, restore e purga          | **PASS**                                                                               |
| OAuth                  | PKCE/state one-use, segredo cifrado, ownership, disconnect e buscas de metadados | **PASS com mocks**                                                                     |
| STT API                | assinatura/MIME, limite de tamanho, adapter e erros genéricos                    | **PASS com mocks**                                                                     |
| STT operacional        | whisper.cpp CPU, modelo small e transcrição WAV pública via rede interna         | **PASS**, HTTP 200; transcrição de referência reconhecida                              |
| TTS operacional        | Adaptador do Assistente → `xtts-service`, voz `jarvis-ptbr`                      | **PASS**, HTTP 200, WAV/RIFF de 137.804 bytes; health `modelLoaded=true`, `device=cpu` |
| Segurança da ponte TTS | caminho de amostra fora de `data/voices/`                                        | **PASS**, rejeitado com HTTP 400 `invalid_voice_sample`                                |
| Frontend               | `npm test`                                                                       | **110/110 PASS** (22 arquivos)                                                         |
| Avaliação agêntica     | `npm run eval:agents`                                                            | **86/86 PASS** em seis cenários offline                                                |
| Tipos                  | `npx tsc --noEmit`                                                               | **sem erros**                                                                          |
| ESLint/Prettier        | `npm run lint`                                                                   | **PASS**, 0 erros e 0 avisos                                                           |
| Build frontend/SSR     | `npm run build`                                                                  | **PASS**; avisos existentes de chunk >500 kB, Vite e `vite-tsconfig-paths`             |
| Docker STT             | `docker compose --profile stt build stt` e inicialização                         | **PASS**, não-root, sem porta publicada, zero reinícios no smoke                       |
| Compose                | `docker compose --profile stt config --quiet`                                    | **PASS**                                                                               |
| Modelo STT             | revisão `5359861c739e955e79d9a303bcbc70fb988958b1`                               | SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`             |

## Evidência histórica do deploy 1.9.2

| Item               | Resultado observado                                                                                                                                        |
| ------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit publicado   | `02519578f2ea3877949cee67d9bdf9222457945e` em `origin/main`                                                                                                |
| Imagem             | `assistente-pessoal:1.9.2`; ID `sha256:d19178dc4d270bacb6ca1e441baaaa36e94237220b40a3019b132344480602e8`                                                   |
| Build              | `2026-10-28T01:34:21Z`; `commitStatus=Registrado`; schema 18                                                                                               |
| Container          | `running`, `healthy`, reinícios 0                                                                                                                          |
| Health API         | HTTP **200**, versão `1.9.2`, SHA completo esperado, `setupRequired=false`, schema 18                                                                      |
| Painel             | HTTP **200**, servido pela porta interna 8090                                                                                                              |
| Release image gate | labels, `build-info`, health e painel **PASS**                                                                                                             |
| OpenHands          | `GET /server_info` com `X-Session-API-Key` HTTP **200** após recriação; chave persistida bate com a chave gerada sem exibir nenhum valor; health `healthy` |
| Headroom           | imagem `0.42.0`, `/health` **200**, `/v1/models` **200** (9 modelos), chat sintético `qwen2.5:7b` **200**                                                  |
| CLIs               | binários Claude Code, Codex e OpenCode presentes; versões conferidas; roteamento OpenAI, Anthropic e provider OpenCode configurados                        |
| Serviços           | Headroom e OpenHands `healthy`, reinícios 0                                                                                                                |
| Arquivos secretos  | `.env` raiz e `.env` do Headroom modo `0600`; ambos ignorados/não versionados                                                                              |

A chamada real `POST /api/conversations` do Agent Canvas não foi executada; o contrato foi validado
por teste de unidade com servidor stub, enquanto a comunicação local foi validada por endpoint
autenticado de leitura. O fluxo de produção continua protegido por aprovação no painel.

## Candidata de segurança Playwright — 2026-10-28

Validada em projeto Compose separado `jarvis-browser-candidate`; não usa dados nem rede Docker de
produção. Evidência executada:

| Item                                  | Resultado observado                                                                                                                        |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| Imagens candidatas                    | `assistente-pessoal:browser-candidate` e `jarvis-browser-worker:playwright-1.64.1` construídas                                             |
| Browser worker                        | `running/healthy`, usuário `node`, `network_mode=none`, filesystem read-only, capabilities removidas, limite 1 GiB/128 PIDs                |
| Broker egress                         | `running/healthy`, usuário `1001:1000`, filesystem read-only, capabilities removidas, única rede `jarvis-browser-candidate_browser-egress` |
| Socket egress                         | diretório `1001:1000/0710`, socket `1001:1000/0620`; worker mount somente leitura e remoção bloqueada no smoke                             |
| App candidato                         | `running/healthy` na rede `candidate-app` (`internal: true`), sem saída externa                                                            |
| DNS/TCP direto no worker              | **BLOQUEADO** para lookup público e TCP público                                                                                            |
| Destino privado via proxy             | **BLOQUEADO** para `169.254.169.254:80`                                                                                                    |
| Navegação Chromium pública            | **PASS**, `https://example.com/` via broker; operação GET sintética                                                                        |
| Comunicação app → worker              | HTTP **200** em `/health` pelo socket Unix compartilhado                                                                                   |
| Testes focados de navegador           | `node --test tests/browser-tool.test.mjs tests/browser-egress-proxy.test.mjs`                                                              | **33/33 PASS**                                                                               |
| Smoke Playwright/Chromium             | `rtk docker exec jarvis-browser-candidate-browser-worker-1 node /app/scripts/browser-network-smoke.mjs`                                    | **PASS**: mutação de socket, socket de controle, TCP/DNS direto e destino privado bloqueados |
| Healthchecks após recriação candidata | `rtk docker compose -f deploy/browser-candidate/compose.yml ps --all` e GET `/health` no socket pelo app                                   | app, broker e worker **healthy**; socket **HTTP 200**                                        |
| Container ativo                       | permaneceu `assistente-pessoal:1.9.2`, `running/healthy`, na `CNC_APP_PROD_01`; não foi recriado                                           |

O smoke de rede foi executado no worker real. O smoke de integração executou Chromium real no
contexto da aplicação: `https://example.com/` concluiu e uma tentativa para `example.org`, enquanto
o worker recebeu uma allowlist local vazia, foi bloqueada pelo broker (`{"publicPage":"ok","brokerAllowlist":"blocked"}`). O broker registra grants de curta duração pelo socket privado `policy.sock`, inacessível ao worker; diretório `1001:1000/0710`, socket `1001:1000/0620`, e o worker confirmou que não tem esse socket montado. O smoke do worker retornou
`{"egressSocketMutation":"blocked","policyControlIsolation":"blocked","directTcp":"blocked","directDns":"blocked","privateTarget":"blocked"}`.

Validações adicionais do hardening antes da publicação: backend **681/681**, frontend **110/110**,
ESLint sem erros, TypeScript sem erros, build frontend/SSR concluído e os dois Compose
(`browser-candidate` e profile principal) validados. Naquele momento, somente a candidata foi
recriada; o container ativo permaneceu em 1.9.2 e `browser_enabled=false`.

**Estado:** a lacuna de enforcement da allowlist no broker foi fechada e validada na candidata. A
capacidade continua opt-in; a release 1.9.3 foi publicada e implantada conforme a seção seguinte,
sem habilitar a integração em produção.

## Deploy de produção 1.10.0 — 2026-10-30

| Item                | Evidência pós-deploy                                                                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Commit da imagem    | `2a3085f50944aca581c4405b9e8b5b34a4d93cbf` (`main`, `v1.10.0` em `origin/main`)                                                                                                                                                                        |
| Imagem              | `assistente-pessoal:1.10.0`; ID `sha256:bf877ef8623905f4b9265dba8961c585da8fe9cd68e08590aa9ad35982ffa3c3`                                                                                                                                              |
| Build               | `2026-10-30T15:26:24Z`; schema de build 19; `commitStatus=Registrado`                                                                                                                                                                                  |
| Gate de imagem      | `scripts/verificar-imagem-release.sh`: labels, build-info, API health e painel **APROVADOS**                                                                                                                                                           |
| Migração            | **nenhuma** — schema permanece 19; novos dados (`citations`/`reflex`) em `conversation_messages.meta` (JSON livre, v13+)                                                                                                                               |
| Backup externo      | `/opt/laytech-ai/jarvis-data-backups/manual-2026-10-30T12-26-18-792Z-pre-1.10.0`: cópia `VACUUM INTO` verificada pela rotina `backupAndVerify` do próprio servidor + `master.key`; manifesto SHA-256 conferido, diretório `0700`, banco e chave `0600` |
| Container           | `assistente-pessoal:1.10.0`, `running/healthy`, reinícios **0**                                                                                                                                                                                        |
| API e painel        | `/api/health` HTTP **200** com `version 1.10.0`, `commit 2a3085f`, `schema 19`, `setupRequired=false`; painel HTTP **200** via nginx                                                                                                                   |
| Banco após deploy   | schema 19, `integrity_check=ok`, `foreign_key_check=0`; 1 admin preservado                                                                                                                                                                             |
| Novas rotas         | `POST /api/chat/stream` **verificada no choke-point**: sem sessão → `401 {"error":"unauthenticated"}` (NDJSON nunca aberto)                                                                                                                            |
| `/api/chat`         | intocado (formato legado `messages` e fluxo persistente idênticos; fallback do painel)                                                                                                                                                                 |
| Rollback disponível | Imagem anterior `assistente-pessoal:1.9.3` preservada localmente; backup externo acima                                                                                                                                                                 |

O deploy recriou apenas o serviço `assistente` (`up -d --no-build`); os volumes de dados e a rede
persistente foram mantidos. O profile Playwright segue opt-in (`browser_enabled=false`). Streaming
NDJSON usa `x-accel-buffering: no` para atravessar o Nginx sem buffer; o JEV Reflex fica
desligado por padrão (opt-in por administrador em Configurações → Preferências). Evidências são
verificações pontuais de 30/10/2026.

## Deploy de produção 1.9.3 — 2026-10-28

| Item                | Evidência pós-deploy                                                                                                                               |
| ------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Commit da imagem    | `c0d14f4d1abb21333b178cfbf3dd10f856260541` (`main`, publicado em `origin/main`)                                                                    |
| CI                  | GitHub Actions run `40636274764`: jobs Ubuntu, Windows e Container concluídos com sucesso                                                          |
| Imagem              | `assistente-pessoal:1.9.3`; ID `sha256:045258363946c7eda7c72dc20745649b49b9468e9354d2f6fcedfe0fa540f136`                                           |
| Build               | `2026-10-28T05:09:05Z`; schema de build 19; `commitStatus=Registrado`                                                                              |
| Gate de imagem      | `scripts/verificar-imagem-release.sh`: labels, build-info, API health e painel **APROVADOS**                                                       |
| Migração            | v18 → v19 executada; backup verificado automaticamente antes da migração                                                                           |
| Backup externo      | `/opt/laytech-ai/jarvis-data-backups/manual-2026-10-28T05-16-09-253Z-pre-v19`; manifesto SHA-256 conferido, diretório `0700`, banco e chave `0600` |
| Ensaio de migração  | Cópia isolada do backup com rede desabilitada: schema 19, `integrity_check=ok`, zero violações FK e contagens preservadas                          |
| Container           | `assistente-pessoal:1.9.3`, `running/healthy`, reinícios 0                                                                                         |
| API e painel        | `/api/health` HTTP **200**, versão/commit/schema 1.9.3/c0d14f4/schema 19, `setupRequired=false`; painel HTTP **200**                               |
| Banco após deploy   | schema 19, `integrity_check=ok`, `foreign_key_check=0`; 1 admin, 0 approvals, 0 approval actions antes/depois                                      |
| Navegador           | `browser_enabled=false`; serviços do profile `browser` não iniciados                                                                               |
| Rollback disponível | Imagem anterior `assistente-pessoal:1.9.2` preservada localmente; backup pré-v19 acima                                                             |

O deploy recriou apenas o serviço `assistente`; os volumes de dados e a rede persistente foram
mantidos. O profile Playwright segue opt-in. As evidências são verificações pontuais executadas em
28/10/2026, não monitoramento contínuo.

## Histórico do deploy 1.9.1

| Item               | Resultado observado                                                                                            |
| ------------------ | -------------------------------------------------------------------------------------------------------------- |
| Commit publicado   | `80b3f65c81a53854e8f3dc9776c7c13f27c5732d` em `origin/main`                                                    |
| Imagem             | `assistente-pessoal:1.9.1`; manifest `sha256:77d96b77d4531182c79456b36d75c621fa1e8d369fb0ac26a384af0093a5100b` |
| Build              | `2026-10-27T23:48:20Z`; `commitStatus=Registrado`; schema de build 18                                          |
| Container          | `running`, `healthy`, `restarts=0`                                                                             |
| Health API         | HTTP **200**, versão `1.9.1`, SHA completo esperado, `setupRequired=false`, schema/build `18`                  |
| Painel             | HTTP **200**, HTML servido pela porta interna 8090                                                             |
| Banco              | schema **18** mantido; `integrity_check=ok`; `foreign_key_check=0`; não houve migração nesta versão            |
| Release image gate | `scripts/verificar-imagem-release.sh`: labels, `build-info`, health e painel **PASS**                          |
| TTS runtime        | adaptador local conectado ao container XTTS existente, dispositivo CPU, modelo carregado após síntese          |
| XTTS               | imagem preexistente `xtts-service-xtts-service`, health `healthy`, `restarts=0`; não foi reconstruída          |
| STT                | whisper.cpp permanece ativo na rede interna; smoke HTTP 200 com WAV público                                    |

O unit `jarvis.service` estava inativo antes da recriação. O deploy usou Compose com perfil `stt`,
recriou somente `assistente` e manteve o volume persistente. A imagem foi construída em modo release
com `BUILD_VERSION=1.9.1`, SHA publicado, `SCHEMA_VERSION=18` e `RELEASE_BUILD=1`. O backup verificado
da migração anterior v15→v18 continua disponível em
`/app/data/backups/jarvis-2026-10-27T23-09-38-162Z-v15.db`; a release 1.9.1 não alterou o schema.

## Pendências externas

- **OAuth real: BLOCKED-CONFIGURATION.** `.env` não contém Client ID, Client Secret ou Redirect URI
  para Google nem Microsoft. O cadastro do app, callback HTTPS exato, consentimento e conta de
  teste precisam ser configurados pelo operador. Mocks não provam consentimento, refresh nem envio
  real. O envio continua opcional, com confirmação humana D9.
- O teste STT usou amostra pública em inglês do repositório whisper.cpp, não uma gravação pessoal.
  Qualidade de português, latência em hardware de menor capacidade e experiência real pelo browser
  ficam para validação opt-in do operador.
- Lint: os nove usos explícitos de `any` foram substituídos por contratos tipados, os três `catch`
  agora documentam falhas esperadas de SpeechRecognition e as 16 advertências foram eliminadas na
  validação anterior; os arquivos alterados nesta fase também passam no lint.
- OpenHands Agent Canvas e Headroom: estado atualizado e evidências operacionais no documento
  [`INTEGRACOES-AGENT-CANVAS-HEADROOM-2026-10-27.md`](INTEGRACOES-AGENT-CANVAS-HEADROOM-2026-10-27.md).
- `.remember/**` é estado local ignorado pelo Git e excluído explicitamente do ESLint; seu conteúdo
  não foi editado nem adicionado ao repositório.
- O build aponta chunk JavaScript acima de 500 kB. Otimizar divisão de bundles requer medição de
  carregamento e fica fora da conclusão funcional desta release.

O smoke STT foi realizado com o servidor Whisper CPU e interface HTTP multipart documentados pelo
[projeto oficial whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/21ba6d269a02c14309355cb96822db6058d4cf48/examples/server/README.md).

## Segurança e dados

Não foi enviado e-mail real, não foram consultados corpos de e-mail de usuário e nenhuma gravação
pessoal foi usada. Áudios STT são validados e mantidos apenas em memória no serviço da aplicação; o
serviço whisper usa `/tmp` efêmero para conversão. Retenção continua desativada até ativação por
administrador. Backups antigos podem conter memórias até a expiração normal desses backups.
