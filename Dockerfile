# syntax=docker/dockerfile:1
# J.A.R.V.I.S. — imagem de produção.
# Um único container serve o painel (Nitro) e a API local na rede Docker `CNC_APP_PROD_01`,
# sem publicar portas no host e sem vincular a 0.0.0.0 (a entrada descobre o IP do container).

# ---------- build ----------
FROM node:22.22-bookworm-slim AS build
WORKDIR /app

# Painel: instalação reprodutível a partir do lockfile versionado.
COPY package.json package-lock.json ./
# Versão declarada no manifesto do repositório (fonte versionada); o commit continua a vir só do
# `--build-arg GIT_SHA` para nunca ser inferido do branch. Fica em `.app-version` para o ARG abaixo.
RUN node -e 'process.stdout.write(require("./package.json").version)' > .app-version
RUN npm ci --no-audit --no-fund

# API: dependências de produção do backend.
COPY server/package.json server/package-lock.json ./server/
RUN cd server && npm ci --no-audit --no-fund

# Fontes + build de produção do painel (preset Nitro node-server).
COPY . .
# Metadados de build identificam a ÁRVORE EXATA usada aqui, gravados em `server/build-info.json`.
# O commit NUNCA é inferido em runtime do branch atual (o processo roda sem git): se `--build-arg`
# não for passado, fica `unknown` e o painel diz "Não registrado" em vez de adivinhar.
# Versão por omissão = manifesto do repositório; um `--build-arg APP_VERSION` substitui.
# `APP_VERSION` precisa de um default literal: sem ele o valor chega VAZIO e o parser não expande
# `$VAR` dentro de valores de `LABEL`.
# Identidade de build: nomes explícitos exigidos pelo runbook de homologação. Os ARGs antigos
# (APP_VERSION/GIT_SHA) continuam aceitos como aliases para não quebrar builds já automatizados.
ARG APP_VERSION=sem-build
ARG GIT_SHA=unknown
ARG BUILD_VERSION=sem-build
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_STATUS=unknown
ARG SCHEMA_VERSION=unknown
ARG BUILD_TIME=unknown
# `RELEASE_BUILD=1` liga a validação ESTRITA dos metadados no script abaixo: um release sem
# identidade verificável (SHA completo, versão canônica, schema, status, instante RFC3339) TEM DE
# FALHAR o build — nunca produzir uma imagem com "unknown". Builds de desenvolvimento continuam
# tolerantes.
ARG RELEASE_BUILD=
# O `RUN` recebe os ARGs por expansão de SHELL (`$VAR`). Preferimos os nomes novos; se vierem
# vazios, os antigos continuam valendo (compatibilidade).
RUN if [ "$BUILD_VERSION" = "sem-build" ] && [ "$APP_VERSION" != "sem-build" ]; then BUILD_VERSION="$APP_VERSION"; fi; \
    if [ "$BUILD_COMMIT" = "unknown" ] && [ "$GIT_SHA" != "unknown" ]; then BUILD_COMMIT="$GIT_SHA"; fi; \
    APP_VERSION="$BUILD_VERSION" GIT_SHA="$BUILD_COMMIT" BUILD_TIME="$BUILD_TIME" \
    SCHEMA_VERSION="$SCHEMA_VERSION" BUILD_COMMIT_STATUS="$BUILD_COMMIT_STATUS" \
    RELEASE_BUILD="$RELEASE_BUILD" node scripts/write-build-info.mjs
# Labels OCI: auditoria da imagem (a versão exibida vem do JSON acima).
LABEL org.opencontainers.image.revision="$BUILD_COMMIT" \
      org.opencontainers.image.version="$BUILD_VERSION" \
      org.opencontainers.image.created="$BUILD_TIME"
RUN NITRO_PRESET=node-server npm run build

