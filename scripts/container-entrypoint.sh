#!/usr/bin/env bash
# Entrada do container J.A.R.V.I.S.: sobe API + ponte de voz + painel num único container.
# Escuta apenas no endereço do próprio container na rede Docker — nunca em 0.0.0.0 e sem
# publicar portas no host. O relé Tailscale permanece no host (fora do container).
set -euo pipefail
cd /app

# Store Gigabrain (memória local compartilhada): bootstrap UMA VEZ no volume persistente.
# gigabrain-codex-setup é standalone (não exige agentes detectados) e idempotente (merge).
GB_DATA="/app/data/gigabrain"
if [ -d /app/data ] && [ ! -f "$GB_DATA/config.json" ]; then
  mkdir -p "$GB_DATA"
  echo "assistente-pessoal: bootstrap da memória Gigabrain em $GB_DATA"
  if ! gigabrain-codex-setup --project-root "$GB_DATA" --config "$GB_DATA/config.json" --store-mode global >/dev/null 2>&1; then
    echo "assistente-pessoal: AVISO — bootstrap do Gigabrain falhou; integração indisponível até reexecutar (gigabrain-codex-setup)." >&2
  fi
fi

# IP do container na rede Docker (primeiro IPv4 não-loopback). Nunca 0.0.0.0.
BIND_IP="${JARVIS_BIND_IP:-$(node -e 'const os=require("os");for(const a of Object.values(os.networkInterfaces()))for(const i of a||[])if(i&&i.family==="IPv4"&&!i.internal){process.stdout.write(i.address);process.exit(0)}process.exit(1)')}"
if [ -z "${BIND_IP:-}" ] || [ "$BIND_IP" = "0.0.0.0" ]; then
  echo "container-entrypoint: endereço de bind inválido" >&2
  exit 1
fi

export JARVIS_HOST="$BIND_IP"
export JARVIS_PORT="${JARVIS_PORT:-7777}"
PANEL_PORT="${PANEL_PORT:-8090}"

# Skills Hub (P1-C): catálogo determinístico, OFFLINE e idempotente. A cada boot o sincronizador
# valida manifesto + SHA256SUMS das skills vendorizadas e faz merge no catálogo existente,
# preservando skills de terceiros. Falha é avisada de forma explícita e o catálogo anterior fica
# intacto; nunca derruba o container. `JARVIS_SKILLS_SETUP=full` é o opt-in de rede (clones não
# fixados). `JARVIS_SKILLS_SETUP=off` desativa qualquer provisionamento.
SKILLS_SETUP="${JARVIS_SKILLS_SETUP:-builtin}"
export JARVIS_GLOBAL_SKILLS_DIR="${JARVIS_GLOBAL_SKILLS_DIR:-$HOME/.agent-skills}"
# Executa com limite de tempo quando `timeout` existir; nunca deixa o boot pendurado.
with_timeout() {
  local secs="$1"; shift
  if command -v timeout >/dev/null 2>&1; then timeout "$secs" "$@"; else "$@"; fi
}
case "$SKILLS_SETUP" in
  off)
    echo "assistente-pessoal: skills hub — provisionamento desativado (JARVIS_SKILLS_SETUP=off)"
    ;;
  full)
    echo "assistente-pessoal: skills hub — modo de rede (opt-in explícito; clones externos não fixados)"
    if ! with_timeout 300 node scripts/setup-global-skills.mjs --full; then
      echo "assistente-pessoal: AVISO — provisionamento de skills (full) falhou; catálogo anterior preservado." >&2
    fi
    ;;
  *)
    if ! with_timeout 60 node scripts/setup-global-skills.mjs --sync-bundled; then
      echo "assistente-pessoal: AVISO — sincronização das skills vendorizadas falhou; baseline embutida e catálogo anterior preservados (motivo no log acima)." >&2
    fi
    ;;
esac

# Ponte de voz -> xtts-service pela rede Docker (mesmo container usa loopback por padrão).
export XTTS_URL="${XTTS_URL:-http://xtts-service:8000}"

pids=()
cleanup() { for p in "${pids[@]}"; do kill "$p" 2>/dev/null || true; done; }
trap cleanup EXIT INT TERM

# API local.
node --no-warnings server/index.js & pids+=($!)
# Ponte de voz (loopback interno do container).
node scripts/voice-adapter.mjs & pids+=($!)
# Painel de produção (Nitro node-server).
PORT="$PANEL_PORT" HOST="$BIND_IP" node .output/server/index.mjs & pids+=($!)

echo "assistente-pessoal: api http://${BIND_IP}:${JARVIS_PORT} | painel http://${BIND_IP}:${PANEL_PORT} | voz ${XTTS_URL}"
# Sai quando qualquer componente morrer, para o Docker reiniciar o conjunto — registrando QUAL
# componente saiu (sem isso um reinício gracioso fica sem causa determinável).
# shellcheck source=lib/exit-reporter.sh
. "$(dirname "$0")/lib/exit-reporter.sh"
wait_for_first_exit "${pids[@]}"
