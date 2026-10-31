# Coordenação de Agentes — Fase 4

Como a investigação e o Learning usam a Workforce (Fase 1) e os one-shots internos.

## 1. O pipeline de pesquisa NÃO instancia agentes

O workflow auto-gerado contém apenas os 6 nós de pesquisa + `start`/`end` — nenhum nó `agent`
(`research.js:230-250`). A análise é feita por **one-shots internos** (§3). Agentes entram quando
o OPERADOR inclui nós `agent` em definições próprias (§2); o pipeline de pesquisa não os cria.

## 2. Workforce via definições do operador (Fase 1)

- Nós `agent` são um tipo nativo do Workflow Engine (`workflow.js:12-23`); qualquer definição do operador pode combiná-los com os nós de pesquisa registrados (`workflow.js:600-615` registra apenas os 6 de pesquisa).
- Delegação de nós `agent`/`subworkflow` passa pela Workforce com **interseção de escopos** e orçamento hierárquico (Fase 1); `workflowScopes` adiciona `workforce:run` quando há ferramentas declaradas (`workflow.js:55-64`).
- Especialistas sugeridos para definições do operador: **planner** (decompor a pergunta em subperguntas) e **analista** (revisar claims/conflitos) — criados como agentes/templates da Fase 1 pelo operador; a Fase 4 não empacota templates próprios.
- Ferramentas permitidas na definição de pesquisa: `["web_search","notebook_search"]` (`research.js:264`); escopos efetivos derivados via `TOOL_SCOPES` (`workflow.js:55-64`, `auth.js:67-69`).

## 3. One-shots internos (service principal escopado)

| Uso | Principal | runId de correlação |
|---|---|---|
| Plano (`generatePlan`) | `{type:"service", tokenId:"research", scopes:["kh:read","web"]}` (`research.js:50-58`) | `research-plan:<projectId>` |
| Extração de evidência | idem (`research.js:430-432`) | `research-ev:<sourceId>` |
| Síntese (claims/conflitos) | idem (`research.js:478-480`) | `research-syn:<projectId>` |
| Plano de aprendizagem | `{tokenId:"learning", scopes:["kh:read"]}` (`learning.js:28-36,171-176`) | `learn-plan:<projectId>` |
| Tutor / atividades / feedback | idem (`learning.js:198,224,290`) | `learn-tutor:*`, `learn-act:*`, `learn-fb:*` |

Propriedades do one-shot (`kh-oneshot.js:5-22`):
- UMA chamada de modelo: `maxSteps:1`, sem ferramentas (`tools:[]`, `maxToolCalls:1`) — sem loop de agência.
- Instrução de sistema fixa: responder só a partir dos trechos fornecidos, citar `[fonte, chunk N]`, declarar "Fontes insuficientes" se faltar evidência (`kh-oneshot.js:18-20`).
- Telemetria/fallback herdados do `runAgent` existente (Fase 2).

## 4. Resultados de modelo = dado não confiável

| Superfície | Tratamento |
|---|---|
| Conteúdo de página/Hub no prompt | marcado "DADO NÃO CONFIÁVEL" (`research.js:425,477`; `learning.js:120,194,226,292`) |
| Citações de evidência | validadas VERBATIM contra a fonte; inválidas rejeitadas (`research.js:443-446`) |
| Claims do modelo | só aceitos com referência a evidências numeradas existentes; status recalculado no servidor (`research.js:487-508`) |
| Citações de relatório | vêm dos registros de fonte, nunca do modelo (`research.js:531-552`) |
| Atividades | `type` validado contra allowlist; inválidas descartadas (`learning.js:212-219,236`) |

## 5. Testes

- Fixtures de one-shot determinísticos (plano/evidência/síntese/tutor): `tests/research-engine.test.mjs:102-147`, `tests/learning.test.mjs:27-106`.
- Injeção em conteúdo tratada como dado: `tests/research-security.test.mjs:182-189`.
