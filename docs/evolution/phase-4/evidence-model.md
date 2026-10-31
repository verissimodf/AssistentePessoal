# Modelo de Evidências — Fase 4

Tabelas: `research_sources`, `research_evidence`, `research_claims`, `research_conflicts`
(`migrations.js:1363-1424`). Motor: `server/research.js`. ADR-RS-003.

## 1. `research_sources` (fonte)

| Campo | Valores |
|---|---|
| `origin` | `web` \| `hub` \| `memory` (CHECK `migrations.js:1367`); o código produz `hub` (`research.js:299-307`) e `web` (`research.js:330-339`); `memory` existe no esquema, não é produzido hoje |
| `url`/`canonical_url` | URL bruta/canonializada (web); hub tem `url:""` (`research.js:302`) |
| `domain` | hostname sem `www.`; fonte hub → `""` (testado `tests/research-engine.test.mjs:240-242`) |
| `content_hash` | SHA-256 do conteúdo (ou da URL quando sem conteúdo) — chave de dedupe (`research.js:353-357`) |
| `quality` | `full` \| `partial` \| `snippet_only` \| `failed` (`migrations.js:1375`) |
| `metadata_json` | ex.: `{provider}` (web), `{document_id, chunk_id, citation}` (hub) (`research.js:305,337`) |
| `fetched_at` | preenchido na recuperação (`research.js:397-406`) |

## 2. `research_evidence` (evidência)

| Campo | Valores |
|---|---|
| `source_id` | referência à fonte (FK cascade) |
| `quote` | trecho VERBATIM ≤500 chars, **validado no servidor** (§3) |
| `location` | seção/aproximação declarada ≤200 chars |
| `type` | CHECK: `direct` \| `indirect` \| `inference` \| `hypothesis` \| `gap` (`migrations.js:1389`); o extrator grava apenas `direct`/`indirect` — default `indirect` (`research.js:447`) |

## 3. Citação VERBATIM validada (ADR-RS-003)

- Normalização whitespace/case (`norm`, `research.js:36-40`); a citação só entra se existir dentro do conteúdo real da fonte: `norm(src.content).includes(norm(quote))` (`research.js:443-446`).
- Citação alucinada → rejeitada (`rejected++`), contada e auditada (`audit research.evidence` com `rejected:N`, `research.js:454-459`).
- Impossível citar trecho inexistente via pipeline; síntese ainda pode interpretar mal — revisão humana do relatório é o controle final (`security-threat-model.md` P4-3).
- Testes que provam a rejeição: `tests/research-engine.test.mjs:113-128,174-181`; `tests/research-security.test.mjs:89-101,173-175`.

## 4. `research_claims` (afirmação)

| Campo | Valores |
|---|---|
| `statement` | ≤1000 chars |
| `evidence_ids` | array de ids de evidência existentes; referências do modelo mapeadas por índice `[n]` (`research.js:488-491`) |
| `status` | CHECK `supported` \| `unsupported` \| `contested` \| `inferred` (`migrations.js:1400`); o código grava `supported` quando há evidência `direct` vinculada, senão respeita `supported|inferred` do modelo com default `inferred` (`research.js:492-505`) |

## 5. `research_conflicts` (conflito)

| Campo | Valores |
|---|---|
| `claim_a_id`/`claim_b_id` | claims em conflito (podem ser `null` se o modelo não referenciou claim válida, `research.js:516-517`) |
| `description` | ≤1000 chars, declarada pela síntese |
| `resolution` | CHECK `unresolved` \| `resolved_a` \| `resolved_b` \| `insufficient` (`migrations.js:1411`); **o código nunca resolve** — default permanente `unresolved` (ver `source-evaluation.md`) |

## 6. Origem nunca misturada

- Proveniência é coluna da fonte; a síntese recebe cada evidência com `(origin/type)` no prompt (`research.js:466-477`) e as citações do relatório carregam `origin` (`research.js:545-552`).
- Invariante: "Origem de cada evidência é registrada e nunca misturada (web ≠ hub ≠ memória)" (`security-threat-model.md` §Invariantes 4).
