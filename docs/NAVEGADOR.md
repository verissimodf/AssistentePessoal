# Navegador Playwright — implantação e segurança

O `browser_action` é uma capacidade opt-in. A configuração padrão permanece desligada, cada ação
gera uma aprovação humana e a execução gerenciada usa um worker isolado e um broker de egress com
DNS fixado no IP efetivamente conectado. O sistema não oferece shell, JavaScript arbitrário,
download, upload, cookies ou leitura de arquivos locais.

## Capacidade e aprovações

| Operação     | Uso                          | Autorização adicional                                            |
| ------------ | ---------------------------- | ---------------------------------------------------------------- |
| `navigate`   | abrir uma URL                | `web`                                                            |
| `extract`    | extrair texto ou seletor     | `web`                                                            |
| `wait_for`   | aguardar seletor/página      | `web`                                                            |
| `screenshot` | registrar tamanho da captura | `web`                                                            |
| `click`      | clicar em seletor            | `web:write` + revisão e confirmação humana                       |
| `fill`       | preencher seletor            | `web:write` + revisão, revelação autorizada e confirmação humana |

Texto de preenchimento é criptografado em repouso. A revisão mostra valor mascarado por padrão;
revelar exige administrador verificado e reautenticação recente. A confirmação vincula o destino e
o conteúdo revisados por fingerprint. Segredos não aparecem em listagens comuns, logs ou auditoria.

## Configuração no painel

Em **Configurações → Integrações → Navegador (Playwright)**:

- `enabled`: mantém a capacidade desligada até o operador habilitá-la.
- `allowedHosts`: lista opcional, global e somente para administrador, de hosts DNS exatos. Até 100
  nomes; não aceita curingas. Vazio permite qualquer destino público.
- Endpoint HTTP e token são configurações legadas e não são usados. O painel permite limpar esses
  valores antigos. Um endpoint legado faz a execução falhar fechada.

O serviço principal precisa receber
`JARVIS_BROWSER_WORKER_SOCKET=/run/jarvis-browser/worker/worker.sock`
e montar o volume privado do runtime. Se não houver socket configurado, o modo fica
`unavailable`; não ocorre fallback para Chromium dentro do processo do app.

## Topologia gerenciada

```text
Assistente (rede da aplicação)
  └─ browser-worker-runtime (app somente leitura; worker.sock modo 0600)
       └─ Playwright worker (network_mode: none, sem rede Docker)
            └─ bridge 127.0.0.1:8899
                 └─ browser-egress-runtime (worker somente leitura)
                      └─ egress.sock (broker uid 1001, grupo 1000, modo 0620)
                      └─ broker (somente rede browser-egress)
                           └─ DNS público validado → IP fixado no dial
```

Os sockets usam volumes e permissões distintos: o diretório do worker é `1000:1000/0700`; o do
broker é `1001:1000/0710`. O worker pode conectar ao socket egress pelo grupo, mas seu mount é
somente leitura e ele não pode remover/substituir o socket. Worker e broker rodam como usuários
não-root distintos, com filesystem somente leitura, capabilities removidas, limites de
memória/CPU/PIDs e sem portas publicadas. O worker não tem Docker socket, interface de rede ou DNS
próprio. A resolução DNS acontece no broker; ele rejeita a requisição se qualquer resposta for
privada/reservada e conecta diretamente ao IP validado. HTTPS usa `CONNECT`, preservando o hostname
para TLS SNI. HTTP usa `Host` canônico, remove credenciais de proxy e fecha cada conexão para obrigar
validação individual por destino.

O browser valida protocolo, porta, host e allowlist em cada navegação, redirect e recurso. O broker
repete bloqueio de IP privado/reservado e restrição de porta no ponto de conexão; portas aceitas são
80 e 443. A allowlist de hostname é aplicada no fluxo normal do Playwright, não pelo broker. Um
worker comprometido poderia usar o proxy para qualquer host público nessas portas, embora continue
sem acesso a endereços privados. Não trate a allowlist da aplicação como barreira de egress contra
comprometimento do Chromium; enforcement de allowlist no broker permanece hardening pendente. A
política é fail-closed para falhas de DNS, cabeçalhos inválidos/ambíguos, headers acima de 16 KiB e
conexões sem cabeçalho completo após o timeout.

## Candidata isolada e smoke test

O compose de candidata usa projeto, rede interna, volume de dados e volume de sockets próprios. Não
usa o volume de dados nem a rede Docker do Assistente em produção.

```bash
rtk docker compose -f deploy/browser-candidate/compose.yml up -d --build
rtk docker compose -f deploy/browser-candidate/compose.yml ps
rtk docker exec jarvis-browser-candidate-browser-worker-1 node /app/scripts/browser-network-smoke.mjs
rtk docker exec jarvis-browser-candidate-assistente-1 node -e 'const h=require("node:http");const q=h.request({socketPath:"/run/jarvis-browser/worker/worker.sock",path:"/health",method:"GET"},s=>{console.log(`worker_http=${s.statusCode}`);s.resume();s.on("end",()=>process.exit(s.statusCode===200?0:1));});q.on("error",e=>{console.error(e.code||"socket_error");process.exit(1);});q.end()'
```

O smoke candidato valida que TCP e DNS diretos falham no namespace do worker, que o broker recusa
`169.254.169.254:80` e que Chromium alcança `https://example.com/` pelo proxy. Esse último passo faz
uma requisição pública GET controlada. O teste unitário do proxy usa apenas fixtures loopback.

Depois da avaliação da candidata, a configuração de serviços opt-in no compose principal usa o
profile `browser` e a imagem `jarvis-browser-worker:playwright-1.64.1`. A integração deve continuar
desligada até todos os checks do release serem aprovados; não habilite o profile durante uma
atualização normal do serviço.

Para remover somente os recursos descartáveis da candidata:

```bash
rtk docker compose -f deploy/browser-candidate/compose.yml down --volumes --remove-orphans
```

Esse comando apaga o banco e os sockets da candidata; não use o compose de candidata com volumes de
produção.

## Diagnóstico

- `off`: integração desligada.
- `managed`: socket gerenciado configurado; erro de socket significa worker indisponível e não
  provoca fallback.
- `unavailable`: navegador habilitado sem socket; configure o worker isolado.
- `remote`: endpoint HTTP legado; a execução é recusada (`browser_untrusted_transport`).

O diagnóstico expõe apenas classificação de endpoint e presença de credencial, nunca tokens. Erros
estáveis incluem `browser_disabled`, `browser_worker_required`, `browser_untrusted_transport`,
`browser_unreachable`, `browser_protocol_error`, `browser_timeout` e `blocked_destination`.

## Testes e recuperação

```bash
rtk node --test tests/browser-egress-proxy.test.mjs tests/browser-tool.test.mjs
rtk npm --prefix server test
rtk npm test
rtk npm run lint
rtk npm run build
```

A migração v19 criptografa valores de `fill` existentes na mesma transação e exige backup
verificado. A recuperação de chave e banco está em [RECUPERACAO.md](RECUPERACAO.md); nunca remova
`master.key` para “corrigir” aprovações. A arquitetura e as fronteiras de rede estão descritas em
[ARQUITETURA.md](ARQUITETURA.md).
