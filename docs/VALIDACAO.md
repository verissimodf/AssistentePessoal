# Validação — release 1.9.1

Atualizado em 2026-10-27 após deploy. Distingue testes automatizados, smoke da imagem implantada e
validação pendente contra provedores externos.

## Verificações da release implantada

| Área | Verificação | Resultado |
| --- | --- | --- |
| Backend | `node --test tests/*.test.mjs` | **657/657 PASS** |
| Migrações v16–v18 | backup, preservação de linhas, ownership, constraints e rollback | **PASS** |
| Fila/scheduler | idempotência, concorrência, atraso em disputa e recovery conservador | **PASS** |
| Retenção | desativada por padrão, isolamento por dono, quarentena, restore e purga | **PASS** |
| OAuth | PKCE/state one-use, segredo cifrado, ownership, disconnect e buscas de metadados | **PASS com mocks** |
| STT API | assinatura/MIME, limite de tamanho, adapter e erros genéricos | **PASS com mocks** |
| STT operacional | whisper.cpp CPU, modelo small e transcrição WAV pública via rede interna | **PASS**, HTTP 200; transcrição de referência reconhecida |
| TTS operacional | Adaptador do Assistente → `xtts-service`, voz `jarvis-ptbr` | **PASS**, HTTP 200, WAV/RIFF de 137.804 bytes; health `modelLoaded=true`, `device=cpu` |
| Segurança da ponte TTS | caminho de amostra fora de `data/voices/` | **PASS**, rejeitado com HTTP 400 `invalid_voice_sample` |
| Frontend | `npm test` | **109/109 PASS** (21 arquivos) |
| Avaliação agêntica | `npm run eval:agents` | **86/86 PASS** em seis cenários offline |
| Tipos | `npx tsc --noEmit` | **sem erros** |
| ESLint/Prettier | ESLint global + Prettier dirigido | **88/88 arquivos rastreados formatados**; lint ainda tem 12 erros não relacionados à formatação (9 `no-explicit-any`, 3 `no-empty`) e 16 avisos (15 `react-refresh`, 1 diretiva de lint não utilizada). `.remember/**` está excluído do lint por ser estado local ignorado pelo Git |
| Build frontend/SSR | `npm run build` | **PASS**; aviso existente de chunk >500 kB e avisos de Vite |
| Docker STT | `docker compose --profile stt build stt` e inicialização | **PASS**, não-root, sem porta publicada, zero reinícios no smoke |
| Compose | `docker compose --profile stt config --quiet` | **PASS** |
| Modelo STT | revisão `5359861c739e955e79d9a303bcbc70fb988958b1` | SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` |

## Evidência do deploy 1.9.1

| Item | Resultado observado |
| --- | --- |
| Commit publicado | `80b3f65c81a53854e8f3dc9776c7c13f27c5732d` em `origin/main` |
| Imagem | `assistente-pessoal:1.9.1`; manifest `sha256:77d96b77d4531182c79456b36d75c621fa1e8d369fb0ac26a384af0093a5100b` |
| Build | `2026-10-27T23:48:20Z`; `commitStatus=Registrado`; schema de build 18 |
| Container | `running`, `healthy`, `restarts=0` |
| Health API | HTTP **200**, versão `1.9.1`, SHA completo esperado, `setupRequired=false`, schema/build `18` |
| Painel | HTTP **200**, HTML servido pela porta interna 8090 |
| Banco | schema **18** mantido; `integrity_check=ok`; `foreign_key_check=0`; não houve migração nesta versão |
| Release image gate | `scripts/verificar-imagem-release.sh`: labels, `build-info`, health e painel **PASS** |
| TTS runtime | adaptador local conectado ao container XTTS existente, dispositivo CPU, modelo carregado após síntese |
| XTTS | imagem preexistente `xtts-service-xtts-service`, health `healthy`, `restarts=0`; não foi reconstruída |
| STT | whisper.cpp permanece ativo na rede interna; smoke HTTP 200 com WAV público |

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
- `npm run lint` global ainda falha em regras fora do formato: nove usos explícitos de `any` em
  `src/lib/bridge.ts`, `src/routes/documentos.tsx` e `src/test/documents-page.test.tsx`, além de três
  blocos `catch` vazios em `src/lib/handsfree.ts`. Os avisos `react-refresh` são preservados. Os
  arquivos Prettier rastreados foram formatados sem mudança intencional de lógica.
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
