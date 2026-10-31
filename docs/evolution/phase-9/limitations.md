# Limitações Conhecidas — Fase 9

Classificação segundo o §16 do mandato: **resolvido** / **pendente-credencial** /
**pendente-infra** / **fora-de-escopo** / **risco** / **decisão-operador**.

## Capacidades

| Item | Classificação | Estado e consequência |
|---|---|---|
| STT (whisper.cpp) | **PENDENTE DE INFRAESTRUTURA** | Serviço não em execução no ambiente. Cadeia completa implementada e testada com fixture; indisponibilidade explícita em runtime. Ativa ao subir o serviço no ambiente de destino. |
| TTS (xtts) | **RESOLVIDO** | Síntese **real** comprovada na F6 (347 KB WAV; 13,9 s aquecido / ~110 s frio, CPU). Nada pendente. |
| Provider Google Calendar | **PENDENTE DE CREDENCIAL** | Implementado contra a API v3 oficial via `oauth_connections`; funcional só com OAuth real do operador. Sem conexão: `cal_oauth_not_connected` (indisponibilidade explícita). Fixture marcada `provider_test_only`. |
| Escrita no calendário | **DECISÃO DO OPERADOR** | Hoje somente leitura; escrita fica para D9 futura, a critério do operador. |
| Webhook outbound | **FORA DO ESCOPO** | Decisão declarada na F8; não foi implementado nem planejado. |
| Lip-sync do avatar | **DECISÃO DE DESIGN** | Animação por estado (honesto); sem lip-sync — o sistema não finge sincronia. |

## Dívidas técnicas documentadas (risco > benefício na consolidação)

| Item | Classificação | Justificativa da não-correção |
|---|---|---|
| `khSearch` filtra escopo no JS pós-FTS (recall multi-donor) | **RISCO — operacional BAIXO** | Hoje o perfil é single-admin local; resultados de outros doadores não ocorrem na prática. Corrigir exige reescrever a query FTS com vínculo de escopo — risco de regressão maior que o benefício atual. Reavaliar se o perfil mudar. |
| 3 estilos de contrato de erro (classes tipadas / Error+mapa / `{error}`) | **RISCO — LOW** | Normalizados por duck-typing no choke point único. Unificar tocaria módulos estáveis de 6 fases. |
| `index.js` com 2.772 linhas | **RISCO — LOW** | É o choke point de segurança (ativo); extração reescreveria o arquivo mais crítico numa fase de consolidação. |
| `sha256` duplicado 5× | **RISCO — LOW** | Função pura e estável; duplicação sem risco de divergência comportamental relevante. |
| N+1 pontuais | **RISCO — LOW** | Em datasets pequenos, perfil single-admin; sem impacto mensurável. |

## Condicionantes de produção (não são dívidas de código)

São requisitos **externos ao código**, sem os quais a plataforma não deve ser
publicada — enumerados em [production-readiness.md](production-readiness.md):

1. Credenciais OAuth reais (Google Calendar).
2. Serviço STT em execução no ambiente de destino.
3. Monitoramento externo ao processo.
4. Backup automático do banco no ambiente de destino.
5. Validação do operador no ambiente de destino.

## Nada CRITICAL/HIGH aberto

Os riscos MEDIUM residuais (khSearch multi-donor, dependências externas ausentes,
ausência de monitoramento/backup externo) estão classificados e com disposição no
[threat-model.md](threat-model.md).
