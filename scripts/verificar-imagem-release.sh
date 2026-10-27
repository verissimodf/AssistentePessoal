#!/usr/bin/env bash
# Verificação de imagem de release (P0.3.1) — compara a IMAGEM contra a árvore de código real.
#
# Uso: scripts/verificar-imagem-release.sh <imagem:tag> [sha-esperado] [versão-esperada]
#   Por omissão o SHA esperado é `git rev-parse HEAD` e a versão é a do `package.json` — nunca
#   valores inventados. Sai com rc!=0 se os labels OCI, o `server/build-info.json` ou o serviço
#   em execução divergirem do commit efetivamente construído.
set -u
IMG="${1:?uso: $0 <imagem:tag> [sha-esperado] [versão-esperada]}"
REPO=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
SHA="${2:-$(git -C "$REPO" rev-parse HEAD)}"
VER="${3:-$(node -p "require('$REPO/package.json').version")}"
mkdir -p /tmp/opencode
DATA=$(mktemp -d /tmp/opencode/verif-img-XXXXXX)
NAME="jarvis-verif-img-$$"
FAIL=0

chk() { # chk <descrição> <observado> <esperado>
  if [ "$2" = "$3" ]; then
    echo "PASS $1: $2"
  else
    echo "FAIL $1: observado='$2' esperado='$3'"
    FAIL=1
  fi
}

echo "imagem=$IMG  sha_esperado=$SHA  versão_esperada=$VER"
chmod 777 "$DATA"

# 1) labels OCI da imagem
LABELS=$(docker inspect "$IMG" --format '{{index .Config.Labels "org.opencontainers.image.revision"}}|{{index .Config.Labels "org.opencontainers.image.version"}}|{{index .Config.Labels "org.opencontainers.image.created"}}')
LBL_SHA=$(echo "$LABELS" | cut -d'|' -f1)
LBL_VER=$(echo "$LABELS" | cut -d'|' -f2)
LBL_CREATED=$(echo "$LABELS" | cut -d'|' -f3)
chk "label OCI revision" "$LBL_SHA" "$SHA"
chk "label OCI version" "$LBL_VER" "$VER"
if echo "$LBL_CREATED" | grep -Eq '^[0-9]{4}-[0-9]{2}-[0-9]{2}T[0-9]{2}:[0-9]{2}:[0-9]{2}'; then
  echo "PASS label OCI created: $LBL_CREATED"
else
  echo "FAIL label OCI created: '$LBL_CREATED' (esperado RFC3339)"
  FAIL=1
fi

# 2) build-info.json gravado NA imagem final
BI=$(docker run --rm --entrypoint cat "$IMG" /app/server/build-info.json)
BI_SHA=$(echo "$BI" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).commit))')
BI_VER=$(echo "$BI" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).appVersion))')
chk "build-info commit" "$BI_SHA" "$SHA"
chk "build-info versão" "$BI_VER" "$VER"

# 3) serviço real da imagem: sobe num contentor descartável (sem publicar portas) e lê o health.
# A API escuta no IP do contentor (não em 127.0.0.1) — mesma descoberta do HEALTHCHECK do Dockerfile.
docker run -d --name "$NAME" -v "$DATA:/app/data" "$IMG" >/dev/null
HEALTHJS='const os=require("os");const ip=Object.values(os.networkInterfaces()).flat().find(i=>i&&i.family==="IPv4"&&!i.internal)?.address||"127.0.0.1";fetch(`http://${ip}:7777/api/health`).then(r=>r.json()).then(j=>console.log(JSON.stringify(j))).catch(()=>process.exit(1))'
PANELJS='const os=require("os");const ip=Object.values(os.networkInterfaces()).flat().find(i=>i&&i.family==="IPv4"&&!i.internal)?.address||"127.0.0.1";fetch(`http://${ip}:8090/`).then(r=>console.log(r.status)).catch(()=>console.log("erro"))'
UP=0
for _ in $(seq 1 40); do
  if docker exec "$NAME" node -e "$HEALTHJS" >/tmp/opencode/verif-health-$$.json 2>/dev/null; then UP=1; break; fi
  sleep 1
done
if [ "$UP" = "1" ]; then
  H=$(cat /tmp/opencode/verif-health-$$.json)
  echo "health: $H"
  chk "health version" "$(echo "$H" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).version))')" "$VER"
  chk "health commit" "$(echo "$H" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).commit))')" "$SHA"
  chk "health mode" "$(echo "$H" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).mode))')" "production"
  chk "health setupRequired" "$(echo "$H" | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>console.log(JSON.parse(s).setupRequired))')" "true"
  PANEL=$(docker exec "$NAME" node -e "$PANELJS")
  chk "painel responde" "$PANEL" "200"
else
  echo "FAIL o contentor de verificação não respondeu ao health"
  FAIL=1
fi

# 4) limpeza dirigida (contentor específico, nunca padrões amplos)
docker rm -f "$NAME" >/dev/null 2>&1
rm -rf "$DATA" /tmp/opencode/verif-health-$$.json
echo "VERIFICAÇÃO: $([ "$FAIL" = "0" ] && echo APROVADA || echo REPROVADA)"
exit $FAIL
