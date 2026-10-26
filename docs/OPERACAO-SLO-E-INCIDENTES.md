# Operação: SLOs, indicadores e resposta a incidentes

**Status:** proposta operacional (2026-10-26). Nenhum SLO foi formalmente aprovado e não há
Prometheus/Grafana/alertmanager instalados. As metas abaixo são **propostas iniciais** baseadas em
observações pontuais da release 1.7.8; devem ser recalibradas com dados reais antes de virarem
compromisso.

## 1. Fontes de dados já existentes

| Fonte | Como consultar | Uso |
| --- | --- | --- |
| `/api/health` | `curl -s http://<ip-interno>:7777/api/health` | disponibilidade, versão, commit, esquema |
| Docker healthcheck | `docker inspect assistente-pessoal --format '{{.State.Health.Status}} {{.RestartCount}}'` | saúde/restarts |
| `/api/diagnostics` | sessão de administrador | providers, integrações, skills, contagens |
| `/api/router/telemetry` | token de serviço com `skills:read` | chamadas, falhas, latência, fallbacks |
| `PRAGMA integrity_check` / `user_version` | `sqlite3` somente leitura | integridade/esquema |
| Backups | `deploy/backup-data.sh` + `SHA256SUMS.txt` | sucesso, idade, integridade |
| `audit` | tabela SQLite | eventos de segurança/operação (metadados) |
| `docker logs` | `docker logs assistente-pessoal` | erros de inicialização e integrações |

Não há coleta contínua de métricas. Para alertas reais, usar um exporter leve ou um cron que
consulte as fontes acima e notifique; não instalar stack pesada sem necessidade demonstrada.

## 2. SLOs propostos

| Indicador | Fórmula | Janela | Proposta inicial | Fonte |
| --- | --- | --- | --- | --- |
| Disponibilidade do health | requisições `ok:true` / total | 30 dias | ≥ 99,5% | `/api/health` |
| Latência de chat (p95) | p95 do tempo de `POST /api/chat` | 7 dias | ≤ 30 s (local) / ≤ 90 s (provider externo) | telemetria + logs de aplicação |
| Latência de TTS (p95) | p95 de `/api/tts` | 7 dias | ≤ 10 s | telemetria/ponte de voz |
| Erros HTTP 5xx | 5xx / total de requisições | 1 dia | ≤ 1% | logs/contadores (a implementar) |
| Falha de inferência | chamadas com falha / total | 1 dia | ≤ 5% | `/api/router/telemetry` |
| Integridade do SQLite | `integrity_check=ok` | diário | 100% | `sqlite3` |
| Crescimento do SQLite/WAL | tamanho atual vs. dia anterior | diário | < 20%/dia e WAL < 256 MB | `du`/`stat` |
| Sucesso de backup | backups íntegros / tentativas | diário | 100% | `deploy/backup-data.sh` |
| Idade do último backup | agora − mtime do backup mais recente | contínuo | ≤ 26 h | diretório de backup |
| Reinícios do container | `RestartCount` | 7 dias | ≤ 1 | Docker inspect |

**Baseline observada (não estatística):** em 2026-10-26, health respondeu `ok` em todas as
verificações pontuais; chat real via Ollama levou ~71 s em cold start; Headroom respondeu em
~6,4 s; o container estava `healthy`, `restarts=0`. Use esses valores apenas como ponto de
partida, não como prova de SLO.

## 3. Limites de alerta propostos

| Condição | Severidade | Ação inicial |
| --- | --- | --- |
| health falha 3 vezes consecutivas (30 s) | **SEV-1** | verificar container, logs, disco, banco |
| `RestartCount` aumenta 2× em 1 h | **SEV-1** | logs do entrypoint e `docker inspect` |
| `integrity_check != ok` | **SEV-1** | parar escritor, preservar cópia, restaurar backup |
| último backup > 26 h ou checksum inválido | **SEV-1** | executar backup manual, investigar timer |
| 5xx > 5% em 15 min | **SEV-2** | identificar rota, provider e logs |
| falha de inferência > 20% em 15 min | **SEV-2** | verificar provider, fallback e telemetria |
| WAL > 256 MB ou DB crescendo > 20%/dia | **SEV-2** | checar checkpoint, retenção e processos |
| TTS > 30 s p95 | **SEV-3** | verificar `xtts-service`/fila e fallback |

## 4. Runbook de incidente

1. **Detectar e registrar:** horário UTC, sintoma, versão/commit (`/api/health`), imagem e
   `docker inspect`. Não copiar prompts, tokens ou dados pessoais para o ticket.
2. **Triar:** health → container → logs → banco → provider/integração. Confirmar se é
   indisponibilidade, erro de configuração, corrupção ou regressão.
3. **Conter:** se o container estiver em loop, parar/reiniciar apenas o serviço; se houver suspeita
   de corrupção, parar o escritor antes de copiar o banco. Não executar `docker system prune`.
4. **Recuperar:** rollback de imagem (`IMAGE_TAG=<anterior> docker compose up -d --no-build`) ou
   restauração de backup com banco + `master.key` em ambiente isolado; validar `integrity_check`,
   login e health.
5. **Comunicar:** informar impacto, início, mitigação e próximo update. Não prometer prazo sem
   evidência.
6. **Encerrar:** confirmar health estável, `restarts=0`, backup recente e ausência de segredos nos
   logs. Registrar causa raiz, ação corretiva e item de prevenção.

## 5. Diagnóstico rápido

```bash
cd /opt/laytech-ai/AssistentePessoal
curl -s http://<ip-interno>:7777/api/health
docker inspect assistente-pessoal --format '{{.State.Health.Status}} restarts={{.RestartCount}}'
docker logs --tail 100 assistente-pessoal
sqlite3 "file:data/jarvis.db?mode=ro" "PRAGMA integrity_check; PRAGMA user_version;"
ls -1dt /opt/laytech-ai/jarvis-data-backups/*/ | head -3
docker exec assistente-pessoal node -e 'const c=require(process.env.HOME+"/.agent-skills/catalog.json");console.log(c.totalSkills,c.bundled&&c.bundled.commit)'
```

Para telemetria autenticada, criar um token de serviço com apenas `skills:read` e usar
`GET /api/router/telemetry`; nunca colar o token em logs ou tickets.

## 6. Escalonamento

| Nível | Quem | Quando |
| --- | --- | --- |
| L1 | operador do host | health/restart/logs; tentativa de rollback documentada |
| L2 | mantenedor da aplicação | regressão de código, migração, corrupção de dados |
| L3 | dono do sistema | decisão de restore, exposição pública, credenciais e custo |

O dono é a única pessoa que aprova restauração sobre dados reais, rotação de credenciais e
mudanças de exposição pública.

## 7. Higiene de logs

- Nunca registrar prompt, resposta, e-mail, token, cookie, senha, chave ou URL com credenciais.
- A auditoria registra apenas metadados (ação, escopo, status, ids internos).
- Em incidente, preservar logs relevantes com permissão restrita e expurgar segredos antes de
  compartilhar.
