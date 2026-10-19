# Roadmap

Baseline: 2026-10-19 — `origin/main` = `03ebb2d35e427e5d7b4a1e0457c9f46b9492204e` (PRs #40, #41
e #42 integrados).

> Numeração alinhada ao Plano Mestre: Fase 2 = preferências/isolamento, Fase 3 = documentos,
> Fase 4 = e-mail. A versão anterior deste arquivo usava "Fase 2" para documentos; a equivalência
> e o histórico ficam registrados em `docs/CONTINUIDADE.md` (§6, §19, §20 e §21).

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

## Parcial / pendente

- [ ] Fixar as dependências de **build** (hatchling e transitivas) com `--build-constraints`; hoje
  ficam fora do lock e não são cobertas pelo verificador.
- [ ] Hashes de dependências: o `uv tool install` 0.13.1 não os aplica; a garantia atual é pins
  exatos + verificação do conjunto instalado. Avaliar um mecanismo equivalente em follow-up.
- [ ] Regenerar `.github/skillspector-constraints.txt` ao mudar o commit do scanner; até lá o job
  falha explicitamente.
- [ ] Exercitar a saída `incomplete` com o scanner real e, se justificado, o scanner no Windows.
- [ ] Fase F — gateway de MCPs/plugins: somente desenho; nenhum conector ativo.
- [ ] Testar indisponibilidade real de serviços externos (GitHub, NVIDIA, PyPI, IMAP/SMTP,
  Telegram, Ollama, TTS); não há falhas reais observadas — o que existe são simulações locais.

## Decisões que exigem autorização do proprietário

- [ ] Fase 4 — e-mail: especificação **não aprovada**; F4.11 e D_REC pendentes. Existe base
  IMAP/SMTP no código, mas a implementação/validação real não está autorizada.
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

- [ ] Fixar as dependências de build do scanner (`hatchling` e transitivas) com
  `--build-constraints`, mantendo o lock de runtime e a verificação de conjunto já concluídos no
  PR #42. É um follow-up de supply chain, pequeno, sem efeito em produção, credenciais ou política
  de Skills; **não iniciado nesta tarefa**.
