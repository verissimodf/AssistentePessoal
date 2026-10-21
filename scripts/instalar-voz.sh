#!/usr/bin/env bash
# Opcional: voz local (Kokoro) e voz clonada (XTTS-v2), 100% offline após o download dos modelos.
#
# O kokoro exige Python <3.13, então 3.13 e 3.14 não servem. Procuramos um 3.11, 3.12 ou 3.10
# em vez de usar o "python3" do PATH direto, que em distros novas já é 3.13+ e faria o pip
# falhar ao resolver coqui-tts/kokoro depois da .venv já estar criada.
set -e
cd "$(dirname "$0")/voz"

PY=""
for v in python3.11 python3.12 python3.10; do
  if command -v "$v" >/dev/null 2>&1; then PY="$v"; break; fi
done

# Último recurso: o python3 do PATH, só se estiver na faixa suportada.
if [ -z "$PY" ] && command -v python3 >/dev/null 2>&1; then
  if python3 -c 'import sys; sys.exit(0 if (3,10) <= sys.version_info < (3,13) else 1)' 2>/dev/null; then
    PY=python3
  fi
fi

if [ -z "$PY" ]; then
  echo "[erro] Não encontrei um Python 3.10, 3.11 ou 3.12 (o kokoro exige <3.13)." >&2
  echo "       Ubuntu/Debian: sudo apt install python3.12-venv   |   ou: uv venv -p 3.12 .venv" >&2
  exit 1
fi

echo "Usando $($PY --version)"
"$PY" -m venv .venv
.venv/bin/python -m pip install --upgrade pip
.venv/bin/python -m pip install coqui-tts kokoro soundfile numpy
echo "Pronto. No painel: Configurações > Voz e ativação > Motor de voz = Kokoro ou XTTS-v2."
