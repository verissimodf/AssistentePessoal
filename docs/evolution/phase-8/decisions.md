# Decisões Técnicas — Fase 8 (ADRs)

## ADR IF-001 — Adaptadores como registro em código; instâncias no banco

**Contexto**: §6 exige definição/instância separadas sem infraestrutura paralela.
**Decisão**: definições (ADAPTERS, providers de calendário) vivem em CÓDIGO — o cliente
nunca registra definição; instâncias (`if_integrations`) são linhas por admin com
config validada no backend.
**Consequência**: catálogo auditável por diff; sem injeção de adaptador via runtime.

## ADR IF-002 — Webhook ingress público com HMAC próprio (não Svix)

**Contexto**: §7 exige assinatura genérica; o repo já tem um webhook Svix (agentmail)
com segredo administrativo único.
**Decisão**: ingress genérico com HMAC-SHA256 POR PRODUTOR (segredo AES-256-GCM),
timestamp em segundos com janela ±5 min, comparação em tempo constante, corpo BRUTO.
**Consequência**: produtores autogerenciáveis por integração; o padrão Svix existente
fica intocado.

## ADR IF-003 — Contrato canônico com versionamento restrito

**Contexto**: §8 pede schema versioning e rejeição de versões desconhecidas.
**Decisão**: whitelist explícita (`"1", "1.0", "1.1"`) — versão nova exige deploy;
campos de confiança do corpo são sempre descartados.
**Consequência**: compatibilidade controlada; impossível autopromoção de confiança.

## ADR IF-004 — Calendário: provider abstrato; google implementado, funcional só com OAuth real

**Contexto**: §9.2 — priorizar providers com API oficial; sem credenciais, usar provider
de teste identificado e documentar habilitação.
**Decisão**: interface `registerCalendarProvider`; `fixture` (testOnly) demonstra o
fluxo; `google` implementa a API v3 REST oficial sobre `oauth_connections` existente —
sem conexão real: `cal_oauth_not_connected` (nunca simula).
**Consequência**: nenhuma credencial nova; habilitação real é só conectar a conta.

## ADR IF-005 — Política de conflito: provider vence; sync somente leitura

**Contexto**: §9.3 — não sobrescrever alterações do usuário sem política explícita.
**Decisão**: nesta fase o fabric NÃO edita calendários (somente leitura) — o provider é
a fonte da verdade e não há alteração local que precise de resolução; conflitos
(sobreposições) são DETECTADOS e expostos para o Proactive Engine recomendar.
**Consequência**: zero risco de perda de dados do usuário; escrita no calendário fica
para evolução com D9.

## ADR IF-006 — DST: hora inexistente avança 1 h; ambígua usa a primeira

**Contexto**: §10.1 — recorrências locais em transições DST.
**Decisão**: conversão por ponto fixo iterativo (`naive - offset(t)`); não-convergência
(hora inexistente) → último candidato + 1 h (determinístico); ambiguidade → primeira
ocorrência (horário padrão); timezone inválida → fail-closed.
**Consequência**: 09:00 local preservado entre offsets (testado com Berlin CEST/CET);
sem dupla execução e sem perda silenciosa.

## ADR IF-007 — Drift: ocorrência atrasada > 1 h é descartada com motivo

**Contexto**: §10.2 — não executar expiradas sem política explícita.
**Decisão**: `max_occurrence_delay_ms` = 1 h global; atraso maior → ocorrência
DESCARTADA com `pr.occurrence_skipped/pr_occurrence_stale` auditado e re-agendamento a
partir de agora (sem drift cumulativo).
**Consequência**: sem execuções em rajada pós-queda; nada é perdido silenciosamente
(motivo registrado).

## ADR IF-008 — Credenciais: AES-256-GCM existente; segredo de produtor visto uma vez

**Contexto**: §13 — não duplicar armazenamento de credenciais.
**Decisão**: `secret-crypto` (AES-256-GCM, chave mestra fora do repo) para segredos de
produtor; OAuth de calendário usa `oauth_connections` existente; segredo exibido uma
única vez na criação.
**Consequência**: nenhum novo mecanismo de segredos; nenhuma credencial em logs/API.
