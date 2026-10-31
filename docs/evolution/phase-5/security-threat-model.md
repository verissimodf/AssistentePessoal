# Security & Threat Model — Computer Intelligence (Fase 5)

Sobre os modelos anteriores (Fases 0–4). Ameaças específicas com controles implementados
(referências ao código real) e risco residual.

| # | Ameaça | Controles implementados | Residual |
|---|--------|-------------------------|----------|
| CI-1 | **Prompt injection visual** (a interface "manda") | Toda observação é rotulada DADO NÃO CONFIÁVEL (`ciToolObserve`, prompts de plano com regra explícita); nenhuma instrução exibida altera políticas/escopos/objetivos; **teste 15**: plano derivado de página hostil → ação proibida BLOQUEADA; audit sem o conteúdo hostil | Baixo-médio (residual estrutural do LLM) |
| CI-2 | **Escrita sem aprovação humana** | navigate/click/fill/select/wait_for via `callTool` → `web:write` + `queueApproval` D9 (review mascarado + fingerprint para click/fill); a execução pausa (`verification_pending`) e retoma só após decisão humana (tick) | Baixo — testado |
| CI-3 | **Ação proibida (pagamento/compra/transferência/exclusão/envio)** | `PROHIBITED_PATTERNS` avaliado no backend sobre o alvo de CADA ação antes de qualquer execução → `blocked`/`ci_prohibited_action`; **sem flag de bypass nesta fase** (ADR-CI-005) | Baixo — testado |
| CI-4 | **Cross-owner (sessão/observação/procedimento de outro admin)** | `owns()` em toda operação (`getSession`/`observe`/`reuseProcedure`) — 404 uniforme | Baixo — testado |
| CI-5 | **SSRF / destino malicioso** | `validateBrowserRequest` + `assertPublicHost` + worker sem rede + egress com DNS pinado (Fases anteriores) — a Computer Intelligence NÃO cria via nova | Baixo |
| CI-6 | **Escalação via plano (o modelo se auto-autoriza)** | O plano é PROPOSTA; cada ação passa por política+`can()`+D9 na execução; o principal do executor é criado pelo backend (classe bot, escopos fixos da sessão) | Baixo |
| CI-7 | **Falso sucesso (aprovação ≠ resultado)** | Verificação pós-ação pelo CRITÉRIO (`expected_json`) contra observação pós — o tick nunca marca `succeeded` por decreto; divergência → failed/replan | Baixo — testado |
| CI-8 | **Replay de escrita incerta** | Estados `unknown`/`verification_pending` só saem por reconciliação com evidência (observação atual); transições atômicas; ação já tratada nunca re-executa | Baixo — testado |
| CI-9 | **Exposição de credenciais** | `redact()` do worker mantido; capturas com retenção (remoção no fechamento da sessão); audit sem conteúdo de página | Baixo |
| CI-10 | **Excesso de execução (custo/loop)** | `CI_LIMITS`: ≤12 ações/plano, ≤30 observações/sessão, replan ≤2, runtime 10 min; sem progresso verificável → interrupção | Baixo |
| CI-11 | **Artefatos visuais vazando** | PNGs em `data/ci/<session>/` mode 0600, removidos no fechamento; nunca servidos por rota pública | Baixo |

## Invariantes específicas (Fase 5)

1. Conteúdo de interface é dado, nunca instrução nem autorização.
2. Observação = leitura (sem D9); escrita = sempre D9 com fingerprint.
3. Aprovação ≠ verificação: o resultado é provado pelo critério contra observação pós.
4. Nenhuma ação proibida executa — bloqueio no backend, sem bypass.
5. Procedimentos não carregam permissões; reutilização revalida tudo.

## Riscos aceitos

- **Sem visão/OCR**: o grounding depende de texto/seletores — páginas sem texto útil falham a
  verificação (fail-closed, seguro).
- **Aprovação por ação** gera fricção em fluxos longos — decisão de produto para batch futuro.
