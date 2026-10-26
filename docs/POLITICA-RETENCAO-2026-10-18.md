# Proposta de política de retenção — P0.3 (2026-10-18)

**Documento de proposta.** Nenhum expurgo foi executado, nenhum backup foi removido e nenhum
período foi aplicado. A definição e a execução dependem de autorização do dono (§6).

## 1. Classificação dos dados

| Conjunto | Onde vive | Classificação | Perda = |
| --- | --- | --- | --- |
| Banco principal | `data/jarvis.db` (+ WAL/SHM) | **Sensível** (dados pessoais, configurações, memórias, aprovações, sessões) | perda de estado operacional |
| Master.key | `data/master.key` (600) | **Crítica/irrestritiva** | **perda permanente e irreversível de todos os segredos encriptados** |
| Backups automáticos | `data/backups/jarvis-*.db` (700) | **Sensível** (cópias integrais do banco) | perda da capacidade de rollback |
| Auditoria | tabela `audit` | **Sensível-metadados** (ações, donos, rotas; nunca segredos) | perda de rastreabilidade |
| Evidências de execução | tabela `runs`/evidências associadas | **Sensível** (saídas de ferramentas, identificadores de provedor) | perda de auditabilidade das operações |
| Logs do contentor | `docker logs` (rotação do motor) | **Operacional** | perda de diagnóstico |
| Ecrãs E2E/ensaios | `/tmp/opencode/*` | **Operacional** (podem conter nomes de utilizador de teste) | perda de evidência de ensaio |

## 2. Períodos propostos

| Conjunto | Retenção proposta | Notas |
| --- | --- | --- |
| Banco principal | enquanto o serviço existir | nunca expurgar rotineiramente |
| Backups automáticos | **últimos 20 ficheiros OU 90 dias** (o critério que for atingido primeiro), com **mínimo de 3 cópias** (1 local, 1 offline) | os dois backups pré-migração atuais só saem com autorização explícita |

> **Estado em 2026-10-26:** a implementação atual (`deploy/backup-data.sh`) mantém **7** backups locais e não tem cópia offline. A meta 20/90 + off-host continua sendo **proposta**, não aplicada.
| master.key | **indefinida** | nunca expurgar; guarda offline cifrada, fora da máquina, com cópia registada por hash |
| Auditoria | **365 dias** em detalhe; depois agregação (contagens por ação/mês) e remoção do detalhe | preserva rastreabilidade sem manter detalhe vivo |
| Evidências de execução | **180 dias** | inclui `provider_message_id`/`conversation_id` (identificadores continuam em auditoria agregada) |
| Logs do contentor | 14 dias (ou rotação do motor, o que for menor) | nunca conter segredos (já garantido por sanitização) |
| Ecrãs/ensaios em `/tmp` | **30 dias**, depois remoção | contêm só dados de teste descartáveis |

## 3. Responsáveis

- **Definição da política:** dono do sistema (único administrador proprietário dos dados).
- **Execução de expurgo:** dono, ou operador com autorização escrita por execução.
- **Validação de restauração:** quem executar o ensaio, registando data, hash do backup e
  resultado no relatório de continuidade.

## 4. Critérios de expurgo

1. Expurgo **nunca automático**: cada execução exige confirmação explícita e registo em auditoria.
2. Antes de remover qualquer backup: registar **SHA-256, tamanho e data** do ficheiro removido
   (preserva a cadeia de evidência).
3. Nunca remover: a master.key, o banco vivo, o backup mais recente, o backup imediatamente
   anterior a uma migração ainda não consolidada (≥ 2 arranques limpos + ensaio de restauração).
4. Exclusão segura: remoção do ficheiro + atualização do inventário; `VACUUM`/reescrita apenas
   com o serviço parado.
5. Conteúdo encriptado com a master.key pode ser expurgado quando o respetivo objeto já não tem
   utilidade operacional — a master.key **não**.

## 5. Validação de restauração

- **Ensaio trimestral** em cópia isolada, conforme `docs/RECUPERACAO.md`: copiar banco **e**
  master.key para diretório temporário, arrancar o serviço isolado, confirmar
  `integrity_check=ok`, login e migração automática, e confirmar que a fonte ficou intacta.
- Registrar: data, ficheiro restaurado, SHA-256, resultado. Ensaios já realizados:
  2026-10-18 (positivo e **negativo sem master.key** — o serviço não sobe).
- Restauração em máquina nova: exigir cópia **offline** da master.key; sem ela a restauração é
  inútil para dados cifrados.

## 6. Autorizações pendentes (quem precisa de as fornecer)

| Autorização | Quem decide | Bloqueia |
| --- | --- | --- |
| Deploy/re-imagem e migração v11 em produção | dono | §5–§9 do runbook |
| Credenciais de teste dedicadas para smoke autenticado | dono | §6 do runbook |
| Aplicar/ajustar esta política de retenção | dono | qualquer expurgo futuro |
| Remoção de backups (inclusive os dois pré-migração atuais) | dono | — |
| Incluir a master.key no conjunto de backup automatizado (recomendado: sim, com 600 e fora da máquina) | dono | — |
| Aperto de permissões: `data/` de 750 → 700 | dono | — |

## 7. Preservação de evidências históricas

- SHA-256 dos backups existentes registados em `docs/RUNBOOK-RELEASE-2026-10-18.md` §3.
- Hashes, digests de imagem e resultados de ensaio deste release ficam registados no relatório
  P0.3 e não devem ser reescritos por expurgos.
- Qualquer expurgo futuro deve anexar o registo (quando, quê, hash, quem autorizou) a este
  documento ou ao relatório de continuidade.
