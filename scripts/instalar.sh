#!/usr/bin/env bash
# Instalador do Jarvis para Linux (Ubuntu/Debian/Fedora/Arch) e macOS
set -euo pipefail
cd "$(dirname "$0")/.."
echo "=== J.A.R.V.I.S. - instalação ==="

if ! command -v node >/dev/null; then
  echo "Node.js não encontrado. Instale Node 22.13+ (https://nodejs.org ou 'nvm install 22')."; exit 1
fi
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
[ "$MAJOR" -ge 22 ] || { echo "Requer Node.js 22.13 ou superior (atual: $(node -v))."; exit 1; }

echo "[1/3] Dependências do painel..."; npm install
echo "[2/3] Dependências do serviço local..."; (cd server && npm install)
echo "[3/3] Pasta de dados local..."; mkdir -p data; [ -f .env ] || cp .env.example .env
chmod +x scripts/*.sh

echo
echo "Instalado. Para iniciar: ./scripts/jarvis.sh"
echo "Voz clonada/local (opcional): ./scripts/instalar-voz.sh"
