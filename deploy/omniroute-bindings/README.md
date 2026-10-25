# OmniRoute — restrição de bindings (proposta, **não aplicada**)

O Compose do OmniRoute vive fora deste repositório (`/opt/laytech-ai/docker/omniroute/docker-compose.yml`)
e **não foi alterado**. Este diretório contém a alteração mínima proposta e a evidência que a sustenta.

## 1. Estado atual (medido em 2026-10-25)

| Porta | Binding | Serviço | Responde? |
|---|---|---|---|
| 20128 | `0.0.0.0:20128` | painel administrativo + API (mesma porta: `DASHBOARD_PORT=API_PORT=20128`) | sim (`/api/health/ping` → 200) |
| 3012 | `0.0.0.0:3012` | hub de notificações (`NOTIFICATIONS_PORT`) | **não** — nem em `127.0.0.1:3012` |

Alcance observado:

| Origem | 20128 | 3012 |
|---|---|---|
| LAN (`192.168.4.214`) | 200 | sem conexão |
| Tailnet (`100.87.104.126`) | 200 | sem conexão |
| Público (`https://omniroute.laytech.com.br`) | `/` → 307 `/dashboard` → 307 `/login`; `/api/models` → **401** | via nginx (`/notifications/hub`) |

O painel é **protegido por login** e a API exige chave (401), mas o formulário de login está exposto
na internet e na LAN/tailnet.

## 2. Consumidores (todos usam DNS de serviço, não o binding do host)

| Consumidor | Caminho | Depende do binding `0.0.0.0`? |
|---|---|---|
| Jarvis (`providers.omniroute.baseUrl`) | `http://omniroute:20128/v1` | **não** |
| nginx (`omniroute.laytech.com.br`) | `proxy_pass http://omniroute:20128` e `http://omniroute:3012` | **não** |
| Hermes | usa `OPENCLAW_URL=http://host.docker.internal:18789` (OpenClaw), não OmniRoute | **não** |

Nenhum container referencia `20128`/`3012` pelo endereço do host (varredura de `Config.Env` em
todos os containers em execução).

## 3. Alteração proposta

```yaml
services:
  omniroute:
    ports:
      - "127.0.0.1:20128:20128"   # painel/API: acesso externo continua via nginx (Docker DNS)
      - "127.0.0.1:3012:3012"     # hub: já não responde; mantido local para diagnóstico
```

Arquivo: `docker-compose.override.example.yml` (copiar para
`/opt/laytech-ai/docker/omniroute/docker-compose.override.yml` **somente após autorização**).

> **Detalhe que importa:** `ports` **acumulam** no merge de Compose. Sem a tag `!override` a lista
> do arquivo base (`0.0.0.0`) continuaria valendo e a restrição não teria efeito. A tag exige
> Compose >= 2.24 (aqui: 2.40.3). Validação sem aplicar, já executada:
>
> ```bash
> docker compose -f /opt/laytech-ai/docker/omniroute/docker-compose.yml \
>   -f deploy/omniroute-bindings/docker-compose.override.example.yml config | grep -A3 ports:
> # host_ip: 127.0.0.1  (20128 e 3012)
> ```

### O que muda

- Remove o acesso direto por LAN e tailnet ao painel/API (`http://<host>:20128`).
- Mantém **intactos**: Jarvis, nginx e o caminho público `omniroute.laytech.com.br`.
- Não altera firewall, rede, imagem ou variáveis de ambiente.

### O que pode quebrar (confirmar antes)

- Uso do painel por `http://192.168.4.214:20128` ou `http://100.87.104.126:20128` em vez do
  domínio público. Nesse caso, a alternativa é manter `20128` bound apenas na interface desejada
  (ex.: `100.87.104.126:20128:20128`) em vez de loopback.

## 4. Validação proposta (após autorização)

```bash
cd /opt/laytech-ai/docker/omniroute
docker compose config | grep -A4 'ports:'          # confere os bindings
docker compose up -d                                # recria apenas o omniroute
ss -lntp | grep -E ':(20128|3012)\b'                # deve mostrar 127.0.0.1
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:20128/api/health/ping   # 200
curl -s -o /dev/null -w '%{http_code}\n' https://omniroute.laytech.com.br/        # 307
curl -s -o /dev/null -w '%{http_code}\n' http://192.168.4.214:20128/api/health/ping  # falha esperada
```

Rollback: remover o override e `docker compose up -d` (volta a `0.0.0.0`).

## 5. Risco residual que esta alteração **não** resolve

O painel administrativo continua exposto **publicamente** em `omniroute.laytech.com.br` (login),
via nginx. Restringir isso exige uma decisão separada: allowlist de origem no nginx, autenticação
adicional (ex.: Basic Auth/MFA no proxy) ou remoção do bloco público. Não foi alterado.
