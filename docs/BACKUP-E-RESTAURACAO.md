# Backup e restauração

Procedimento validado em 2026-10-25 (G9). **O banco sozinho não restaura.**

## Por que `master.key` é obrigatório

As configurações (chaves de integração, tokens de canal) são cifradas com `data/master.key`.
Sem o arquivo, `walkDecrypt()` lança durante o boot e o serviço **não inicia**:

```
Error: ... at Decipheriv.final ... at walkDecrypt (server/settings.js)
```

Ensaio real: restaurar apenas `jarvis.db` → container `unhealthy`, processo encerra.
Restaurar `jarvis.db` + `master.key` → `healthy`, login OK, dados íntegros.

## Backup

```bash
B=/opt/laytech-ai/backups/jarvis-$(date -u +%Y%m%dT%H%M%SZ)
mkdir -p "$B" && chmod 700 "$B"

# 1) cópia consistente do SQLite (lida com WAL)
sqlite3 "file:/opt/laytech-ai/AssistentePessoal/data/jarvis.db?mode=ro" ".backup '$B/jarvis.db'"

# 2) a chave de cifra — sem ela o serviço não sobe
cp -a /opt/laytech-ai/AssistentePessoal/data/master.key "$B/master.key"

# 3) permissões e verificação
chmod 600 "$B"/*
sqlite3 "file:$B/jarvis.db?mode=ro" "PRAGMA integrity_check; PRAGMA user_version;"
sha256sum "$B"/*
```

Guarde o diretório fora do repositório e fora de qualquer caminho servido por HTTP.

## Restauração (testada)

```bash
docker stop assistente-pessoal
cp "$B/jarvis.db" "$B/master.key" /opt/laytech-ai/AssistentePessoal/data/
rm -f /opt/laytech-ai/AssistentePessoal/data/jarvis.db-shm /opt/laytech-ai/AssistentePessoal/data/jarvis.db-wal
docker start assistente-pessoal
curl -s http://<host>:7777/api/health
```

Confirme: `integrity_check=ok`, `user_version` esperado, login funcional e contagens de agentes,
memórias e auditoria.

## Rollback de imagem

As imagens anteriores permanecem no host. Exemplo:

```bash
IMAGE_TAG=<tag-anterior> docker compose -f docker-compose.yml up -d --no-build
```

## Observações

- `master.key` **não** deve ser versionado nem copiado para artefatos públicos.
- O backup inclui dados pessoais: trate o diretório como sensível (700/600).
- `-wal`/`-shm` não precisam ser copiados quando se usa `.backup`; remova-os antes de restaurar.
