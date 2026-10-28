# Integrações locais — OpenHands Agent Canvas e Headroom

Atualizado em 2026-10-27 após a atualização dos serviços e a adaptação do cliente local.

## OpenHands Agent Canvas

- Endpoint de rede Docker: `http://openhands:8000`; acesso pelo host: `http://127.0.0.1:8085`.
- A chave de sessão gerada pelo Agent Canvas foi copiada em memória para `OPENHANDS_API_KEY` no
  `.env` raiz. Nenhuma saída, log, documentação ou arquivo versionado contém o valor. O `.env`
  permanece ignorado pelo Git e com modo `0600`.
- O cliente usa `X-Session-API-Key` e envia `workspace`, `agent_settings` e `initial_message`, de
  acordo com o schema local descoberto em `/openapi.json`. O modelo padrão foi alinhado a
  `openai/qwen2.5:7b`, presente no catálogo Ollama/Headroom. Tarefas continuam protegidas pela
  aprovação humana do painel.
- Healthcheck e publicação loopback do container agora verificam a porta unificada 8000 do Agent
  Canvas. O workspace e o estado `/.openhands` continuam em volumes persistentes.
- Verificação: `GET /server_info` autenticado respondeu HTTP 200 depois da recriação do container;
  healthcheck ficou `healthy`; a busca de conversas retornou zero tarefas ativas antes da recriação.
  A suíte `tests/approvals-actions.test.mjs` validou header, payload e que nada é enviado antes da
  aprovação. Nenhuma conversa real foi criada.

## Headroom

- Imagem fixada em `ghcr.io/headroomlabs-ai/headroom:0.42.0` (release estável publicada em
  2026-10-26) e serviço recriado com os volumes/configuração existentes preservados.
- Token do proxy rotacionado após a credencial anterior aparecer em uma saída de diagnóstico. O
  token novo reside apenas em arquivos `.env` locais de modo `0600`: o `.env` raiz do Assistente e
  `/opt/laytech-ai/docker/headroom/.env`. O Compose do Headroom exige o valor por variável, sem
  segredo literal no YAML.
- A integração do Assistente usa `http://headroom:8787/v1`. O Compose passa configuração persistente
  aos processos CLI filhos: `OPENAI_BASE_URL`/`OPENAI_API_KEY` para clientes OpenAI compatíveis,
  `ANTHROPIC_BASE_URL` com header de autenticação do proxy para Claude Code e
  `OPENCODE_CONFIG_CONTENT` para provider Headroom no OpenCode. Credenciais próprias de cada CLI
  continuam sob responsabilidade do respectivo login.
- Verificação de serviço após atualização/rotação: `/health` HTTP 200, `/v1/models` HTTP 200 com
  nove modelos e `chat/completions` HTTP 200 com resposta sintética local. O container ficou
  `healthy` e usa a tag `0.42.0`.
- A configuração do provider `headroom` no painel ainda está desabilitada. Um administrador
  verificado pode ativá-la em Configurações → Provedores para escolher Headroom em conversas do
  Assistente; o fallback de chave vem do ambiente e não grava credencial na base. O adapter e a
  rota estão disponíveis sem alterar essa política de configuração.

## Limites da validação

- A validação HTTP exercitou o proxy OpenAI-compatible local e o endpoint autenticado do Agent
  Canvas. Não executou tarefas autônomas nem chamadas a provedores pagos.
- Claude Code precisa de uma sessão Claude válida para concluir uma chamada; Codex e OpenCode
  precisam de autenticação/provider permitido no ambiente do processo. O deploy apenas configura o
  encaminhamento e não cria nem copia credenciais desses serviços.
- Mudanças no Compose de OpenHands e Headroom vivem nos respectivos diretórios locais de deploy,
  fora deste repositório Git. Os arquivos secretos `.env` não devem ser commitados.
