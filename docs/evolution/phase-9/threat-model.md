# Threat Model Consolidado — Fase 9

Consolidação dos threat models das fases 0–8 ([F0 §06](../phase-0/06-SECURITY-THREAT-MODEL.md),
[F8](../phase-8/security-threat-model.md)) com o estado pós-auditoria da F9.

## Ativos

| Ativo | Onde vive | Sensibilidade |
|---|---|---|
| Credenciais e segredos (OAuth, webhook, mail) | SQLite, AES-256-GCM (`secret-crypto`) | CRÍTICO |
| Dados pessoais locais (conversas, documentos, KH) | SQLite/FS local | ALTO |
| Capacidade de execução (host commands, browser, workflows) | `hostpolicy`, `computer.js`, `workflow.js` | CRÍTICO |
| Integridade da auditoria | tabelas de audit (append) | ALTO |
| Ownership/isolamento entre admins | tabela `ownership` imutável | ALTO |

## Fronteiras de confiança

1. **Internet ↔ Ingress HTTP** (6 rotas públicas; HMAC/Svix nas de webhook).
2. **Ingress ↔ Sessão autenticada** (SCOPES, deny-by-default, choke point único).
3. **Sessão ↔ Dados** (ownership por `owner_admin_id`; linhas alheias invisíveis).
4. **Conteúdo externo ↔ Executor** (KH, research, webhooks, mail: conteúdo é DADO).
5. **Backend ↔ Host/rede** (`hostpolicy`, egress policy, browser UDS isolado).

## Agentes de ameaça

| Agente | Capacidade assumida | Mitigações principais |
|---|---|---|
| Ataque anônimo na rede | qualquer pacote HTTP | 6 rotas públicas asseridas; HMAC + replay + janela de tempo; fail-closed OAuth; 401 em 218 rotas |
| Produtor de webhook comprometido | assina payloads válidos | assinatura autentica, **não autoriza**; eventos são dados; contrato canônico + validação de esquema |
| Conteúdo hostil (prompt injection) | texto malicioso em KH/research/mail/webhook | tratado como dado; citações verbatim validadas; testes adversariais (40+) |
| Admin legítimo curioso / cross-admin | sessão válida | ownership imutável; linhas alheias invisíveis; powers admin só via `isVerifiedAdmin()` |
| Malware no host local | acesso ao FS/banco | fora do modelo (assistente local, single-admin); segredos cifrados em repouso reduzem dano |

## Superfícies e controles por superfície

| Superfície | Controles | Evidência |
|---|---|---|
| Webhook ingress | HMAC-SHA256, segredo 1×, janela temporal, replay protection, rate limit, aceitação durável 202 | `tests/integrations.test.mjs`; demo-final-acceptance (aceito/rejeitado) |
| Auth/sessões | SCOPES, deny-by-default, cookies seguros, reset de primeiro acesso | `tests/auth.test.mjs`, `cookie-secure.test.mjs`, `reset-primeiro-acesso.test.mjs` |
| Workflows/D9 | `REQUIRE_APPROVAL`, Policy Engine, fingerprint, `resolveApproval` | `tests/wf-security.test.mjs`; demo (D9 real) |
| Browser/CI | UDS isolado, egress policy, hosts allowlist, D9 nativo | `tests/browser-tool.test.mjs`, `browser-egress-proxy.test.mjs` |
| KH/Research | URL policy, citação verbatim validada, escopo por owner | `tests/kh-security.test.mjs`, `research-security.test.mjs`, `urlpolicy.test.mjs` |
| Host commands | `hostpolicy.js` unit-testado | `tests/hostpolicy.test.mjs` |

## Registro de riscos (todos com disposição)

| ID | Risco | Sev. | Disposição |
|---|---|---|---|
| R1 | `khSearch` filtra escopo no JS pós-FTS (recall multi-donor) | **MEDIUM** | ACEITADO/documentado — hoje single-admin local, risco operacional baixo; correção exigiria reescrever a query FTS ([limitations.md](limitations.md)) |
| R2 | 3 estilos de contrato de erro entre módulos | **LOW** | ACEITADO — normalização por duck-typing no choke point; unificação adiada (risco > benefício) |
| R3 | `index.js` 2.772 linhas (choke point não extraído) | **LOW** | ACEITADO — é o ativo de segurança central; extração adiada |
| R4 | `sha256` duplicado 5× | **LOW** | ACEITADO — função pura e estável |
| R5 | N+1 pontuais em datasets pequenos | **LOW** | ACEITADO — sem impacto mensurável no perfil single-admin |
| R6 | Google Calendar sem OAuth real (não exercido em runtime) | **MEDIUM** | PENDENTE DE CREDENCIAL do operador — indisponibilidade explícita (`cal_oauth_not_connected`) |
| R7 | STT sem serviço em execução no ambiente | **MEDIUM** | PENDENTE DE INFRAESTRUTURA — cadeia implementada e testada com fixture; indisponibilidade explícita |
| R8 | Sem monitoramento/backup externos ao processo | **MEDIUM** | Tratado em [contingency.md](contingency.md) e [production-readiness.md](production-readiness.md) — requer ambiente de destino |
| R9 | Webhook outbound ausente | **INFO** | FORA DO ESCOPO (decisão declarada na F8) |
| R10 | Avatar sem lip-sync | **INFO** | Decisão de design honesta (animação por estado) |

**Nenhum risco CRITICAL ou HIGH aberto.** Todos os MEDIUM têm tratamento ou
condição explícita de fechamento; os LOW são aceitos com justificativa.
