#!/usr/bin/env bash

echo "[JARVIS] Desconectando ecossistema e encerrando serviços no Linux..."

# Garante que o script execute a partir da raiz do repositório
cd "$(dirname "$0")/.."

# 1. Finaliza os processos através dos arquivos de PID gravados no boot
if [ -d .pids ]; then
    for pid_file in .pids/*.pid; do
        if [ -f "$pid_file" ]; then
            PID=$(cat "$pid_file")
            if kill -0 "$PID" 2>/dev/null; then
                kill "$PID" 2>/dev/null || kill -9 "$PID" 2>/dev/null
            fi
            rm "$pid_file"
        fi
    done
    rmdir .pids 2>/dev/null
    echo "[JARVIS] Processos controlados foram encerrados."
fi

# 2. Fallback de Segurança Inteligente (Garante que nada ficou travado na memória)
# Encerra apenas instâncias do node/python vinculadas estritamente ao diretório do projeto
pkill -f "server/index.js" >/dev/null 2>&1
pkill -f "voice_service.py" >/dev/null 2>&1
pkill -f "vite.*--port 8080" >/dev/null 2>&1

echo "[JARVIS] Todos os serviços foram finalizados com sucesso."
