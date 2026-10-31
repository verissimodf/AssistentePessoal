# Relatório de Testes — Fase 9

## Números finais

| Suíte | Resultado |
|---|---|
| Backend (`tests/`, ~93 arquivos) | **848/848** (847 + 1 regressão nova da F9) |
| Frontend | **195/195** |
| Eval de agentes (`npm run eval:agents`) | **6/6** |
| TypeScript (`tsc --noEmit`) | 0 erros |
| ESLint | 0 erros |

## Regressão nova da F9

**Teste nº 36 em `tests/integrations.test.mjs`**: garante que `recordExternalEvent`
avalia **todas** as regras que casam com um evento — o cooldown de uma regra não pode
bloquear as irmãs. Esse teste cobre o bug real da F8 corrigido nesta fase
([architecture-audit.md](architecture-audit.md) §4).

## Higiene

| Verificação | Estado |
|---|---|
| Usos de `.only` | **0** |
| Skips | **5**, todos legítimos (dependências externas ausentes no ambiente — ex.: serviços de voz/browser não em execução; cada skip documenta o motivo no próprio teste) |
| Testes dependentes de rede externa | nenhum na suíte padrão (fixtures locais) |

## Cobertura por domínio (principais suítes)

| Domínio | Suítes |
|---|---|
| Auth/authz | `auth`, `http-auth`, `cookie-secure`, `bots-authz`, `security-hardening`, `isolation` |
| Ownership | `isolation` + passos de cross-owner na demo final |
| Migrações | `migrations`, `migration-v2/v7-v8/v9/v11`, `kh-migration`, `wf-migration`, `workforce-migration` |
| Workforce | `workforce-core/security/migration`, `agent-audit`, `run-limits` |
| Knowledge Hub | `kh-core/security/migration/workforce`, `documents-rag` |
| Workflow/D9 | `wf-engine/security/migration`, `policies`, `approvals-actions`, `approval-correlation*`, `d-rec*` |
| Research/Learning | `research-engine/security`, `learning` |
| Computer/Browser | `computer`, `browser-tool`, `browser-egress-proxy`, `provider-*` |
| Multimodal | `multimodal`, `stt`, `voice-adapter-core`, `voice-tts` |
| Proativo | `proactive` |
| Integrações | `integrations`, `http-integration` |
| Base | `hostpolicy`, `urlpolicy*`, `secret-crypto`, `backup-guardrail`, `mail*`, `oauth`, `mcp`, etc. |

## Como executar

```bash
npm test              # backend 848/848
npm run eval:agents   # eval 6/6
npx tsc --noEmit      # tipos
npm run build         # frontend
```

## Nota sobre números pós-commit

Os números acima foram medidos na árvore de trabalho da F9 **antes do commit final**.
Após o commit e o build da imagem, re-executar a suíte no container e registrar o
resultado — comando em [build-image-report.md](build-image-report.md).
