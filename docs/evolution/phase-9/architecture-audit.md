# Auditoria Arquitetural — Fase 9

Esta auditoria cobriu integralmente o backend (`server/`), o painel (`src/`) e os
testes (`tests/`). Cada seção lista o achado, a evidência e a disposição.

## 1. Duplicações de código

| Achado | Evidência | Disposição |
|---|---|---|
| `parseJson` duplicado em **10 cópias** | busca textual em `server/*.js` | **CORRIGIDO** — consolidado em `server/util.js`, comportamento idêntico, regressão integral (848/848) verde |
| `clean` duplicado em **9 cópias** | busca textual em `server/*.js` | **CORRIGIDO** — consolidado em `server/util.js` |
| `sha256` duplicado em **5 cópias** | busca textual | **DÍVIDA DOCUMENTADA** — risco baixo (função pura e estável); ver [limitations.md](limitations.md) |

## 2. Ciclos de dependência estáticos

A análise do grafo de imports encontrou **um único ciclo real**: `bots.js` ↔ `jobs.js`
(ambos importavam um do outro no top-level).

**Correção**: o runner passou a ser injetado via `setBotRunner` em `server/bots.js`,
com semântica **FIRST-WINS** — o primeiro binding vence e permanece, replicando a
semântica do binding estático antigo; reimports em testes não trocam o runner.

**Estado final**: zero ciclos estáticos após a correção (verificado por varredura de
imports e pela suíte integral verde).

## 3. Contratos de erro

**Achado corrigido**: `server/stt.js` lançava `MailError` — acoplamento falso
STT→mail que fazia o choke point tratar erro de STT como erro de mail. Criada a
classe `SttError` própria, mantendo os **mesmos códigos estáveis** já expostos.

**Achado remanescente (dívida)**: coexistem **3 estilos de contrato de erro** entre
módulos — classes tipadas (ex.: `SttError`), `Error` + mapa de códigos, e retorno
`{ error }`. O choke point único em `server/index.js` normaliza os três via
duck-typing. Corrigir a unificação exigiria tocar módulos estáveis de 6 fases —
risco > benefício na consolidação. Ver [limitations.md](limitations.md).

## 4. Bug real funcional (Fase 8)

`recordExternalEvent` (Integration Fabric, Fase 8) avaliava apenas a **primeira regra
que casava** com o evento. Consequência: o cooldown de uma regra bloqueava as regras
irmãs que reagiriam ao mesmo evento — dependência de ordem de avaliação.

**Correção**: o avaliador agora processa **todas** as regras que casam. O bug só foi
exposto pela migração v28 (novo plano de índices/queries), e o teste de regressão
**nº 36 em `tests/integrations.test.mjs`** cobre o cenário irmãs+cooldown.

## 5. `server/index.js` (choke point)

`index.js` está com **2.772 linhas**. É o único ponto de declaração de acesso de
rotas (`access`), autenticação e autorização — isso é um **ativo** (single choke
point, asserido por `tests/http-auth.test.mjs`), mas o tamanho é dívida. Extraí-lo
envolveria reescrever o arquivo mais crítico da plataforma durante uma consolidação —
adiado com justificativa. Ver [limitations.md](limitations.md).

## 6. Testes

- ~93 arquivos de teste em `tests/`; **848/848** verdes (847 + 1 regressão F9).
- Higiene: 0 usos de `.only`; 5 skips, todos legítimos (ver
  [test-report.md](test-report.md)).
- Gap identificado: não há teste dedicado que falhe sem a correção de irmãs — coberto
  pelo teste de regressão nº 36; a v28, ao alterar o plano de queries, era o cenário
  em que o bug se manifestaria.

## 7. Dead code

| Item | Origem | Disposição |
|---|---|---|
| `TURN_STATES` | multimodal (Fase 6) | **REMOVIDO** |
| `treeVerification` | workforce (Fase 1) | **REMOVIDO** |
| 28 componentes UI em `src/components/ui/` | base pré-existente / fases | **REMOVIDOS** (sem importação viva) |
| 25 dependências mortas | `package.json` / `server/package.json` | **REMOVIDAS**: `recharts`, `react-day-picker`, `cmdk`, `react-hook-form`, `@hookform/resolvers`, `vaul`, `embla-carousel-react`, `dotenv` (server) e ~18 pacotes `@radix-ui/*` |

## 8. Documentação

Documentação das fases 0–8 mantida **intocada** (regra da F9). A F9 acrescenta a
própria série em `docs/evolution/phase-9/` e o índice central
[../README.md](../README.md).

## 9. Índices e queries

Os ticks periódicos de 15–60 s (fases 5–8: proactive, integrations, multimodal,
computer, workflow) faziam **full scan** com o crescimento das tabelas. A migração
**v28 (aditiva, somente CREATE INDEX)** adicionou 12 índices — detalhes em
[data-migrations-audit.md](data-migrations-audit.md) e
[performance-report.md](performance-report.md).

## 10. Estilos e convenções

- Backend consistente: módulos Node 22 ESM, `node:sqlite` sem deps nativas, rotas
  declarando `access` no choke point.
- Frontend consistente: React/Vite/TanStack, painel falando só com o backend via
  `src/lib/bridge.ts` (com fallback demo em localStorage).
- Inconsistência conhecida: os 3 estilos de contrato de erro (seção 3) — dívida
  documentada, não corrigida.

## Conclusão

A auditoria corrigiu o que era de baixo risco e alto valor (duplicações, ciclo,
contrato de erro falso, bug funcional, índices, dead code) e **documentou** o que
tinha risco desproporcional para uma fase de consolidação (unificação de contratos de
erro, extração do `index.js`, `sha256`, `khSearch` multi-donor). Nenhum achado ficou
sem disposição explícita: corrigido ou documentado em [limitations.md](limitations.md).
