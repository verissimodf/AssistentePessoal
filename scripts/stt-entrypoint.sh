#!/bin/sh
set -eu
MODEL=${WHISPER_MODEL:-/models/ggml-small.bin}
if [ ! -r "$MODEL" ]; then
  echo "STT model missing at $MODEL; populate the read-only /models mount" >&2
  exit 1
fi
IP=$(hostname -i | awk '{print $1}')
case "$IP" in
  ''|*[!0-9.]*|0.0.0.0) echo "Unable to determine private container IPv4" >&2; exit 1 ;;
esac
exec whisper-server --host "$IP" --port 8080 --model "$MODEL" --threads "${WHISPER_THREADS:-4}" \
  --language auto --convert --tmp-dir /tmp --no-gpu --duration 20000
