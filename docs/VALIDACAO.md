# Validação — release 1.8.1

Atualizado em 2026-10-27. Registra os comandos executados nesta entrega e separa validações locais,
smoke do container e integrações externas que não foram repetidas.

## Verificações executadas

| Área | Verificação | Resultado |
| --- | --- | --- |
| Backend | `node --no-warnings --test tests/*.test.mjs` | **632/632 PASS** |
| Migração v14 | Upgrade v13→v14, preservação de ownership e rejeição de tipo desconhecido | **PASS** |
| Frontend | `npm test` | **109/109 PASS** (21 arquivos) |
| Tipos | `npx tsc --noEmit` | **sem erros** |
| Build frontend/SSR | `npm run build` e build Docker com `NITRO_PRESET=node-server` | **PASS** |
| Dependências de produção | `npm audit --omit=dev` na raiz e no servidor | **0 vulnerabilidades reportadas** |
| Compose | `docker compose config --quiet` | **PASS** |
| API implantada | `GET /api/health` no IP interno | versão 1.8.1, schema 14, SHA reportado; `commitStatus=Registrado` é divergente porque o commit ainda está local |
| Painel implantado | HTTP na porta 8090 | **200** |
| Container | `docker compose ps` / healthcheck | **healthy**, 0 reinícios observados |
| Banco implantado | `PRAGMA integrity_check` / `foreign_key_check` | `ok` / 0 violações |
| Backup pré-deploy | cópia SQLite + `master.key` | integrity check `ok`; backup automático v13 também verificado pela migração |

## Resultado não verde conhecido

O ESLint dos arquivos tocados nesta entrega ainda falha: **368 ocorrências**, sendo 363 de
`prettier/prettier` e 5 de outras regras em trechos dos arquivos analisados. As ocorrências de
formatação são dívida distribuída por arquivos antigos; não foi feita formatação em massa para
evitar diffs funcionais extensos. Os demais avisos devem ser tratados incrementalmente e validados
contra o diff antes de declarar lint limpo.

O build local avisa sobre chunks JavaScript acima de 500 kB e depreciação de algumas dependências de
desenvolvimento. Não impediram build, testes ou execução; otimização de chunks deve ser orientada por
medição de carregamento antes de alterar a divisão de bundles.

## Escopo externo e limitações

- A integração AgentMail foi testada por mocks na suíte. O webhook assinado e envio D9 foram
  validados na release 1.8.0, mas **não foram repetidos** após o isolamento/claim da v1.8.1.
- No deploy atual há uma inbox explicitamente reivindicada (`ownership.origin=claimed`) e zero
  eventos sem owner. Não consultamos o conteúdo do evento e não repetimos o E2E contra o provider.
- OmniRoute, Headroom, Ollama, OpenClaw, Telegram, Gmail, serviços de voz e demais provedores não
  foram retestados nesta entrega; seus estados em `INTEGRACOES-LAYTECH.md` são fotografias com a data
  declarada naquele documento.
- Não foi enviado e-mail real nem chamado modelo pago durante a validação 1.8.1.

Para regressões funcionais, execute a suíte indicada em `package.json` e confira o estado atualizado
em [`HOMOLOGACAO_STATUS.md`](../HOMOLOGACAO_STATUS.md). Um resultado passado não substitui a
verificação pós-deploy da instalação específica.
