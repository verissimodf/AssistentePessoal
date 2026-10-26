# Backup e restauração — J.A.R.V.I.S. (Docker)

## O que é feito

`deploy/backup-data.sh` produz uma cópia **consistente** do estado do assistente:

| Item | Como | Por quê |
|---|---|---|
| `jarvis.db` | `VACUUM INTO` sobre o SQLite **ativo** (`mode=ro`) | Cópia íntegra e WAL-safe, sem bloquear o escritor e sem copiar `-wal`/`-shm` inconsistentes |
| `master.key` | `cp -p` | Sem ela o banco não é utilizável (segredos das settings são AES-256-GCM) |
| `voices/` | `cp -a` | Vozes clonadas |
| `SHA256SUMS.txt` | `sha256sum` | Verificação posterior |

- Destino padrão: `/opt/laytech-ai/jarvis-data-backups/<AAAAmmddTHHMMSS>/`
- Permissões: `umask 077` (diretório e arquivos acessíveis só ao dono).
- Retenção: mantém os **7** mais recentes (`JARVIS_BACKUP_KEEP`).
- O diretório de dados vivo **nunca** é modificado.
- Nenhum conteúdo de arquivo ou segredo é impresso nos logs.

## Automação (systemd de usuário)

```
jarvis-data-backup.timer   -> dispara diariamente (Persistent=true)
jarvis-data-backup.service -> ExecStart=deploy/backup-data.sh
```

Operação:

```bash
systemctl --user list-timers jarvis-data-backup.timer   # próximo disparo
systemctl --user start jarvis-data-backup.service       # execução manual
journalctl --user -u jarvis-data-backup.service -n 20   # resultado
```

Variáveis aceitas: `JARVIS_DATA_DIR`, `JARVIS_BACKUP_DIR`, `JARVIS_BACKUP_KEEP`.

## Verificar um backup

```bash
BK=/opt/laytech-ai/jarvis-data-backups/<stamp>
( cd "$BK" && sha256sum -c SHA256SUMS.txt )
sqlite3 "file:$BK/jarvis.db?mode=ro" "PRAGMA user_version; PRAGMA integrity_check;"
```

## Restaurar (procedimento completo)

> O container é o **único escritor** do banco. Sempre pare-o antes de substituir arquivos.

1. **Parar o escritor** (o container):
   ```bash
   cd /opt/laytech-ai/AssistentePessoal
   docker compose -f docker-compose.yml down
   ```
2. **Preservar o estado atual** (nunca sobrescrever sem cópia):
   ```bash
   mv data data.pre-restore.$(date +%Y%m%dT%H%M%S)
   mkdir -p data
   ```
3. **Copiar o backup**:
   ```bash
   BK=/opt/laytech-ai/jarvis-data-backups/<stamp>
   cp -p "$BK/jarvis.db" "$BK/master.key" data/
   cp -a "$BK/voices" data/ 2>/dev/null || mkdir -p data/voices
   chmod 600 data/jarvis.db data/master.key
   ```
4. **Conferir antes de subir**:
   ```bash
   sqlite3 "file:data/jarvis.db?mode=ro" "PRAGMA user_version; PRAGMA integrity_check;"
   ```
   Esperado: `5` e `ok`.
5. **Subir o container**:
   ```bash
   docker compose -f docker-compose.yml up -d --no-build
   docker compose -f docker-compose.yml ps
   curl -s http://192.168.2.40:7777/api/health
   ```
6. **Rollback da restauração** (se algo falhar): parar o container e renomear `data` de volta para `data.pre-restore.<stamp>`.

## Limitações conhecidas

- O destino fica no **mesmo disco** (`/opt`). Protege contra erro humano e corrupção lógica, **não** contra falha do disco — replicar para outro host/volume quando houver.
- Não há backup do `-wal` em tempo real: `VACUUM INTO` já consolida o conteúdo confirmado.
- O backup não inclui a imagem Docker (reconstruível via `Dockerfile`) nem `.env` (sem segredos hoje).