# ---------- runtime ----------
FROM node:22.22-bookworm-slim AS runtime
# Metadados de build na imagem FINAL (P0.3): o escopo de um `ARG` não atravessa um `FROM`, por
# isso os ARGs são re-declarados aqui e o ficheiro gerado no estágio de build é copiado. Sem
# estas linhas a imagem final reportaria `unknown` ("Não registrado") e não teria o label OCI —
# foi exatamente isso que se observou num build sem elas.
ARG BUILD_VERSION=sem-build
ARG BUILD_COMMIT=unknown
ARG BUILD_COMMIT_STATUS=unknown
ARG SCHEMA_VERSION=unknown
ARG BUILD_TIME=unknown
ENV NODE_ENV=production
# Metadados também em ENV: o health continua correto mesmo se o JSON for substituído/omitido.
ENV APP_VERSION="$BUILD_VERSION" \
    GIT_SHA="$BUILD_COMMIT" \
    BUILD_COMMIT_STATUS="$BUILD_COMMIT_STATUS" \
    SCHEMA_VERSION="$SCHEMA_VERSION" \
    BUILD_TIME="$BUILD_TIME"
# HOME gravável pelo uid 1000 e estável: os agentes CLI recusam criar helpers sob /tmp.
ENV HOME=/home/node
ENV JARVIS_DATA_DIR=/app/data
WORKDIR /app

# init mínimo (tini) como PID 1: recolhe processos filhos e repassa sinais.
RUN apt-get update \
 && apt-get install -y --no-install-recommends tini procps \
 && rm -rf /var/lib/apt/lists/*

# Agentes CLI das integrações (Configurações → Integrações: claude_code, codex, opencode).
# Versões fixadas para builds reproduzíveis; apenas binários — nenhuma credencial entra na
# imagem (a autenticação é feita em runtime, dentro do container). Licenças: Claude Code
# proprietária (ver README do pacote), Codex Apache-2.0, OpenCode MIT, REA MIT, Gigabrain MIT.
RUN npm install -g --no-audit --no-fund \
      @anthropic-ai/claude-code@2.1.301 \
      @openai/codex@0.163.0 \
      opencode-ai@1.19.3 \
      rea-agents@6.5.0 \
      @legendaryvibecoder/gigabrain@0.11.0 \
 && npm cache clean --force && rm -rf /root/.npm /home/node/.npm

# Dependências de runtime da API (dotenv, imapflow, nodemailer).
COPY --from=build /app/server/node_modules ./server/node_modules
# Código da API.
COPY server/ ./server/
# Identidade da árvore construída (gerada no estágio de build; `server/` do contexto não a traz).
COPY --from=build /app/server/build-info.json ./server/build-info.json
LABEL org.opencontainers.image.revision="$BUILD_COMMIT" \
      org.opencontainers.image.version="$BUILD_VERSION" \
      org.opencontainers.image.created="$BUILD_TIME"
# Painel já construído.
COPY --from=build /app/.output ./.output
# Entrada do container + ponte de voz + helper de diagnóstico de saída dos componentes.
COPY scripts/container-entrypoint.sh scripts/voice-adapter.mjs scripts/voice-adapter-core.mjs scripts/setup-global-skills.mjs ./scripts/
# Skills vendorizadas (Markdown fixado por commit + manifesto/SHA256SUMS). Apenas conteúdo:
# o entrypoint sincroniza no hub e nunca executa nada deste diretório.
COPY skills/ ./skills/
COPY scripts/lib/exit-reporter.sh ./scripts/lib/exit-reporter.sh
RUN chmod +x scripts/container-entrypoint.sh \
 && chmod -R a+rX /app/skills \
 && mkdir -p /app/data && chown -R 1000:1000 /app/data /home/node

# Não-root por construção: vale mesmo fora do Compose (sem `--user`).
# O uid/gid 1000 casa com o dono de `data/` no host, preservando SQLite/WAL.
USER 1000:1000

# Documentação apenas — EXPOSE não publica nada no host.
EXPOSE 7777 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=25s --retries=3 CMD \
  node -e 'const os=require("os");const ip=Object.values(os.networkInterfaces()).flat().find(i=>i&&i.family==="IPv4"&&!i.internal)?.address||"127.0.0.1";fetch(`http://${ip}:7777/api/health`).then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))'

ENTRYPOINT ["/usr/bin/tini", "--", "/app/scripts/container-entrypoint.sh"]
