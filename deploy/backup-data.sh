#!/usr/bin/env bash
# Backup consistente do estado do J.A.R.V.I.S. em Docker.
#
# - Usa `VACUUM INTO` sobre o SQLite ATIVO (WAL-safe): produz uma cópia íntegra sem
#   bloquear o escritor e sem copiar -wal/-shm de forma inconsistente.
# - Inclui a chave mestra e as vozes, necessárias à restauração.
# - Nunca escreve no diretório de dados vivo.
# - Permissões restritas (umask 077) e retenção simples.
# - Não imprime conteúdo de arquivos nem segredos.
set -euo pipefail

SRC="${JARVIS_DATA_DIR:-/opt/laytech-ai/AssistentePessoal/data}"
DEST="${JARVIS_BACKUP_DIR:-/opt/laytech-ai/jarvis-data-backups}"
KEEP="${JARVIS_BACKUP_KEEP:-7}"
STAMP="$(date +%Y%m%dT%H%M%S)"
OUT="$DEST/$STAMP"

umask 077
mkdir -p "$OUT"

if [ ! -f "$SRC/jarvis.db" ]; then
  echo "backup-data: banco não encontrado em $SRC" >&2
  exit 1
fi

# 1) cópia consistente do banco ativo (somente leitura na origem)
sqlite3 "file:$SRC/jarvis.db?mode=ro" "VACUUM INTO '$OUT/jarvis.db'"

# 2) chave mestra (sem a qual o banco não é utilizável) e vozes
cp -p "$SRC/master.key" "$OUT/master.key"
if [ -d "$SRC/voices" ]; then cp -a "$SRC/voices" "$OUT/voices"; fi

# 3) manifesto + verificação de integridade da cópia
( cd "$OUT" && sha256sum jarvis.db master.key > SHA256SUMS.txt )
if ! sqlite3 "file:$OUT/jarvis.db?mode=ro" "PRAGMA integrity_check;" | grep -qx ok; then
  echo "backup-data: cópia com integridade inválida em $OUT" >&2
  exit 1
fi

# 4) retenção simples: mantém os $KEEP mais recentes
ls -1dt "$DEST"/*/ 2>/dev/null | tail -n +$((KEEP + 1)) | xargs -r rm -rf

echo "backup-data: ok em $OUT (retenção $KEEP)"
