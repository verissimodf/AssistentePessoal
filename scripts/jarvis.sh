#!/usr/bin/env bash
# Inicia o serviço local + painel e abre o navegador
set -e
cd "$(dirname "$0")/.."
(cd server && node --no-warnings index.js) &
SRV=$!
if [ -x scripts/voz/.venv/bin/python ]; then scripts/voz/.venv/bin/python scripts/voz/voice_service.py & VOZ=$!; fi
npm run dev -- --port 8080 &
WEB=$!
trap 'kill $SRV $WEB ${VOZ:-} 2>/dev/null' EXIT INT TERM
sleep 6
(xdg-open http://localhost:8080 || open http://localhost:8080) >/dev/null 2>&1 || echo "Abra http://localhost:8080"
wait
