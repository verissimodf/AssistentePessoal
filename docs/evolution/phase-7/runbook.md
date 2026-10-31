# Runbook Operacional (Fase 7)

## Uso diário

1. Painel → aba **Proativo** (Proactive Studio).
2. Criar regra (nasce em `draft`) → definir gatilho (evento ou temporal), condições,
   workflow publicado alvo, limites → **Testar** (dry-run) → **Ativar**.
3. Nível padrão 1: oportunidades aparecem em **Oportunidades** com justificativa e
   evidências → aceitar/ignorar/adiar.
4. Para automação limitada: subir nível para 2 (Controls) e marcar a regra como
   `execution: auto` — a execução real segue as políticas; etapas protegidas param em
   D9 na UI de Aprovações.
5. **Pausa global** (Controls) interrompe novos disparos mantendo as regras intactas.

## Diagnóstico

- `GET /api/pr/metrics` — contagens reais do motor.
- `GET /api/pr/opportunities/:id/trail` — correlação completa de uma execução.
- Auditoria: `pr.*` (dono/ids/estados, sem conteúdo).
- Falha de automação: oportunidade `failed` com `decision_json.error` — códigos comuns:
  `wf_policy_denied` (política bloqueia), `wf_not_published` (definição não publicada),
  `wf_require_approval_unsupported`.

## Recuperação

- Reinício do serviço: `recoverProactive` + primeiro tick reconciliam oportunidades e
  reprocessam temporais vencidos UMA vez (dedupe por ocorrência) — nenhuma ação manual.
- Regra travada: pausar/desativar no Studio; transições inválidas respondem 409.
- Tempestade de eventos: teto 60/min por dono; investigar o produtor antes de elevar.

## Limites operacionais (defaults)

50 regras/dono · 50 oportunidades pendentes/dono · 5 pendentes/regra · 10 execuções/h
por regra · cooldown 60 s · 60 eventos/min/dono · 200 notificações/dono · tick 30 s.
