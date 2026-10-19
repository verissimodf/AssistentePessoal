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
copiadas para o catálogo, instaladas ou ativadas. O adaptador `server/skill-scanner.js` integra o
CLI NVIDIA SkillSpector, sem executar a Skill candidata e sem análise semântica por LLM por padrão.

- O candidato deve estar em diretório local de quarentena e conter `SKILL.md`; URLs remotas não são
  passadas diretamente ao scanner. Aquisição e extração do pacote precisam ocorrer separadamente,
  com limites de tamanho e proteção contra traversal/zip bombs.
- O scanner é chamado sem shell, com tempo e saída limitados, sem credenciais do processo JARVIS e
  com `--no-llm --fail-on-incomplete --min-coverage 100`.
- `SAFE` com saída zero permite prosseguir para as próximas validações; `CAUTION` exige revisão
  humana e não permite instalação automática; `DO_NOT_INSTALL`, scanner ausente, erro, cobertura
  incompleta, JSON inválido ou código de saída diferente de zero bloqueiam.
- A análise é uma barreira, não uma garantia. Ainda são obrigatórios o manifesto fechado, allowlists
  do servidor, revisão humana, permissões mínimas, integridade do artefato e execução isolada.
- O scanner não é instalado automaticamente pelo JARVIS. Configure `JARVIS_SKILLSPECTOR_BIN` se o
  executável não estiver no `PATH`; a ausência do scanner falha fechada.
- O adaptador ainda não está ligado a uma operação de instalação: o registro atual trabalha com
  manifestos JSON e a instalação/execução de bundles de Skills continua fora do escopo implementado.
  Não ativar Skills externas até essa integração estar ligada e testada.

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
