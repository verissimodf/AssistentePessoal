# Operação: fila durável, STT, OAuth e retenção

Este documento descreve as quatro capacidades introduzidas nas migrações SQLite v16–v18. A implantação é local; integrações OAuth só acessam o provedor externo após configuração explícita.

## Fila durável e scheduler

Disparos `daily`, `interval` e `file` são gravados em `durable_jobs` antes da execução. O payload é cifrado, cada job tem uma chave idempotente e ownership explícito. `GET /api/jobs` lista apenas os jobs do administrador autenticado.

No boot, jobs `running` sem `run_id` voltam a `queued`. Quando já existe `run_id`, a execução fica em `needs_reconciliation`, pois pode ter ocorrido efeito externo; não é repetida automaticamente. Confira a execução associada e só então crie um novo disparo. Falhas terminais não têm retry automático.

## Retenção de memória

Retenção começa desativada por administrador. Em **Memória → Retenção**, simule os registros afetados, reautentique, confirme `ATIVAR_RETENCAO` e escolha 30, 90, 180 ou 365 dias. Os itens vencidos são ocultados da busca/exportação e ficam em quarentena por 30 dias; podem ser restaurados durante esse prazo. A purga roda em lotes limitados. Backups anteriores podem continuar contendo os dados até expirarem segundo a política de backup local.

## E-mail OAuth

Configure no `.env` os Client ID, Client Secret e Redirect URI das aplicações OAuth do Google e/ou Microsoft (ver tabela no README). Redirect URI deve coincidir exatamente com o callback público. Google precisa consentimento offline para refresh token. Microsoft deve habilitar fluxo de código de autorização e consentimento dos escopos delegados solicitados. Reinicie o serviço após alterar `.env`, abra **Configurações → Comunicações → Conexões OAuth**, reautentique e inicie o vínculo.

O callback é público somente para receber `state` e código de uso único; `state` tem validade curta e PKCE. Refresh tokens ficam cifrados em SQLite e vinculados ao proprietário. Envio segue confirmação manual D9 e aprovação do destinatário. `includeSend` solicita escopo de envio opcional; leitura não busca corpo até pedido explícito. Sem credenciais de app, a conexão não pode ser validada contra o provedor.

## STT local (opt-in)

O painel permanece no motor do navegador por padrão. O modelo small validado vem de `ggerganov/whisper.cpp`, revisão imutável `5359861c739e955e79d9a303bcbc70fb988958b1`; SHA-256 `1be3a9b2063867b937e64e2ec7483364a79917e157fa98c5d94b5c1fffea987b`. Guarde-o como `data/whisper-models/ggml-small.bin`; o diretório é montado read-only. Depois valide a configuração e suba o profile:

```sh
docker compose -f docker-compose.yml --profile stt config
docker compose -f docker-compose.yml --profile stt up -d --build assistente stt
docker compose -f docker-compose.yml --profile stt ps
```

Selecione **Configurações → Voz → Transcrição local**. O áudio é limitado a 15 MiB, enviado em memória ao serviço interno, não gravado em disco, limitado a 12 pedidos/minuto/admin e a uma inferência concorrente. O STT não publica porta no host, usa CPU e modelo local. O limite de fala por requisição é 20 s. Para desativar, selecione navegador e pare o serviço `stt`.

## Recuperação e validação

As migrações fazem backup verificado antes de mudar schema. Antes de restaurar, pare o serviço e recupere em conjunto banco, `master.key` e backups necessários; siga [`RECUPERACAO.md`](RECUPERACAO.md). Testes automatizados cobrem ownership, idempotência, recovery seguro, quarentena, state/PKCE e validação de áudio. Não substituem OAuth real nem validação de qualidade com amostra de voz consentida.
