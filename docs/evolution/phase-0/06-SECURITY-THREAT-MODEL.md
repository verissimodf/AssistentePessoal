# 06 — Modelo de Ameaças (STRIDE + Privacidade)

Análise da arquitetura-alvo (`03`) sobre os limites de confiança reais (`02` §5). Metodologia:
STRIDE por limite de confiança, com 20 cenários de ataque obrigatórios do mandato. Severidades:
CRITICAL/HIGH/MEDIUM/LOW. **Nenhum controle existente é enfraquecido**; lacunas viram requisitos
de fase posterior (backlog `08`).

## 1. Limites de confiança mapeados

| # | Limite | Fronteira | Ator externo ao limite |
|---|---|---|---|
| B1 | Usuário/admin ↔ API pública | Cloudflare/Nginx → choke point `index.js:1270` | Humano (credenciais) |
| B2 | Principal tipado ↔ backend | bots/tokens `jst_`/futuro AgentRun → `can()` deny-by-default | Agente (não-confiável p/ autorização) |
| B3 | Modelo LLM ↔ backend | saída do modelo = dado, nunca autorização | Provider (pode ser remoto) |
| B4 | Dado externo ↔ backend | documentos, web, e-mails, skills, MCP | Conteúdo hostil |
| B5 | Worker de navegador ↔ app | UDS privado + broker egress pinado | Site visitado |
| B6 | Host ↔ backend | `hostpolicy` allowlist + aprovação | Execução de comandos |
| B7 | Futuro computer-use ↔ host | sessão isolada + grants curtos (desenho, `adr/ADR-EVO-008`) | GUI do sistema |
| B8 | Persistência ↔ segredos | AES-256-GCM + `master.key` 600 | Leitura do disco |
| B9 | Integrações externas ↔ backend | AgentMail (Svix), OAuth PKCE, canais | Provedor remoto |

## 2. Cenários de ameaça

Formato: ID — cenário (STRIDE) · severidade · caminho de ataque · controles existentes ·
controles requeridos · risco residual.

### TH-01 — Injeção de prompt via documentos (B4, S/T) · **HIGH**
Documento ingestido contém instruções hostis que o modelo executa. **Existentes:** dado marcado
untrusted, guarda anti-injeção p/ conteúdo web (`llm.js:335`), corpus de avaliação de injeção
(`eval:agents`). **Requeridos:** guarda generalizada a **todo** conteúdo externo (skills, e-mail,
Gigabrain); testes de injeção no corpus da Fase 2. **Residual:** baixo-médio — modelo pode
agir por prompt mesmo com marcação; contenção é que toda ação externa continua sob D9.

### TH-02 — Injeção de prompt via sites (B4/B5, S/T) · **HIGH**
Página raspada por `web_search`/navegador instrui o agente. **Existentes:** UNTRUSTED
(`tools.js:249`), worker sem rede, egress pinado. **Requeridos:** igual TH-01; extrair
conclusões em envelope estruturado (Fase 4). **Residual:** baixo-médio.

### TH-03 — Skill maliciosa como fonte de instruções (B4, T/E) · **MEDIUM**
Skill de terceiros com instruções prejudiciais carregada no contexto. **Existentes:**
confinamento de caminho/realpath (`skills.js:197-240`), cap 2 MB, catálogo offline,
checksum no provisionamento. **Requeridos:** verificação de checksum **em runtime**
(`load_skill`), marcação untrusted do conteúdo, procedência obrigatória se skill virar
AgentDefinition (`adr/ADR-EVO-002`). **Residual:** baixo após controles.

### TH-04 — Ferramenta MCP comprometida (B4, S/T/R) · **MEDIUM**
MCP externo retorna dado venenoso ou pede ações. **Existentes:** MCP local repassa HTTP com
escopos no token (`mcp.js:1-8`); `callTool` revalida. **Requeridos:** manter MCP como fonte
não confiável; nunca expor approvals via MCP. **Residual:** baixo.

### TH-05 — Escalação de privilégio por agente (B2, E) · **CRITICAL**
Agente tenta conceder a si mesmo escopos ou editar seu definition em execução. **Existentes:**
`can()` bloqueia wildcard não-verificado (`auth.js:570-576`); principals só nascem de
`validateSession`/`validateServiceToken`/`botPrincipal`; choke point único. **Requeridos:**
AgentRun propaga principal do pai; mutação de `agent_definitions` só por rota de sessão
administrativa; testes de isolamento por fase. **Residual:** baixo (controle já cobre; risco é
regressão futura — invariante I2 em §3).

