# Assistente Pessoal (Jarvis) — Integração LayTech

Documento operacional da instalação do **AssistentePessoal**
(`github.com/laytech-ia-debug/AssistentePessoal`) no servidor LayTech, em substituição ao
**OpenJarvis** local. Verificado ao vivo em **2026-10-14**.

## 1. Local e versões

- Código: `/opt/laytech-ai/AssistentePessoal` (branch `main`).
- Node: v22.22.2 · npm 11.19.0 (o ambiente tem `NODE_ENV=production`; use `npm install --include=dev`).
- Dados: `/opt/laytech-ai/AssistentePessoal/data/` (`jarvis.db`, `master.key` modo `600`, `voices/`).
- Build do painel: `NITRO_PRESET=node-server npm run build` → `.output/`.

## 2. Portas e serviços

| Componente | Endereço | Observação |
| --- | --- | --- |
| API local | `http://127.0.0.1:7777` | loopback |
| Painel web | `http://localhost:8090` | **8080 é do `odysseus-searxng-1`** |
| Ponte de voz | `http://127.0.0.1:7778` | traduz `/tts` → `xtts-service` (`8010`) |
| Tailnet (Tailscale) | `http://100.100.100.101:8090` (painel) e `:7777` (API) | só no tailnet; sem LAN |
| MCP (stdio) | `server/mcp.js` | `jarvis_ask`, `jarvis_remember`, `jarvis_recall` |

Serviço systemd **user**: `assistente-pessoal.service` (habilitado, `Linger=yes`), que sobe API +
ponte de voz + painel + relé Tailscale via `scripts/start-local.sh`.

```bash
systemctl --user status assistente-pessoal.service
systemctl --user restart assistente-pessoal.service
journalctl --user -u assistente-pessoal.service -n 50 --no-pager
```

## 3. Provedores de IA (cifrados AES-256-GCM em `data/jarvis.db`)

| Provedor | URL base | Modelo | Teste |
| --- | --- | --- | --- |
| `ollama` (ollama-llm) | `http://127.0.0.1:11434/v1` | `qwen2.5:7b` (embed `nomic-embed-text`) | ✅ 13 modelos |
| `omniroute` | `http://127.0.0.1:20128/v1` | `auto/best-coding` | ✅ 254 modelos |
| `hermes` | `http://127.0.0.1:8642/v1` | `hermes-agent` | ✅ 1 modelo |
| `headroom` | `http://127.0.0.1:8787/v1` | `qwen2.5:7b` | ✅ 13 modelos |
| `openclaw` | `http://127.0.0.1:18789/v1` | — | ⚠️ 403 `proxy_attribution_required` |

## 4. Ferramentas de agente (integrações)

| Ferramenta | Serviço | Endereço | Teste |
| --- | --- | --- | --- |
| `context7_docs` | Context7 MCP (HTTP) | `http://127.0.0.1:8000/mcp` | ✅ retorna docs |
| `crawl_page` | crawl4ai | `http://192.168.2.29:11235` (Bearer) | ✅ markdown |
| `openhands_task` | OpenHands | `http://127.0.0.1:8085` | ✅ cria conversa |
| `cli_agent` | Claude Code / Codex / OpenCode / Hermes | CLIs locais | `opencode run` ✅ |
| `rea_analyze` | REA (`rea-agents@6.5.0` na imagem) | argv fixo, Evidence em `data/rea/` | ✅ (`tests/rea-analyze.test.mjs`) |
| `gigabrain_recall` / `gigabrain_remember` | Gigabrain (`@legendaryvibecoder/gigabrain@0.11.0` na imagem) | MCP stdio, argv fixo, store em `data/gigabrain/` | ✅ (`tests/gigabrain.test.mjs`) |
| `run_command` | Host (ações no host) | — | ✅ (com aprovação) |

Integrações HTTP informativas: OpenClaw, Odysseus, Headroom.

## 5. Agentes

| Agente | Provedor | Modelo | Estado |
| --- | --- | --- | --- |
| `jarvis` (J.A.R.V.I.S.) | `ollama` | `qwen2.5:7b` | **ativo** |
| `omniroute` | `omniroute` | `auto/best-coding` | disponível |
| `hermes` | `hermes` | `hermes-agent` | disponível |
| `headroom` | `headroom` | `qwen2.5:7b` | disponível |

