# Configuração segura — Fase 1 (2026-10-18)

## §D — Credenciais de teste para o smoke autenticado (canal acordado com o dono)

O mecanismo de bootstrap só funciona em instalação nova (produção já tem admins), por isso o
canal para a conta de teste dedicada é um **ficheiro de owner-only**:

1. No painel, o dono cria uma conta de teste dedicada (utilizador + senha forte ≥12 chars).
   `MAX_ADMINS=2`: com o dono ativo, cabe **exatamente uma** conta extra.
2. O dono cria `data/test-credentials.env` com **modo 600**, contendo:
   ```
   TEST_ADMIN_USER=<utilizador>
   TEST_ADMIN_PASSWORD=<senha>
   ```
   (`chmod 600 data/test-credentials.env`). Nunca passar credenciais pelo prompt/chat.
3. O agente lê o ficheiro **sem o exibir** (variáveis de ambiente em memória), corre o smoke
   (login → `/api/auth/me` → `session_focus` GET/PUT → logout → 401) e **não grava** a senha em
   logs, evidências, commits ou relatórios.
4. A seguir, o dono apaga `data/test-credentials.env` e pode desativar a conta de teste no painel.

Verificação de isolamento entre admins (D.5): produzido com 1 identidade dedicada; o A/B entre
dois administradores é feito numa **cópia isolada** da base real (método já usado em 18/10),
sem tocar nas contas do dono (limite duro de 2 admins ativos).

## §Worker — uso e variáveis

```bash
node scripts/browser-worker.mjs \
  --scenario  /tmp/opencode/cenario.json \
  --evidence  /tmp/opencode/evidencia.json \
  [--chrome   /usr/bin/google-chrome]     # ou BROWSER_WORKER_CHROME
```

- Cenário: ver contrato no cabeçalho de `scripts/browser-worker.mjs` (`allowedOrigins` exatas,
  `limits` obrigatórios, `steps`, `secrets` por referência de variável de ambiente).
- Códigos de saída: 0 tudo `passed`; 1 houve `failed`/`blocked`/aborto; 2 falha de arranque;
  3 cenário/argumentos inválidos.
- Evidência: JSON com passo-a-passo, timestamps, URL redigida, `network.blocked` e resumo;
  diagnostico do Chrome (se houver) em `<evidencia>.chrome.log` à parte.
- Nota: a primeira navegação HTTP de cada instância do Chrome custa ~25s neste ambiente e é
  absorvida pelo warm-up; orçamentos por etapa não têm de prever isso.

## §E2E oficial

`bash scripts/e2e-navegador.sh` — instância isolada com porta CDP dinâmica (`E2E_CDP`);
encerra **apenas** os PIDs que criou (sem `pkill -f`): seguro com outros projetos na máquina.

## §Skills — operação (núcleo, sem execução)

- Criar: manifesto `skills/<id>.json` em `draft` (validar: `node -e` com `loadSkillDir` ou
  futuramente o CI).
- Rever/aprovar: humano via PR; preencher bloco `review` (`reviewed_by` humano, `approved_at`,
  `approval_ref` = PR/commit) e `reviewState: approved`.
- Ativar: adicionar o id a `skills/enabled.json` no deploy. Lista vazia = nada ativo.
- Revogar: remover da lista (e opcionalmente voltar a `draft`).
- Analisar candidata de terceiros (barreira pré-instalação): instalar o scanner isolado e fixado
  (`uv tool install 'git+https://github.com/NVIDIA/SkillSpector.git@v2.13.0'` — nunca automático)
  e correr `inspectCandidate(caminhoEmQuarentena)` de `server/skill-scanner.js`, com
  `JARVIS_SKILLSPECTOR_BIN` se fora do PATH. Só `passed` (com hash intacto verificado por
  `verifyArtifactAgainstVerdict`) segue para revisão humana — e mesmo assim não ativa nada.
  Scanner ausente/falho/malformado = bloqueado (fail closed); relatórios preservados em 0600 e
  tratados como sensíveis (podem conter trechos da candidata).

## §MCPs (Fase F, por implementar) — checklist de aprovação futura

Antes de ligar qualquer conector: registro explícito com transporte; segredos por referência;
allowlist de ferramentas com scopes mínimos por ferramenta e por admin; política de rede
(sem privados/metadados, `guardedLookup`); limites de tempo/chamadas/bytes/concorrência;
auditoria sem valores secretos; aprovação humana para efeitos externos; processo isolado e
revogável. Ferramentas descobertas nunca recebem autorização automática.

## §Segredos — regra permanente

Nenhum segredo (senha, token, cookie, chave) em logs, evidências, documentos ou commits.
Observado nesta máquina: existe um token de serviço do MCP `jarvis` no config do OpenCode —
não reproduzido em lado nenhum; se algum log o expuser, rotacionar no painel
(Configurações → Segurança).
