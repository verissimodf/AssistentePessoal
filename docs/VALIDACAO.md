# Validação

| Item | Como verificar | Estado |
|---|---|---|
| Testes de palmas e palavra de ativação | `npx vitest run` | 7/7 OK (2 arquivos) |
| Política de comandos do host | `node --test tests/hostpolicy.test.mjs` | 6/6 OK |
| Serviço sobe e responde | `curl http://127.0.0.1:7777/api/health` | OK |
| Chaves cifradas e mascaradas | PUT `/api/settings` devolve `hasKey: true` e chave vazia | OK |
| Memória grava e busca | POST/GET `/api/memories` | OK |
| Origem desconhecida bloqueada | `curl -H "origin: https://evil.com" …` → 403 | OK |
| Painel responde | `curl -o /dev/null -w "%{http_code}" http://localhost:8080` | 200 |
| Conversa com Ollama/Anthropic/OpenAI | depende das suas chaves/modelos | validar localmente |
| Voz clonada XTTS | depende do serviço Python (Python 3.10–3.12) | validar localmente |
| Ações no host | Configurações → Geral → Ações no host; `run_command` pede aprovação no painel | OK |
| `context7_docs` (Context7 MCP) | `POST /api/chat` pedindo docs de uma lib | OK |
| `crawl_page` (crawl4ai) | `POST /api/chat` pedindo para ler uma URL | OK |
| `openhands_task` (OpenHands) | `POST /api/chat` delegando uma tarefa | OK (1ª chamada monta a imagem de runtime) |
| Acesso Tailscale | `curl http://<IP-tailscale>:7777/api/health` | OK |

Validado em Windows 11 com **Node 24.20.0** e npm 11.19.0 (o mínimo continua sendo o 22.13).
O `npm install` reporta 1 vulnerabilidade de severidade alta em dependência transitiva do painel;
`npm audit` mostra o detalhe.

Em modo `dev` o Vite anuncia o painel também em endereços de rede (LAN, Tailscale, WSL) — o
serviço em 7777 segue só em `127.0.0.1` e recusa essas origens com 403, então o painel remoto não
conversa com ele. Para não expor nem o painel, rode em produção: `npm run build` e
`npm run preview -- --port 8080`.
