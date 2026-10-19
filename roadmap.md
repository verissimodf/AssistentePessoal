# Roadmap

Baseline de trabalho: 2026-10-19 — `origin/main` = `57a991f51174799e96a0897e3b5f380c5e5f50cd`
(PRs #40–#47 integrados; a PR #46 foi reconciliada por esta baseline documental).

> Numeração alinhada ao Plano Mestre: Fase 2 = preferências/isolamento, Fase 3 = documentos,
> Fase 4 = e-mail. A versão anterior deste arquivo usava "Fase 2" para documentos; a equivalência
> e o histórico ficam registrados em `docs/CONTINUIDADE.md` (§6, §19, §20, §21, §22 e §23).

## Concluído e integrado

- [x] Fase 0 — diagnóstico e baseline.
- [x] Fase 1 — autenticação/autorização; integrada na `main`, com CI Linux + Windows.
- [x] Fase 2 — preferências e isolamento por administrador; integrada na `main`.
- [x] Fase 3 — gestão documental com o primeiro formato TXT; integrada na `main`.
- [x] Registro de Skills, gate pré-instalação, quarentena, histórico de vereditos e proteção de
  regressão (PRs #33, #35, #38 e #39).
- [x] CI real do SkillSpector: v2.13.0 instalado por commit imutável, job dedicado sem skip
  silencioso (PR #40, merge `6ec1986`).
- [x] Atestação runtime da proveniência do SkillSpector: `sourceRevision`/`sourceRevisionSource`
  expostos pelo adaptador e revisão VCS fixada exigida no teste real — `091a509…` com origem
  `package_vcs_metadata`, separada da versão `2.13.0` (PR #41, merge `71c0832`). Comprova a
  consistência declarada, não a integridade criptográfica do binário.
- [x] Supply chain do job do scanner: `uv 0.13.1` fixado com checksum sha256, 63 pins derivados do
  `uv.lock` do commit `091a509…`, instalação por constraints e verificação do conjunto efetivamente
  instalado; verificador endurecido (parsing estrito, PEP 503, duplicatas rejeitadas, `skillspector`
  obrigatório) com 16 testes (PR #42, merge `03ebb2d`). CI pós-merge verde nos três jobs.
- [x] Build do scanner fixado: `hatchling 1.31.0` + `packaging 26.2`, `pathspec 1.1.1`,
  `pluggy 1.6.0` e `trove-classifiers 2026.6.1.19`, com hashes SHA-256; instalação com
  `--build-constraints` + `--require-build-hashes` e `--no-cache`, mais 6 testes de constraints
  (PR #44, merge `686dcfd`). Suíte total 522 testes, 0 falhas; CI pós-merge verde nos três jobs.
- [x] Baseline documental pós-PR #44 (PR #45, merge `f563af5`): quatro documentos reconciliados,
  runtime/build do scanner preservados, CI pós-merge `39326226275` verde nos três jobs.
- [x] Fase 4 — titularidade de contas de e-mail (PR #47, merge `57a991f`): Padrão A (sem
  transferência automática em desativação/recuperação) e exceção B (transferência explícita,
  reautenticada, auditada e protegida contra conflito/concorrência). A conta transferida fica
  desativada (`enabled=false`, `state="reconnect"`); a operação não conecta, não ativa transporte e
  não envia. Implementação com 7 testes dedicados; CI pós-merge `39334333129` verde nos três jobs.

## Implementado, sem validação operacional

- [ ] Fase 4 — e-mail: núcleo, rotas/ferramentas com transporte mockado, adaptador IMAP/SMTP,
  F4.11 (pastas/filtros/limites/retenção), rascunhos e transferência de titularidade estão
  implementados e cobertos por testes. Faltam a validação real com conta dedicada, o teste de
  conexão/estado (F4.5) e a UI de transferência; não há conta real, credencial real, transporte
  real nem envio.
- [ ] Follow-ups técnicos do SkillSpector: exercitar a saída `incomplete` com o scanner real e, se
  justificado, o scanner no Windows; hashes de **runtime** não são aplicados pelo `uv tool install`
  0.13.1 (a garantia é pins + verificação do conjunto); os hashes de **build** refletem os artefatos
  do PyPI no momento da geração.
- [ ] Regenerar `.github/skillspector-constraints.txt` **e**
  `.github/skillspector-build-constraints.txt` ao mudar o commit do scanner; as checagens de
  consistência e o job falham explicitamente até lá.
- [ ] Se o upstream adicionar plugins de build ou requisitos dinâmicos, atualizar o arquivo de build
  e o teste; se alguma dependência de runtime passar a usar sdist, o `--require-build-hashes` pode
  exigir hashes adicionais e falhar até revisão.
- [ ] Checksum do `uv` fixado para linux-x86_64; mudança de arquitetura do runner exige atualização
  explícita.
- [ ] Testar indisponibilidade real de serviços externos (GitHub, NVIDIA, PyPI, IMAP/SMTP,
  Telegram, Ollama, TTS); não há falhas reais observadas — o que existe são simulações locais.

## Pendente de decisão ou autorização

- [ ] Fase 4 — e-mail: F4.11 e a titularidade estão decididas, mas a **especificação como documento**
  e a **autorização geral de implementação** seguem pendentes (§11, item 2). D7 e as autorizações
  operacionais **O1–O4** também estão pendentes: ativar `JARVIS_MAIL_TRANSPORT=imap`, conectar a
  conta de teste dedicada para leitura/posse, autorizar envio real (independente) e qualquer escopo
  adicional. Nenhuma dessas operações foi executada.
- [ ] Política de instalação e ativação de Skills (`enabled.json`); não implementar sem decisão
  explícita.
- [ ] Deploy e migração de produção. O código atual contém a migração **v12**; a produção não foi
  inspecionada nesta tarefa. Exige autorização explícita e runbook atualizado.
- [ ] Validação de integrações externas com credenciais ou serviços reais; não declarar validadas
  sem evidência.
- [ ] Heartbeat/autonomia: a flag está desligada por omissão; habilitar exige decisão e aprovação
  do desenho v12.
- [ ] Retenção/expurgo de backups e do ledger de evidências.
- [ ] Fase F — gateway de MCPs/plugins: somente desenho; nenhum conector ativo.

## Próxima fase recomendada

**Fase 4 — validação operacional de leitura e posse com conta de teste dedicada**, sem envio real.

- **Objetivo:** provar o caminho real de leitura/posse e transformar a configuração atual em uma
  experiência verificável no painel, mantendo o envio bloqueado.
- **Escopo:** teste de conexão server-side e estado sanitizado por conta (F4.5); leitura real de uma
  conta dedicada; isolamento entre administradores; erros de autenticação/rede sem segredos; nenhuma
  ativação de envio.
- **Reutilização:** `server/mail.js`, `server/mail-imap.js`, `server/mail-service.js`, rotas
  `/api/mail/*`, `admin_settings` cifrado, auditoria sanitizada e a aba de comunicação em
  `src/routes/configuracoes.tsx`. Persistência nova só se o estado do teste precisar sobreviver ao
  processo.
- **Lacunas confirmadas:** o formulário atual grava campos e `enabled`, mas não executa teste de
  conexão nem mostra estado real; F4.5 continua pendente; não há UI de transferência; o adaptador
  real nunca foi exercitado contra provedor.
- **Critérios de aceite:** O1/O2 registrados; conta dedicada vinculada a um único administrador;
  leitura real com corpo sanitizado; segundo admin recebe `404 account_not_found`; nenhuma senha em
  resposta/log/auditoria; teste de conexão server-side e auditado só com metadados; transporte
  desligável com retorno ao mock; envio real continua inexistente.
- **Dependência:** autorização explícita do proprietário para O1 (transporte real) e O2 (primeira
  conexão/leitura). Sem ela, o fallback não bloqueador é o follow-up `incomplete` real/Windows do
  SkillSpector; ele não substitui a validação da Fase 4.

**Pergunta pendente:** o proprietário autoriza O1 + O2 para uma conta de teste dedicada, apenas
leitura/posse, sem envio? A execução não começa sem essa autorização explícita.
