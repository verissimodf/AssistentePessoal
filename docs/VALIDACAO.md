# Validação — release 1.8.2

Atualizado em 2026-10-27 após operacionalização. Registra os comandos executados nesta entrega e separa validações locais,
smoke do container e integrações externas que não foram repetidas.

## Verificações executadas

| Área | Verificação | Resultado |
| --- | --- | --- |
| Backend | `node --no-warnings --test tests/*.test.mjs` | **636/636 PASS** |
| Migração v15 | Upgrade v14→v15, backup verificado, linhas preservadas, unicidade e FKs | **PASS** |
| Frontend | `npm test` | **109/109 PASS** (21 arquivos) |
| Avaliação agêntica | `npm run eval:agents` | **86/86 PASS** em seis cenários, sem rede/chaves |
| Tipos | `npx tsc --noEmit` | **sem erros** |
| Build frontend/SSR | `npm run build` e build Docker com `NITRO_PRESET=node-server` | **PASS** |
| Dependências de produção | `npm audit --omit=dev` na raiz e no servidor | **0 vulnerabilidades reportadas** |
| Compose | `docker compose config --quiet` | **PASS** |
| API implantada | `GET /api/health` no IP interno | versão 1.8.2, schema 15, SHA completo `88a3ce55…`, `commitStatus=Registrado` |
| Painel implantado | HTTP na porta 8090 | **200** |
| Container | `docker compose ps` / healthcheck | **healthy**, 0 reinícios observados |
| Banco implantado | `PRAGMA integrity_check` / `foreign_key_check` | `ok` / 0 violações |
| Backup pré-deploy | cópia SQLite + `master.key` | backup automático v14 verificado: `/app/data/backups/jarvis-2026-10-27T21-14-13-224Z-v14.db` |
| Imagem descartável | `scripts/verificar-imagem-release.sh assistente-pessoal:1.8.2 <sha> 1.8.2` | **PASS** labels, build-info, API e painel |

## Resultado não verde conhecido

ESLint direcionado aos 14 arquivos tocados falha: **415 erros** (407 `prettier/prettier`, 8
`@typescript-eslint/no-explicit-any`) e 1 aviso `react-refresh/only-export-components`. Não houve
formatação em massa de módulos legados; lint permanece como dívida e não é declarado limpo.

O build local avisa sobre chunks JavaScript acima de 500 kB e depreciação de algumas dependências de
desenvolvimento. Não impediram build, testes ou execução; otimização de chunks deve ser orientada por
medição de carregamento antes de alterar a divisão de bundles.

## Escopo externo e limitações

- A integração AgentMail foi testada por mocks na suíte. O webhook assinado e envio D9 foram
  validados na release 1.8.0, mas **não foram repetidos** após o isolamento/claim da v1.8.1/1.8.2.
- No deploy atual há uma inbox explicitamente reivindicada (`ownership.origin=claimed`) e zero
  eventos sem owner. Não consultamos o conteúdo do evento e não repetimos o E2E contra o provider.
- OmniRoute, Headroom, Ollama, OpenClaw, Telegram, Gmail, serviços de voz e demais provedores não
  foram retestados nesta entrega; seus estados em `INTEGRACOES-LAYTECH.md` são fotografias com a data
  declarada naquele documento.
- Não foi enviado e-mail real, consultado corpo de e-mail, nem chamado modelo pago durante a validação 1.8.2.

Para regressões funcionais, execute a suíte indicada em `package.json` e confira o estado atualizado
em [`HOMOLOGACAO_STATUS.md`](../HOMOLOGACAO_STATUS.md). Um resultado passado não substitui a
verificação pós-deploy da instalação específica.
