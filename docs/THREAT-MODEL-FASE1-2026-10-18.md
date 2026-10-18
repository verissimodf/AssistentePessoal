# Threat Model — Fase 1 (browser worker, skill registry) — 2026-10-18

Escopo: superfícies novas desta branch (`scripts/browser-worker.mjs`, `server/skill-registry.js`,
`skills/`, ajustes ao E2E). A superfície de produção (rotas, auth, MCP stdio, tools) não muda.

## Ativos

| Ativo | Onde |
| --- | --- |
| Banco de produção e `master.key` | `data/` (fora de alcance do worker por contrato + validação de caminhos) |
| Sessão/credenciais do proprietário | cookies de sessão, `test-credentials.env` (futuro) |
| Segredos de serviços (IMAP, Telegram…) | `global_settings` (AES-GCM) |
| Integridade da evidência de testes | ficheiros de evidência do worker |
| Chrome/CDP de outros projetos na máquina | processos alheios (Playwright em execução verificado) |

## Fronteiras de confiança

1. **Cenário de teste** (ficheiro JSON, confiável, escrito por agente/humano) ↔
   **conteúdo de página** (não confiável — pode conter injeção de prompt).
2. **Worker** (processo próprio) ↔ **Chrome** (processo filho sem sandbox extra, perfil
   descartável) ↔ **rede** (allowlist por pedido).
3. **Manifesto de skill** (revisável em PR) ↔ **allowlists do servidor** (mudam só com revisão
   humana) ↔ **execução futura** (não existe ainda).

## Caminhos de abuso e mitigações

| Ameaça | Mitigação (testada) | Teste |
| --- | --- | --- |
| Página instrui o agente a navegar/exfiltrar (prompt injection) | Página é dado; decisão só do cenário; texto marcado `UNTRUSTED`; subrecurso a metadados falhado na interceção | `browser-worker` integração 1 |
| Navegação/subrecurso a metadados de cloud (169.254.169.254, metadata.google.internal) | Negado **incondicionalmente**, mesmo em allowlist | unidades + integração 1 |
| Alcançar produção (127.0.0.1:7777, 192.168.2.40, tailnet) ou serviços alheios | Allowlist de origens exatas por tarefa; outra porta = outra origem = bloqueada | unidade "destinos" |
| Vazamento de segredos em evidência | `fill` nunca regista valores; query só com nomes; sem userinfo; segredo em falta ⇒ `blocked` | integração 2 |
| Worker pendurado / Chrome órfão | Relógio duro `totalTimeoutMs`; SIGTERM→SIGKILL; perfil removido; saída no prazo | integração 3 |
| Escalada de poder via manifesto de skill | Schema fechado; permissões ⊆ allowlist do servidor; ferramentas ⊆ `TOOL_DEFS`; rede ⊆ `urlpolicy`; MCPs rejeitados; `reviewState:"enabled"` rejeitado | `skill-registry` 14 |
| Skill ativa por omissão | Desativada por padrão; ativação = `approved` **e** `enabled.json` (lista humana) | `skill-registry` (estado) |
| Colateral em outros projetos (`pkill -f`, porta 9222 fixa) | E2E agora mata só o PID próprio e usa porta livre dinâmica | revisão do diff + E2E 8/8 |
| Segredos em memória de config do OpenCode (token do MCP jarvis) | Não reproduzido em docs/relatórios; recomendação: rotacionar se algum log o expuser | procedimento |

## Riscos aceites / residual

- O worker corre com o mesmo uid do utilizador (sem sandbox de SO): o controlo é o contrato
  (só lê cenário, só escreve evidência, caminhos validados) — não é uma barreira de kernel.
  Isolamento por container seria o passo natural seguinte se a confiança exigir.
- `--no-sandbox` do Chrome (herdado do E2E): aceite neste ambiente de CI/local; não usar em
  produção multiutilizador.
- A latência de ~25s na primeira navegação é absorvida por warm-up; se o ambiente piorar além
  de 70s, o warm-up falha e as etapas falham com evidência explícita (nunca falso sucesso).
- Heurística anti-autoaprovação de skills (identidade "agent/llm/bot" no `reviewed_by`) é
  defesa adicional, não prova de identidade — o controle real é a revisão em PR + `enabled.json`.
