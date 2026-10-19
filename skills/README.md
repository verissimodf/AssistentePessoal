# Skill Registry (núcleo) — Fase 1

Registro e **validação** de skills, sem execução. Este diretório é a fonte dos manifestos;
a lógica está em `server/skill-registry.js`. **Nada aqui tem poder por omissão** — uma skill só
fica ativa com revisão humana + ativação explícita, e mesmo assim a execução real (ainda por
implementar) terá de reutilizar as allowlists do servidor, nunca a interface.

## Ciclo de vida (estados separados)

```
draft  →  reviewed  →  approved          (manifesto, revisto por humano via PR)
                              ↓
              enabled.json (lista de ativação humana, por deploy)
                              ↓
                        ativa  (active: true)
```

- **Criação**: agente pode escrever um manifesto em `draft` (`skills/<id>.json`). Um `draft`
  nunca fica ativo, mesmo que alguém o coloque em `enabled.json`.
- **Revisão/aprovação**: humana, via PR. `reviewed`/`approved` exigem o bloco
  `review: { reviewed_by, approved_at, approval_ref }` — identidades de agente/LLM no
  `reviewed_by` são recusadas (heurística de defesa adicional; o controle real é o PR).
  `approved` é condição necessária mas **não suficiente**: a ativação é decisão humana à parte.
- **Ativação**: `skills/enabled.json` lista os ids aprovados a ativar neste deploy.
  Lista vazia (o padrão) = nada ativo.
- **Execução**: NÃO implementada nesta fase. O núcleo só valida e decide estado.

## Manifesto (`skills/<id>.json`)

Campos obrigatórios (schema fechado — campos desconhecidos rejeitados):

| campo | significado |
| --- | --- |
| `id`, `version` | identidade (semver) |
| `description` | o que faz, em frase |
| `inputs`, `outputs` | entradas/saídas com tipo |
| `dependencies` | pacotes externos (instalação nunca automática) |
| `permissions` | só as da allowlist do servidor (`KNOWN_PERMISSIONS`) |
| `allowedNetworkDestinations` | só http(s) públicos; privados/metadados bloqueados (urlpolicy) |
| `tools` | só ferramentas existentes no servidor (`TOOL_DEFS`) |
| `mcps` | rejeitados por agora (gateway de conectores = Fase F) |
| `execLimits` | `timeoutMs`/`maxCalls`/`maxOutputBytes` dentro dos bounds |
| `tests` | testes/critérios que a skill cumpre |
| `successCriteria` | como se prova o sucesso |
| `risk` | `low`/`medium`/`high` |
| `reviewState` | `draft`/`reviewed`/`approved` (nunca `enabled`) |

## Barreira de segurança pré-instalação

Skills de terceiros devem ser tratadas como conteúdo não confiável e analisadas **antes** de serem
copiadas para o catálogo, instaladas ou ativadas. O gate `server/skill-scanner.js` integra o CLI
NVIDIA SkillSpector (testado contra v2.13.0, licença Apache-2.0), sem executar a Skill candidata e
sem análise semântica por LLM por padrão.

**Ponto de receção:** `inspectCandidate(caminho, opções)` é o único ponto do fluxo onde uma
candidata é recebida e validada — antes de qualquer contato com `skills/`, `enabled.json` ou
qualquer mecanismo ativo. Candidatos dentro do catálogo ativo são recusados (só quarentena).

- O candidato deve estar em caminho local de quarentena: diretório com exatamente um `SKILL.md`,
  ficheiro `SKILL.md`, ou manifesto `.json` do registro (validado pelo schema fechado de
  `server/skill-registry.js`). URLs remotas não são passadas ao scanner — a aquisição/extração do
  pacote deve ocorrer antes, com limites de tamanho e proteção contra traversal/zip bombs.
- O gate calcula um **hash sha256 do artefato** (ficheiro ou árvore determinística), copia a
  candidata para quarentena descartável, confere que a cópia é idêntica ao original e corre o
  scanner estático **sobre a cópia** — a original nunca é tocada nem executada.
