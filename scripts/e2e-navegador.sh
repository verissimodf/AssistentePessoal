#!/usr/bin/env bash
# E2E de navegador (Fase 2) em instância ISOLADA: painel estático + API com banco temporário.
# Nada aqui toca o banco de produção nem o contentor em produção.
set -u
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
TMP=$(mktemp -d /tmp/opencode/e2e-XXXXXX)
API=7911
PANEL=7912
export E2E_PASSWORD="senha-e2e-muito-forte-1"
export E2E_API="http://127.0.0.1:$API"
export E2E_PANEL="http://127.0.0.1:$PANEL"

echo "dir do ensaio: $TMP"
cd "$REPO"
[ -f .output/server/index.mjs ] || NITRO_PRESET=node-server npm run build >/dev/null 2>&1

JARVIS_DATA_DIR="$TMP" JARVIS_PORT=$API JARVIS_ALLOWED_ORIGINS="$E2E_PANEL" \
  node server/index.js >"$TMP/api.log" 2>&1 &
API_PID=$!
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$API/api/health" >/dev/null 2>&1 && break; sleep 0.5; done
export E2E_BOOTSTRAP_TOKEN=$(cat "$TMP/bootstrap-token.txt" 2>/dev/null)
echo "bootstrap presente: $([ -n "$E2E_BOOTSTRAP_TOKEN" ] && echo sim || echo NÃO)"
echo "setupRequired: $(curl -s "http://127.0.0.1:$API/api/health" | grep -o '"setupRequired":[a-z]*')"

PORT=$PANEL node .output/server/index.mjs >"$TMP/panel.log" 2>&1 &
PANEL_PID=$!
for i in $(seq 1 40); do curl -fsS "http://127.0.0.1:$PANEL/" >/dev/null 2>&1 && break; sleep 0.5; done

google-chrome --headless=new --no-sandbox --disable-gpu --remote-debugging-port=9222 \
  --user-data-dir="$TMP/chrome" --no-first-run --disable-dev-shm-usage about:blank >"$TMP/chrome.log" 2>&1 &
CHROME_PID=$!
for i in $(seq 1 40); do curl -fsS http://127.0.0.1:9222/json/version >/dev/null 2>&1 && break; sleep 0.5; done

node "$REPO/scripts/e2e-navegador.mjs"; RC=$?

kill $CHROME_PID $PANEL_PID $API_PID 2>/dev/null
wait $CHROME_PID $PANEL_PID $API_PID 2>/dev/null
pkill -f "remote-debugging-port=[9]222" 2>/dev/null
echo "--- API log (erros, se houver) ---"
grep -iE "erro|error" "$TMP/api.log" | grep -v "ExperimentalWarning" | head -5
echo "E2E rc=$RC"
if [ "$RC" = "0" ]; then rm -rf "$TMP"; else echo "logs guardados em $TMP"; fi
exit $RC
