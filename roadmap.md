# Roadmap

Baseline: 2026-10-19 — `origin/main` = `686dcfd6812568c7e0f8aefdec1278fac17486d5` (PRs #40–#44
integrados).

> Numeração alinhada ao Plano Mestre: Fase 2 = preferências/isolamento, Fase 3 = documentos,
> Fase 4 = e-mail. A versão anterior deste arquivo usava "Fase 2" para documentos; a equivalência
> e o histórico ficam registrados em `docs/CONTINUIDADE.md` (§6, §19, §20, §21 e §22).

## Concluído

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

## Parcial / pendente

- [ ] Hashes de **runtime**: o `uv tool install` 0.13.1 não os aplica; a garantia de runtime é pins
  exatos + verificação do conjunto instalado. Os hashes de **build** são exigidos e aplicados
  (`--require-build-hashes`), mas refletem os artefatos do PyPI no momento da geração.
- [ ] Regenerar `.github/skillspector-constraints.txt` **e**
  `.github/skillspector-build-constraints.txt` ao mudar o commit do scanner; as checagens de
  consistência e o job falham explicitamente até lá.
- [ ] Se o upstream adicionar plugins de build ou requisitos dinâmicos, atualizar o arquivo de build
  e o teste; se alguma dependência de runtime passar a usar sdist, o `--require-build-hashes` pode
  exigir hashes adicionais e falhar até revisão.
- [ ] Checksum do `uv` fixado para linux-x86_64; mudança de arquitetura do runner exige atualização
  explícita.
- [ ] Exercitar a saída `incomplete` com o scanner real e, se justificado, o scanner no Windows.
- [ ] Fase F — gateway de MCPs/plugins: somente desenho; nenhum conector ativo.
- [ ] Testar indisponibilidade real de serviços externos (GitHub, NVIDIA, PyPI, IMAP/SMTP,
  Telegram, Ollama, TTS); não há falhas reais observadas — o que existe são simulações locais.

## Decisões que exigem autorização do proprietário

- [ ] Fase 4 — e-mail: F4.11 **aprovada** (2026-10-15), mas a especificação como documento, a
  autorização de implementação, D_REC e as autorizações operacionais seguem pendentes. Existe base
  IMAP/SMTP e adaptador no código; o transporte real e a validação com conta dedicada não estão
  autorizados.
- [ ] Política de instalação e ativação de Skills (`enabled.json`); não implementar sem decisão
  explícita.
- [ ] Deploy e migração de produção. O código atual contém a migração **v12**; a produção não foi
  inspecionada nesta tarefa. Exige autorização explícita e runbook atualizado.
- [ ] Validação de integrações externas com credenciais ou serviços reais; não declarar validadas
  sem evidência.
- [ ] Heartbeat/autonomia: a flag está desligada por omissão; habilitar exige decisão e aprovação
  do desenho v12.
- [ ] Retenção/expurgo de backups e do ledger de evidências.

## Próxima tarefa recomendada

- [ ] Follow-up técnico não bloqueador: exercitar a saída `incomplete` com o scanner real e, se
  justificado, o scanner no Windows, mantendo o job dedicado sem skip. **Não iniciado nesta
  tarefa.**
- [ ] A maior lacuna **funcional** continua sendo a Fase 4 — e-mail (transporte real, conta
  dedicada e autorizações operacionais); depende de decisão do proprietário e **não foi iniciada**.