### TH-06 — Acesso não autorizado entre agentes (B2, I/D) · **HIGH**
Especialista lê contexto/resultados de run alheio. **Existentes:** ownership por linha;
conversas 404 uniforme. **Requeridos:** runs filhos vinculados por `correlation_id` + verificação
de ownership em cada leitura de artefato; tipos `agent_run` em `ownership` na criação
(`adr/ADR-EVO-002/003`). **Residual:** baixo com controles.

### TH-07 — Vazamento entre admins (B2/B8, I) · **HIGH**
Admin A vê memória/documentos/execuções de B. **Existentes:** JOIN ownership em todas as
consultas verificadas (RAG `documents.js:515-525`, memória `visibleMemorySql`), auditoria
imutável, testes de isolamento. **Requeridos:** novo recurso nasce com ownership obrigatório;
teste transversal "recurso novo → teste de isolamento" (regra do CONTRIBUTING). **Residual:** baixo.

### TH-08 — Exposição de segredos no contexto do modelo (B8/B3, I) · **HIGH**
Provider remoto recebe segredo via contexto/prompt. **Existentes:** settings cifrados em repouso;
audit allowlist exclui tokens; telemetria sem conteúdo. **Requeridos:** nunca montar contexto com
valores de `global_settings`/segredos; teste de ausência de segredos no payload de provider
(efeito colateral do item "retenção configurável" do roadmap). **Residual:** baixo.

### TH-09 — Abuso de egress do navegador (B5, S) · **MEDIUM**
Site tenta exfiltrar via worker. **Existentes:** worker sem rede, broker com DNS pinado, grants
≤65 s/máx 32, bloqueio de redes privadas, recusa de destinos privados. **Requeridos:** nada novo
nesta fase; monitorar volume de grants (Observability, Fase 3+). **Residual:** baixo.

### TH-10 — SSRF/resolução de URL maliciosa (B4/B5, S) · **MEDIUM**
URL aponta para rede interna. **Existentes:** `assertSafeUrl` + allowlist + `assertPublicHost`
com dupla verificação DNS (`browser.js:92,118`), `urlpolicy` (13+9 testes), egress fail-closed
crawl4ai. **Requeridos:** mesma política para o novo motor de busca (Fase 4). **Residual:** baixo.

### TH-11 — Replay de efeito externo (B2/B9, R) · **CRITICAL**
Mesma ação externa executada duas vezes. **Existentes:** `trigger_key` (v15),
`idempotency_key` (v16), `client_msg_id` (v7), aprovação de claim único (`tools.js:1624`),
`needs_reconciliation` no lugar de replay (`jobs.js:158`). **Requeridos:** idempotência por step
de workflow/tool com efeito (`adr/ADR-EVO-004`); ferramentas com efeito declaram chave
idempotente. **Residual:** baixo após Fase 1.

### TH-12 — Execução duplicada pós-timeout (B2, R) · **HIGH**
Timeout faz o orquestrador relançar trabalho em curso. **Existentes:** lease 90 s + heartbeat
25 s (v16); recovery só de `running` sem `run_id`. **Requeridos:** `AgentRun`/`TaskExecution` com
estados `unknown` e reconciliação (`04` §2); nunca retry automático de efeito iniciado.
**Residual:** baixo.

### TH-13 — Alegação de conclusão forjada (B3, S/R) · **HIGH**
Modelo declara "tarefa concluída" sem executar. **Existentes:** verificador nomeado
(`verifiedBy`: `exit_code`, `contract_text`…), "saída 0 ≠ verificado" (`db.js:302-308`).
**Requeridos:** `completed` exige evidência verificada (`04` §2); métrica de false-success rate
(`08` Observability). **Residual:** baixo-médio (verificação semântica de objetivos difusos).

### TH-14 — Alegação de autorização forjada (B2/B3, S/E) · **CRITICAL**
Agente alega que "o usuário aprovou". **Existentes:** aprovações vivem em tabela, com claim
condicional, fingerprint e `isVerifiedAdmin`; saída de modelo não é autorização.
**Requeridos:** invariante explícita I5/I6 (§3); comunicação entre agentes sem campo de
autorização (`04` §5). **Residual:** baixo (controle estrutural).

