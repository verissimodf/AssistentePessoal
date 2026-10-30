#!/usr/bin/env bash
# LayTech — atualização ASSISTIDA do Jarvis para uma tag de release, com backup prévio.
#
# Regras:
#  - BACKUP SEMPRE: snapshot tar do diretório de dados (banco SQLite + artefatos) em data/backups/,
#    com verificação de integridade da listagem (tar -tf).
#  - NUNCA INICIA o serviço: a derrubada/retomada é responsabilidade do operador
#    (systemd/Compose/scripts/jarvis.sh). O script SÓ falha se o serviço ESTIVER NO AR,
#    evitando atualizar o código embaixo de um processo vivo.
#  - NUNCA toca dados de produção: JARVIS_DATA_DIR ambiente do serviço é preservado; aqui só
#    copiamos/empacotamos. Testes rodam em banco TEMPORÁRIO (JARVIS_DATA_DIR próprio).
#  - Idempotente e reversível: imprime o SHA anterior e os comandos de volta exatos.
#
# Uso: scripts/update-release.sh [tag]   (default: a MAIS RECENTE do origin)
set -euo pipefail
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
DATA_DIR="${JARVIS_DATA_DIR:-$ROOT/data}"

# ---------- 0) serviço parado? (prova ativa: health ping) ----------
health_url="${JARVIS_HEALTH_URL:-http://127.0.0.1:${JARVIS_PORT:-7777}/api/health}"
# /api/health é public; qualquer resposta (mesmo 403 de origin) significa ALGUÉM ESCUTANDO.
if curl -s -o /dev/null -m 2 "$health_url" 2>/dev/null; then
  echo "ERRO: um serviço RESPONDEU em $health_url." >&2
  echo "Pare o Jarvis antes de atualizar (systemctl stop assistente-pessoal / docker compose stop / scripts/stop_jarvis.sh)." >&2
  exit 1
fi
# (o ping NÃO respondeu: serviço não está no ar — prosseguir)

# ---------- 1) backup verificado dos dados ----------
prev_sha="$(git rev-parse HEAD)"
prev_tag="$(git describe --tags --exact-match "$prev_sha" 2>/dev/null || echo "$prev_sha")"
stamp="$(date +%Y%m%dT%H%M%S)"
mkdir -p "$DATA_DIR/backups"
bk="$DATA_DIR/backups/jarvis-pre-update-$stamp.tar.gz"
if [ -d "$DATA_DIR" ]; then
  echo "• Backup de $DATA_DIR → $bk"
  tar -C "$ROOT" --exclude="backups" -czf "$bk" "$(basename "$DATA_DIR")"
  tar -tf "$bk" >/dev/null # falha aqui aborta TUDO antes de tocar o código
  echo "  ok: $(du -h "$bk" | cut -f1) — integridade da listagem verificada."
else
  echo "• Sem diretório de dados em $DATA_DIR — backup pulado (nada a preservar)."
fi

# ---------- 2) fetch + checkout da tag ----------
git fetch --tags --prune origin
tag="${1:-$(git tag --sort=-creatordate | head -1)}"
if [ -z "$tag" ]; then echo "ERRO: nenhuma tag no remote." >&2; exit 1; fi
if ! git rev-parse -q --verify "refs/tags/$tag" >/dev/null; then
  echo "ERRO: tag '$tag' não existe." >&2
  exit 1
fi
echo "• Atualizando: $prev_tag ($(echo "$prev_sha" | cut -c1-7)) → $tag ($(git rev-parse "$tag^{commit}" | cut -c1-7))"
git checkout --detach "$tag"

# ---------- 3) dependências limpas (como o Dockerfile; reproducibilidade do release) ----------
npm ci --no-audit --no-fund
(cd server && npm ci --no-audit --no-fund)

# ---------- 4) testes backend (banco TEMPORÁRIO: nunca o real) ----------
tmp="$(mktemp -d)"; trap 'rm -rf "$tmp"' EXIT
export JARVIS_DATA_DIR="$tmp" JARVIS_NO_LISTEN=1
(cd server && npm test)
NITRO_PRESET=node-server npm run build
unset JARVIS_DATA_DIR JARVIS_NO_LISTEN

# ---------- 5) instruções de volta (NUNCA iniciamos o serviço aqui) ----------
cat <<EOF

✅ Pronto: código em $tag e testes/build verificados. backups: $bk

para voltar:
  git checkout $prev_tag && npm ci --no-audit --no-fund \\
    && (cd server && npm ci --no-audit --no-fund)

(NÃO INICIAMOS O SERVIÇO — retome pelo seu mecanismo normal:
 systemctl start assistente-pessoal | docker compose up -d | scripts/jarvis.sh)
EOF
