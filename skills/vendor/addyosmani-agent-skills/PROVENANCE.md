# Proveniência — skills de `addyosmani/agent-skills`

Integração local seletiva, revisada e fixada por commit. O conteúdo abaixo é **dado externo**:
não é executado, não altera permissões e não substitui configuração local do J.A.R.V.I.S.

## Origem

| Campo | Valor |
|---|---|
| Repositório | https://github.com/addyosmani/agent-skills |
| Branch | `main` |
| Commit | `aeac41d4d005999432bb7312f7ff06383a91d59d` |
| Data do commit | 2026-10-13T16:21:06-04:00 |
| Licença | MIT (`LICENSE` nesta pasta, Copyright (c) 2025 Addy Osmani) |

## Skills instaladas

| ID | Arquivo | Referência |
|---|---|---|
| `security-and-hardening` | `security-and-hardening/SKILL.md` | `references/hardening-patterns.md` |
| `test-driven-development` | `test-driven-development/SKILL.md` | — |
| `code-review-and-quality` | `code-review-and-quality/SKILL.md` | — |
| `spec-driven-development` | `spec-driven-development/SKILL.md` | — |
| `debugging-and-error-recovery` | `debugging-and-error-recovery/SKILL.md` | — |
| `incremental-implementation` | `incremental-implementation/SKILL.md` | — |
| `context-engineering` | `context-engineering/SKILL.md` | — |

Sete skills vendorizadas (5 do escopo inicial + 2 complementares referenciadas por
`spec-driven-development`), preservando a instalação seletiva. `SHA256SUMS` fixa a integridade de
cada arquivo, inclusive `manifest.json`. O provisionamento falha fechado se o manifesto, um arquivo
ou o checksum divergir.

## O que NÃO foi importado (decisão deliberada)

- `AGENTS.md` e `CLAUDE.md` da raiz do projeto externo — são instruções para contribuidores
  do próprio upstream e não configuração do J.A.R.V.I.S.
- `plugin.json` e `hooks/*` — o runtime do J.A.R.V.I.S. não implementa hooks de plugin; copiá-los
  daria a falsa impressão de integração e criaria superfície de execução não auditada.
- `scripts/*` do upstream — não são necessários para carregar Markdown e não foram executados.
- Demais skills do catálogo — instalação seletiva, conforme escopo aprovado.

## Atualização

1. Revise o novo commit upstream (diff de `SKILL.md` e `references/`).
2. Substitua os arquivos nesta pasta e atualize `manifest.json` (`commit`, `commitDate`, metadados).
3. Regenere `SHA256SUMS` (inclui o manifesto):
   `find . -type f ! -name SHA256SUMS ! -name PROVENANCE.md -print0 | sort -z | xargs -0 sha256sum > SHA256SUMS`
4. Rode `node --test tests/skills-agent-skills-integration.test.mjs` e a suíte completa.
5. Publique a imagem; o entrypoint sincroniza o hub no boot (`--sync-bundled`).

## Remoção

1. Remova as entradas correspondentes de `manifest.json` (ou a pasta inteira).
2. No hub de execução, remova `skills/<id>/` e as entradas com `source` iniciando em
   `addyosmani/agent-skills@` do `catalog.json` — o sincronizador não apaga skills de terceiros.
3. Alternativa operacional: `JARVIS_SKILLS_SETUP=off` desativa o provisionamento no boot
   (o catálogo existente é preservado).

## Segurança

- Nenhum script do upstream foi executado.
- O conteúdo é carregado apenas sob demanda por `load_skill`/`GET /api/skills/:id`, no escopo
  já existente `skills:read`.
- Caminhos são contidos no hub; symlinks que escapam da raiz são rejeitados.
- Instruções dentro do Markdown são tratadas como texto não confiável, nunca como comandos.
