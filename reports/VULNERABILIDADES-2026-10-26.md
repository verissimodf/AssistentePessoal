# Vulnerabilidades e correções — 2026-10-26

Escopo: alertas abertos do Dependabot no repositório `verissimodf/AssistentePessoal` e correlação
com os lockfiles reais. Nenhum alerta foi inventado; a consulta foi feita via API do GitHub em
2026-10-26.

## 1. Alertas abertos (antes)

| # | GHSA | Pacote | Severidade | Direto? | Instalado | Faixa afetada | Corrigido em |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 11 | GHSA-8c8m-p3m8-cjg8 | `nodemailer` | medium (CVSS 6.5) | sim (`server/package-lock.json`) | 10.1.1 | `>=3.0.0, <10.1.4` | **10.1.4** |
| 10 | GHSA-m943-m63m-w62w | `nodemailer` | medium (CVSS 6.5) | sim | 10.1.1 | `>=3.0.0, <10.1.4` | **10.1.4** |
| 9 | GHSA-85x2-q946-cp5h | `nodemailer` | medium (CVSS 6.5) | sim | 10.1.1 | `>=3.0.0, <10.1.4` | **10.1.4** |

Os três são falhas do `addressparser` do Nodemailer (comentário aninhado, `;` dentro de grupo e
`>` em quoted local part) que podem fazer o envelope entregar em domínio diferente do validado.
O projeto usa Nodemailer em `server/comms.js` para envio de e-mail; o transporte real só é ativado
com `JARVIS_MAIL_TRANSPORT=imap` (atualmente ausente = mock), mas a dependência está instalada no
runtime e o alerta é legítimo.

## 2. Correção aplicada (local, não commitada)

```text
server/package.json       nodemailer: ^10.1.0 -> 10.1.4 (exato)
server/package-lock.json  nodemailer 10.1.1 -> 10.1.4
```

Foi escolhida a **primeira versão corrigida** (10.1.4), não a latest (10.2.1), para minimizar
mudança de comportamento. Nenhuma outra dependência foi atualizada; nenhum `npm audit fix --force`
foi usado.

### Evidência

```text
$ (cd server && npm audit)
found 0 vulnerabilities
$ npm audit
found 0 vulnerabilities
```

| Antes | Depois |
| --- | --- |
| `server`: 1 moderate (nodemailer 10.1.1) | **0** |
| raiz: 0 | **0** |

### Testes executados após a correção

- `node --no-warnings --test tests/mail*.test.mjs tests/settings-comms-blank.test.mjs` — **93/93**
- suíte backend completa — ver relatório de encerramento (resultado final)
- `npx vitest run` — **109/109**
- `npm run build` — OK

## 3. Impacto e risco residual

- O envio real de e-mail está desabilitado (`JARVIS_MAIL_TRANSPORT` ausente); a exploração exige
  que o operador habilite envio real e passe endereços influenciados por terceiros.
- A correção está no working tree da branch `chore/jarvis-release-closure-178`, **sem commit,
  push ou deploy** nesta auditoria. O alerta do Dependabot continuará aberto até o commit e a
  publicação da imagem.
- A conta Gmail configurada falhou no IMAP (`authenticationFailed`); nenhum e-mail real foi
  enviado durante a auditoria.

## 4. Recomendação

1. Revisar o diff de `server/package.json`/lockfile.
2. Commitar em PR pequeno e aguardar CI (backend, frontend, container).
3. Construir imagem com os metadados de release e implantar; confirmar `npm audit` no container.
4. Fechar/verificar os três alertas no GitHub após o deploy.
