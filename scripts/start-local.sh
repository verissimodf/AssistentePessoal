#!/usr/bin/env bash
# LayTech — sobe o serviço local (7777) + painel (8090; 8080 está ocupado pelo searxng do Odysseus),
# a ponte de voz (7778) e o relé Tailscale (acesso pela rede privada, sem abrir na LAN).
# Usado pelo serviço systemd `assistente-pessoal.service` e também pode rodar à mão.
set -euo pipefail
cd "$(dirname "$0")/.."

export JARVIS_PORT="${JARVIS_PORT:-7777}"
export JARVIS_HOST="${JARVIS_HOST:-127.0.0.1}"
PANEL_PORT="${PANEL_PORT:-8090}"

# Origens confiáveis: loopback + rede Tailscale (IP e MagicDNS), se disponível.
ORIGINS="http://localhost:${PANEL_PORT},http://127.0.0.1:${PANEL_PORT}"
TSIP=$(tailscale ip -4 2>/dev/null | head -1 || true)
TSHOST=$(tailscale status --json 2>/dev/null | node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>{try{console.log(JSON.parse(s).Self.DNSName.replace(/\.$/,''))}catch{}})" 2>/dev/null || true)
[ -n "$TSIP" ] && ORIGINS="${ORIGINS},http://${TSIP}:${PANEL_PORT}"
[ -n "$TSHOST" ] && ORIGINS="${ORIGINS},http://${TSHOST}:${PANEL_PORT}"
export JARVIS_ALLOWED_ORIGINS="${JARVIS_ALLOWED_ORIGINS:-$ORIGINS}"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

node --no-warnings server/index.js &
pids+=($!)

# Ponte de voz (voz clonada jarvis-ptbr via xtts-service local, 127.0.0.1:7778).
node scripts/voice-adapter.mjs &
pids+=($!)

# Painel em produção (build nitro node-server); fallback para dev se não houver build.
if [ -f .output/server/index.mjs ]; then
  PORT="$PANEL_PORT" HOST=127.0.0.1 node .output/server/index.mjs &
else
  npm run dev -- --port "$PANEL_PORT" --host 127.0.0.1 &
fi
pids+=($!)

# Relé Tailscale (expõe 7777 e 8090 no IP do tailnet).
node scripts/tailnet-proxy.mjs &
pids+=($!)

echo "Assistente Pessoal: serviço http://127.0.0.1:${JARVIS_PORT} | painel http://localhost:${PANEL_PORT} | tailnet ${TSIP:-?}:${PANEL_PORT}"
# Sai quando qualquer componente morrer, para o systemd (Restart=always) reiniciar o conjunto.
wait -n
