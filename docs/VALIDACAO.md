# Validação — release 1.9.0

Atualizado em 2026-10-27 após deploy. Distingue testes automatizados, smoke da imagem implantada e
validação pendente contra provedores externos.

## Verificações executadas no candidato

| Área | Verificação | Resultado |
| --- | --- | --- |
| Backend | `node --test tests/*.test.mjs` | **652/652 PASS** |
| Migrações v16–v18 | backup, preservação de linhas, ownership, constraints e rollback | **PASS** |
| Fila/scheduler | idempotência, concorrência, atraso em disputa e recovery conservador | **PASS** |
| Retenção | desativada por padrão, isolamento por dono, quarentena, restore e purga | **PASS** |
| OAuth | PKCE/state one-use, segredo cifrado, ownership, disconnect e buscas de metadados | **PASS com mocks** |
| STT API | assinatura/MIME, limite de tamanho, adapter e erros genéricos | **PASS com mocks** |
| STT operacional | whisper.cpp CPU, modelo small e transcrição WAV pública via rede interna | **PASS**, HTTP 200; transcrição de referência reconhecida |
| Frontend | `npm test` | **109/109 PASS** (21 arquivos) |
| Avaliação agêntica | `npm run eval:agents` | **86/86 PASS** em seis cenários offline |
| Tipos | `npx tsc --noEmit` | **sem erros** |
| ESLint | Execução global e dirigida | **não verde**: dívida de formatação em arquivos legados/minimamente tocados; módulos novos e componentes novos passaram na execução focada; não foi aplicada formatação em massa |
| Build frontend/SSR | `npm run build` | **PASS**; aviso existente de chunk >500 kB e avisos de Vite |
| Docker STT | `docker compose --profile stt build stt` e inicialização | **PASS**, não-root, sem porta publicada, zero reinícios no smoke |
| Compose | `docker compose --profile stt config --quiet` | **PASS** |
| Modelo STT | revisão `5359861c739e955e79d9a303bcbc70fb988958b1` | SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` |

## Evidência do deploy 1.9.0

| Item | Resultado observado |
| --- | --- |
| Commit publicado | `f633fb7e2647357e17e7ea0eda90f8c7215c9b91` em `origin/main` |
| Imagem | `assistente-pessoal:1.9.0`; manifest `sha256:3def0096e45455e05eb776c403e4ca4333007aba9c8c85f89256e50d9526ddf3` |
| Container | `running`, `healthy`, `restarts=0` |
| Health API | HTTP **200**, versão `1.9.0`, SHA completo esperado, `setupRequired=false`, schema/build `18` |
| Painel | HTTP **200**, HTML servido pela porta interna 8090 |
| Migração | schema **15 → 18**; backup verificado `/app/data/backups/jarvis-2026-10-27T23-09-38-162Z-v15.db` |
| SQLite | `integrity_check=ok`; `foreign_key_check=0` |
| STT | Serviço whisper.cpp permanece ativo na rede interna; smoke HTTP 200 com WAV público foi executado antes do deploy principal |

O unit `jarvis.service` estava inativo antes da recriação. O deploy usou Compose com perfil `stt`,
recriou somente `assistente` e manteve o volume persistente. A imagem foi construída em modo release
com `BUILD_VERSION=1.9.0`, SHA publicado, `SCHEMA_VERSION=18` e `RELEASE_BUILD=1`.

## Pendências externas

- **OAuth real: BLOCKED-CONFIGURATION.** `.env` não contém Client ID, Client Secret ou Redirect URI
  para Google nem Microsoft. O cadastro do app, callback HTTPS exato, consentimento e conta de
  teste precisam ser configurados pelo operador. Mocks não provam consentimento, refresh nem envio
  real. O envio continua opcional, com confirmação humana D9.
- O teste STT usou amostra pública em inglês do repositório whisper.cpp, não uma gravação pessoal.
  Qualidade de português, latência em hardware de menor capacidade e experiência real pelo browser
  ficam para validação opt-in do operador.
- `npm run lint` global não está verde devido a milhares de problemas de formatação/legado em
  arquivos alheios a esta entrega, incluindo `.remember/tmp/last-ndc.ts`; o lint focado nos arquivos
  alterados passou. Não foi feita formatação em massa do repositório.
- O build aponta chunk JavaScript acima de 500 kB. Otimizar divisão de bundles requer medição de
  carregamento e fica fora da conclusão funcional desta release.

O smoke STT foi realizado com o servidor Whisper CPU e interface HTTP multipart documentados pelo
[projeto oficial whisper.cpp](https://github.com/ggml-org/whisper.cpp/blob/21ba6d269a02c14309355cb96822db6058d4cf48/examples/server/README.md).

## Segurança e dados

Não foi enviado e-mail real, não foram consultados corpos de e-mail de usuário e nenhuma gravação
pessoal foi usada. Áudios STT são validados e mantidos apenas em memória no serviço da aplicação; o
serviço whisper usa `/tmp` efêmero para conversão. Retenção continua desativada até ativação por
administrador. Backups antigos podem conter memórias até a expiração normal desses backups.