## 6. Ações no host

Habilitadas (`host.enabled = true`) com **lista permitida** e **aprovação no painel** (o chat usa
autonomia `confirm`: o agente propõe o comando e o usuário aprova). Comandos destrutivos
(`rm -rf /`, `mkfs`, `shutdown`, fork bomb…) são sempre recusados por `server/hostpolicy.js`.
Para autonomia total em bots, use `safe` (só a lista permitida) ou `full` (roda tudo, menos perigosos).

## 7. Acesso pela rede privada Tailscale

`scripts/tailnet-proxy.mjs` escuta **apenas no IP Tailscale** (`100.87.104.126`) e encaminha para o
loopback — sem abrir na LAN e sem `sudo`. O `start-local.sh` adiciona o IP e o MagicDNS
(`app.tail43f1fb.ts.net`) a `JARVIS_ALLOWED_ORIGINS`. O painel detecta o serviço pelo hostname da
página (`src/lib/bridge.ts`), então funciona igual em `localhost` e no tailnet.

Abrir de outro dispositivo: **`http://100.100.100.101:8090`** (ou `http://app.tail43f1fb.ts.net:8090`).

Alternativa nativa com TLS (requer `sudo tailscale set --operator=$USER` uma vez):
`tailscale serve --bg --https=443 http://127.0.0.1:8090` e `--https=8443 http://127.0.0.1:7777`.

## 8. Voz clonada (preservada do OpenJarvis)

`scripts/voice-adapter.mjs` (7778) converte `POST /tts` para `POST /voice/speak` (form-urlencoded) do
`xtts-service` (`127.0.0.1:8010`), usando o speaker clonado **`jarvis-ptbr`**. `voice.tts = "xtts"`.
Voz local nativa do projeto (Kokoro/Coqui) não instalada: exige Python 3.10–3.12 (host tem 3.14).

## 9. Substituição do OpenJarvis (reversível)

Parados e **desabilitados**: `jarvis.service`, `jarvis-scheduler.service`, `jarvis-voice.service`,
`jarvis-health.timer`. Mantidos `jarvis-backup.timer` e `jarvis-logrotate.timer` (preservam os dados).
Dados do OpenJarvis intactos em `~/.openjarvis`.

**Rollback:** `bash /opt/laytech-ai/AssistentePessoal-integration-backup-20261014T001749/rollback.sh`

## 10. Limitações conhecidas

- **OpenClaw**: `/v1/*` exige `gateway.trustedProxies` no gateway (403). Só `/healthz` responde.
- **Odysseus** (`127.0.0.1:7000`): app web com login, sem endpoint OpenAI aberto.
- **OpenHands**: a 1ª conversa monta a imagem de runtime (`ghcr.io/all-hands-ai/runtime:...`) **dentro
  do processo do servidor**, que fica sem responder (inclusive `/health`) até terminar — pode levar
  dezenas de minutos. Depois fica rápido. O OpenHands já usa o **headroom** como condenser
  (`http://headroom-internal:8787/v1`). Se travar, reinicie o container `openhands` e tente de novo.
- **Headroom**: exige token (`HEADROOM_PROXY_TOKEN`) para bind em `0.0.0.0`; a porta é publicada só em
  `127.0.0.1`. O `docker-compose.yaml` estava inválido e foi corrigido (backup ao lado).
- **CLI agents**: `claude`/`codex` falham por configuração de modelo do próprio CLI.

## 11. Verificação (2026-10-14)

| # | Item | Resultado |
| --- | --- | --- |
| 1 | Testes do painel / política do host | ✅ 7/7 · 6/6 |
| 2 | `GET /api/health` (loopback e tailnet) | ✅ |
| 3 | Provedores ollama/omniroute/hermes/headroom | ✅ |
| 4 | Chat pelos agentes | ✅ |
| 5 | Memória + recall semântico | ✅ |
| 6 | MCP `jarvis` (OpenCode/Codex/Claude) | ✅ conectado |
| 7 | `context7_docs` / `crawl_page` / `openhands_task` | ✅ |
| 8 | Ações no host (aprovação + bloqueio de destrutivos) | ✅ |
| 9 | Acesso Tailscale (painel + API) | ✅ |
| 10 | Chaves cifradas (`enc:`) e `master.key` 600 | ✅ |
| 11 | Voz clonada (`/api/tts`) | ✅ |