- O scanner é chamado sem shell, com tempo e saída limitados, sem credenciais do processo JARVIS
  (HOME/TMP temporários) e com `--no-llm --fail-on-incomplete`. (`--min-coverage` não existe no
  SkillSpector 2.13.0; a cobertura integral é verificada pelo `analysis_completeness` do relatório.)
- Resultados distintos: `passed` (SAFE, cobertura completa), `failed` (achados: `CAUTION` ou
  `DO_NOT_INSTALL`), `incomplete` (análise parcial — falha fechada) e `blocked` (scanner ausente,
  erro de processo, timeout, relatório malformado, veredito desconhecido, manifesto inválido).
  Falhar fechado é a regra: sem evidência válida não há aprovação.
- O veredito fica **vinculado ao hash** analisado e é preservado (0600) quando `reportsDir` é
  indicado. `verifyArtifactAgainstVerdict` recusa a instalação se o artefato mudou desde a análise
  (reeanálise obrigatória). O veredito guarda só a estrutura dos achados (id/severidade/local) —
  nunca trechos da candidata; o relatório bruto só é preservado com `keepRawReport` explícito e é
  conteúdo sensível.
- A análise é uma barreira, não uma garantia. `passed` NÃO concede permissões, não ativa a Skill
  e não autoriza execução: continuam obrigatórios o manifesto fechado, allowlists do servidor
  (`KNOWN_PERMISSIONS`, `TOOL_DEFS`, urlpolicy), revisão humana independente (PR) e ativação
  explícita por `enabled.json`. Scanner SAFE sem lista humana de ativação = nada ativo.
- O scanner não é instalado automaticamente pelo JARVIS. Instalação isolada e fixada por conta
  própria: `uv tool install 'git+https://github.com/NVIDIA/SkillSpector.git@v2.13.0'`. Configure
  `JARVIS_SKILLSPECTOR_BIN` se o executável não estiver no `PATH`; a ausência do scanner falha
  fechada.
- Ainda fora do escopo implementado: o gate não está ligado a nenhuma operação de instalação
  (não há instalação de Skills nesta fase), e a análise semântica por LLM do SkillSpector fica
  desligada por padrão. Não ativar Skills externas até a integração estar ligada e testada.

### Recepção HTTP em quarentena (primeira integração)

A rota administrativa `POST /api/skills/inspect` recebe um único campo multipart `file` cujo nome deve ser `SKILL.md`. Exige sessão administrativa verificada e CSRF; o tamanho é limitado por `JARVIS_MAX_UPLOAD`. O ficheiro é gravado com permissões restritas numa pasta temporária sob o diretório de dados, analisado e removido em `finally`.

A rota devolve apenas um resumo do veredito e regista metadados mínimos na auditoria. O veredito estruturado é preservado em `data/skill-verdicts/` quando possível. A rota **não instala, não copia para `skills/`, não altera `enabled.json` e nunca autoriza execução**. `passed` significa apenas que a análise estática passou; revisão humana e ativação explícita continuam separadas. Aquisição remota, extração de pacotes e UI continuam fora do escopo.

## Por que é seguro por omissão

- Um manifesto **não pode** declarar ferramenta inexistente, permissão fora da allowlist,
  destino privado/de metadados, MCP não registado, nem limites fora dos bounds — a validação
  falha e o `loadSkillDir` reporta o erro por ficheiro.
- Conteúdo gerado por LLM não concede poder: as allowlists (permissões/ferramentas/rede) vivem
  no **servidor** (`server/skill-registry.js`, `server/tools.js`, `server/urlpolicy.js`) e
  mudam só com revisão humana.
- `reviewState: "enabled"` no manifesto é rejeitado — ativação nunca é autoconcedida.

## Exemplo

`smoke-painel-sem-sessao.json` — draft, zero permissões, zero rede externa, risco `low`.