### TH-15 — Acesso não autorizado à memória (B2, I/D) · **MEDIUM**
Leitura/escrita de memória de outro admin via tool do agente. **Existentes:** memórias sempre
com owner (`tools.js:839`), visibilidade filtrada, audit sem conteúdo. **Requeridos:** domínios
de memória novos herdam `visibleMemorySql`; Gigabrain namespace por admin (Fase 2, `05` §5).
**Residual:** baixo.

### TH-16 — Conteúdo multimodal malicioso (B4, S/T) · **MEDIUM**
Áudio/imagem com instruções embutidas. **Existentes:** assinatura/validação de mídia
(`stt.js:31-43`), limites de tamanho, nunca persistir áudio. **Requeridos:** tratar transcrição
como untrusted (Fase 6); manter opt-in com consentimento. **Residual:** baixo-médio.

### TH-17 — Ação GUI contra app/conta errada (B7, S/T/E) · **HIGH (futuro)**
Input sintético no alvo errado. **Existentes:** nada (capacidade não existe — correto).
**Requeridos (Fase 5):** sessão isolada, pós-condição visual com captura de evidência,
aprovação por ação, allowlist de janelas/apps (`adr/ADR-EVO-008`). **Residual:** médio até
controles existirem — por isso a capacidade não começa antes da Fase 5.

### TH-18 — Exaustão de recursos por delegação (B2, DoS) · **MEDIUM**
Run dispara delegação sem fim. **Existentes:** deadline 5 min, anti-ciclo `REPEAT_LIMIT=3`,
concorrência 2/admin, `maxSteps ≤ 50`. **Requeridos:** orçamento hierárquico com soma dos filhos
≤ pai (`04` §6); profundidade máx. 3. **Residual:** baixo.

### TH-19 — Provider local comprometido (B3, S/T/E) · **MEDIUM**
Ollama/xtts/whisper hostil devolve resposta venenosa ou executa algo. **Existentes:** falha de
provider é tipada e não vaza payload/chave; rede Docker interna; perfis isolados; fail-closed.
**Requeridos:** provider testado antes de habilitar (`/api/providers/:id/test`); saída do
provider continua sendo dado. **Residual:** baixo.

### TH-20 — Adulteração de evidência de execução (B8, S/T/R) · **HIGH**
Admin/agente altera prova de execução. **Existentes:** triggers de imutabilidade (v9),
`audit()` allowlist, evidência gravada apenas em fluxo de resolução (`tools.js:1706+`), hash de
input. **Requeridos:** `verifiedBy` nomeado em todo novo fluxo; migrations continuam com backup
verificado (tamper via migration exigiria commit assinado no repo). **Residual:** baixo no
modelo de ameaça local (atacante com root no host está fora do escopo — documentado).

## 3. Invariantes obrigatórias (preservadas em todas as fases)

1. Autorização é determinada pelo backend (`can()` sobre principal emitido por
   `validateSession`/`validateServiceToken`/`botPrincipal`) — nunca pelo modelo ou pelo agente.
2. Agentes não se auto-declaram capacidades; escopos efetivos são interseção calculada no backend.
3. Toda invocação de ferramenta revalida autorização **no momento da execução** (`tools.js:1026`).
4. Entrada externa (documento, site, e-mail, skill, MCP) é dado não confiável — nunca instrução
   privilegiada.
5. Saída de modelo não é autorização.
6. Auto-relato de agente não é evidência; `verified` exige verificador nomeado
   (`execution_evidence.verifiedBy`).
7. Sucesso técnico ≠ conclusão de negócio verificada.
8. Efeitos externos exigem autorização controlada (D9 com fingerprint revalidado).
9. Retries respeitam idempotência e estado; efeito já ocorrido nunca re-executa (`jobs.js:158`).
10. Segredos nunca entram em logs/audit (`AUDIT_FIELDS`, `db.js:148-179`).
11. Acesso a dados respeita ownership e limites administrativos.
12. Estado de execução desconhecido permanece `unknown` até reconciliação explícita.
13. Operações negadas/canceladas nunca são representadas como executadas.
14. Execução computer-use, quando existir, permanece isolada do acesso irrestrito ao host.

## 4. Riscos aceitos nesta fase

- **Modelo age por prompt apesar das marcações** (TH-01/02): mitigado por D9 nas ações externas;
  eliminação completa exigiria saída estruturada exclusiva — avaliada na Fase 3.
- **Atacante com root no host** fora do escopo (local-first; `master.key` no mesmo disco).
- **Checksum de skill só no provisionamento** (TH-03): aceito até a Fase 1 incluir verificação
  em runtime no backlog.
