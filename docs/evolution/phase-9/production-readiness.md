# Critérios de Prontidão para Produção — Fase 9

## Veredicto explícito

> A plataforma **NÃO é declarada PRODUCTION READY** nesta fase. Ela atinge
> **maturidade arquitetural alta** com qualidade comprovada por testes; a prontidão
> **operacional** depende dos itens abaixo, todos externos ao código.

## Checklist de prontidão

| # | Critério | Estado | Responsável |
|---|---|---|---|
| 1 | Credenciais OAuth reais (Google Calendar) conectadas | ⬜ PENDENTE — implementação pronta; sem conexão o provider falha com `cal_oauth_not_connected` | Operador |
| 2 | Serviço STT (whisper.cpp) em execução no ambiente de destino | ⬜ PENDENTE DE INFRAESTRUTURA — código e testes prontos (fixture); indisponibilidade explícita até lá | Operador |
| 3 | Monitoramento externo ao processo (health checks externos, alertas) | ⬜ PENDENTE — a observabilidade interna (audit) existe; monitoramento de ambiente não faz parte da plataforma | Operador |
| 4 | Backup automático agendado do banco | ⬜ PENDENTE — backup verificado existe para migrações; agendamento externo é do ambiente ([contingency.md](contingency.md)) | Operador |
| 5 | Ambiente de destino definido (host, volumes, rede) e não apenas o ambiente de desenvolvimento | ⬜ PENDENTE | Operador |
| 6 | Validação final do operador no ambiente de destino (smoke test + inspeção dos 11 estúdios) | ⬜ PENDENTE — roteiro em [runbook.md](runbook.md) | Operador |
| 7 | Verificação de imagem da F9 após o commit | ⬜ EXECUTAR APÓS O COMMIT — [build-image-report.md](build-image-report.md) | Operador |
| 8 | Decisão de merge/push dos branches F0–F9 | ⬜ DECISÃO DO OPERADOR | Operador |

## O que JÁ está pronto (não precisa refazer)

- **Código e testes**: backend 848/848, frontend 195/195, eval 6/6, tsc/eslint 0,
  build/compose OK, demo-final-acceptance 37/37 ([test-report.md](test-report.md),
  [e2e-report.md](e2e-report.md)).
- **Segurança**: superfície pública asserida (6 rotas), 224 rotas com escopo, ownership
  em todas as tabelas novas, D9/Policy intocados, segredos cifrados
  ([security-report.md](security-report.md)).
- **Arquitetura**: zero ciclos estáticos, duplicações consolidadas, índices v28,
  dead code removido ([architecture-audit.md](architecture-audit.md)).

## Critérios de medição no ambiente de destino (quando aplicável)

Sem metas inventadas — quando o operador definir as metas, medir:

1. Latência de ticks (15–60 s) sob o volume de dados real (pós-v28, devem ser
   index-scan, não full scan).
2. Latência TTS no hardware de destino (referência F6: 13,9 s aquecido / ~110 s frio
   na CPU usada na F6 — pode variar).
3. Tempo de recuperação de boot com runs/eventos pendentes reais.
4. Tamanho e tempo de backup do banco no volume real.

## Porta de saída (go/no-go)

Publique somente quando: itens 1–6 marcados ✅ **e** o item 7 registrado como APROVADO.
Enquanto isso, a plataforma permanece apta para **uso local do operador** (perfil para
o qual foi construída), com as limitações de [limitations.md](limitations.md).

A decisão final de publicação é do operador — ver [final-opinion.md](final-opinion.md).
