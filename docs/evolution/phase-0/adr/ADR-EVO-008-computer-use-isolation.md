# ADR-EVO-008 — Isolamento e fronteira de execução de computer-use

**Status:** PROPOSED (a fronteira é ACCEPTED como constraint; habilitar a capacidade exige
decisão do dono) · **Data:** 2026-10-30 · **Fase:** 0

## Contexto
Não existe automação GUI no sistema — o perímetro atual é shell allowlistado (`hostpolicy`) +
navegador isolado (worker sem rede, UDS, egress pinado — `server/browser.js`,
`scripts/browser-worker.mjs`). A referência Agent S (planner/grounding, verificação visual,
sandbox Landlock, Best-of-N) é research-grade e orientada a cloud (`07` §5).

## Problema
Definir a fronteira de uma futura execução GUI de forma que input sintético no host nunca vire
acesso irrestrito (TH-17), sem criar um subsistema de navegador concorrente ao que existe.

## Opções consideradas
1. Estender `run_command`/hostpolicy para comandos GUI (xdotool etc.).
2. Adotar o framework Agent S dentro do processo da API.
3. Fronteira própria: `ComputerUseExecutor` como perfil Compose isolado (padrão do browser
   worker), com planejamento no backend, execução em processo dedicado sem acesso ao banco,
   pós-condição visual com evidência e aprovação por ação.

## Decisão
Opção 3 como **fronteira desenhada** (`03` §3.7), com execução somente na Fase 5 e estado
inicial **desligado por padrão**. A automação de navegador continua sendo o worker Playwright
existente — computer-use **não** duplica navegação; só cobre GUI nativa (janelas, teclado, mouse).

## Racional
- O padrão do browser worker já provou o modelo: processo dedicado, transporte por socket
  privado, grants curtos emitidos pelo app, fail-closed, smoke de bypass (`tests/browser-*.test.mjs`,
  `docs/NAVEGADOR.md`).
- Input sintético no host é o maior aumento de superfície possível no sistema — por isso a
  decisão de habilitar é de produto, não técnica (PROPOSED), com default seguro.
- Agent S contribui apenas padrões (planner/executor separados, verificação visual, sandbox) —
  nenhum código (`07` §5).

## Consequências
- Positivas: fronteira explícita impede improvisos nas fases intermediárias; reuso do padrão
  provado.
- Negativas: capacidade diferida (aceito — mandato da Fase 0 proíbe novas capacidades autônomas
  no host).

## Implicações de segurança
Invariante I14 (`06` §3); cada ação com evidência visual (screenshot pós-condição) registrada no
ledger; sem acesso ao SQLite pelo executor.

## Alternativas rejeitadas
1 (GUI via shell não estruturado, sem pós-condição nem isolamento); 2 (dependências de
pesquisa, cloud-bound, sem isolamento adequado).

## Referências
`03` §3.7; `06` §2 (TH-17); `07` §5 (Agent S); `docs/NAVEGADOR.md`; `adr/ADR-EVO-001`.
