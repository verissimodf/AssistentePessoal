# Validação — release 1.9.0

Atualizado em 2026-10-27. Distingue testes do candidato, smoke local do serviço STT e validação
pendente contra provedores externos ou após deploy da imagem principal.

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
| ESLint dos arquivos alterados | ESLint dirigido aos arquivos da entrega | **sem issues** |
| Build frontend/SSR | `npm run build` | **PASS**; aviso existente de chunk >500 kB e avisos de Vite |
| Docker STT | `docker compose --profile stt build stt` e inicialização | **PASS**, não-root, sem porta publicada, zero reinícios no smoke |
| Compose | `docker compose --profile stt config --quiet` | **PASS** |
| Modelo STT | revisão `5359861c739e955e79d9a303bcbc70fb988958b1` | SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b` |

## Pendências externas e de release

- **OAuth real: BLOCKED-CONFIGURATION.** `.env` não contém Client ID, Client Secret ou Redirect URI
  para Google nem Microsoft. O cadastro do app, callback HTTPS exato, consentimento e conta de
  teste precisam ser configurados pelo operador. Mocks não provam consentimento, refresh nem envio
  real. O envio continua opcional, com confirmação humana D9.
- O container principal em produção ainda precisa receber a imagem 1.9.0 e executar as migrações
  com backup automático verificado. Atualizar aqui health, versão, schema, SHA, integridade, backup,
  smoke da API/painel e contagem de reinícios após concluir o deploy.
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
