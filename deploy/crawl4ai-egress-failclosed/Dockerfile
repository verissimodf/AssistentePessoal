# syntax=docker/dockerfile:1
#
# Imagem candidata do crawl4ai com o egress em modo fail-closed.
#
# NÃO substitui o serviço compartilhado: este Dockerfile produz uma imagem própria, derivada da
# MESMA base pinada em produção, para que a alteração possa ser avaliada e autorizada.
#
# Construir:
#   docker build -t crawl4ai-egress:failclosed-g10 deploy/crawl4ai-egress-failclosed/
#
# Verificar antes de usar:
#   docker run --rm --entrypoint python3 crawl4ai-egress:failclosed-g10 -c \
#     "import egress_broker; print(hasattr(egress_broker,'EgressNotReady'))"
#
# Rollback: continuar usando a imagem original (o Compose atual não é tocado por este arquivo).
FROM unclecode/crawl4ai@sha256:bd36741e7bdd35ddc1a05d9183e1d6d8cefb61dd640d944a25d026b76e917690

USER root

# Os patches usam o prefixo a/app/... — aplicados a partir de / com -p1.
COPY egress_broker.failclosed.patch /tmp/egress_broker.failclosed.patch
COPY server.permanent-browser.patch /tmp/server.permanent-browser.patch
RUN cd / \
 && patch -p1 --batch --forward < /tmp/egress_broker.failclosed.patch \
 && patch -p1 --batch --forward < /tmp/server.permanent-browser.patch \
 && rm -f /tmp/egress_broker.failclosed.patch /tmp/server.permanent-browser.patch \
 && python3 -c "import ast; [ast.parse(open(f).read()) for f in ('/app/egress_broker.py','/app/server.py')]" \
 && python3 -c "import sys; sys.path.insert(0,'/app'); from egress_broker import EgressNotReady; print('fail-closed presente:', EgressNotReady.__name__)"

USER appuser
