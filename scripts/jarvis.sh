#!/usr/bin/env bash

echo "[JARVIS] Iniciando o ecossistema do Assistente Pessoal..."

# Garante que o script execute a partir da raiz do repositório
cd "$(dirname "$0")/.."

# 1. Verificação Automática e Criação do .env
if [ ! -f .env ]; then
    echo "[JARVIS] Arquivo .env não encontrado. Clonando a partir do .env.example..."
    if [ -f .env.example ]; then
        cp .env.example .env
        echo "[JARVIS] Arquivo .env criado com sucesso! Configure suas chaves depois."
    else
        echo "[ERRO] .env.example não foi encontrado. Crie um arquivo .env manualmente."
        exit 1
    fi
fi

# Cria um diretório temporário para armazenar os IDs dos processos (PIDs)
mkdir -p .pids

# 2. Inicialização dos Serviços em Background Desvinculados (Nohup)
echo "[JARVIS] Inicializando módulos em segundo plano..."

# Inicia o Servidor Core (Node)
nohup node --no-warnings server/index.js > /dev/null 2>&1 &
echo $! > .pids/server.pid

# Inicia o Serviço de Voz (Python) - Se o ambiente virtual existir
if [ -x scripts/voz/.venv/bin/python ]; then
    nohup scripts/voz/.venv/bin/python scripts/voz/voice_service.py > /dev/null 2>&1 &
    echo $! > .pids/voice.pid
fi

# Inicia o Painel Web (Frontend Vite)
nohup npm run dev -- --port 8080 > /dev/null 2>&1 &
echo $! > .pids/web.pid

echo "[JARVIS] Todos os serviços foram destacados para background com sucesso!"
echo "[JARVIS] Aguardando inicialização para abrir a interface web..."

# 3. Aguarda a subida do sistema e abre o navegador nativo (Linux/macOS)
sleep 6
if command -v xdg-open >/dev/null 2>&1; then
    xdg-open http://localhost:8080 >/dev/null 2>&1
elif command -v open >/dev/null 2>&1; then
    open http://localhost:8080 >/dev/null 2>&1
else
    echo "[JARVIS] Painel pronto! Abra manualmente em: http://localhost:8080"
fi

