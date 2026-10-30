# AssistentePessoal — desenho das capacidades locais e Playwright

**Status:** proposta para revisão antes da implementação  
**Data:** 2026-10-28  
**Escopo:** segurança do navegador, capacidades locais de análise e geração de documentos, skills e ferramentas MCP

## Intenção

Fechar as lacunas encontradas na auditoria do Playwright e acrescentar fluxos úteis de pesquisa, análise e produção de documentos sem duplicar serviços já existentes nem transferir o armazenamento do Assistente para a nuvem.

## Evidência inicial

- `browser_action` já tem operações limitadas, portão de aprovação e testes de contrato. A instalação verificada está em `mode=off`, sem `playwright-core`, Chromium ou worker ativo.
- O navegador valida DNS da URL inicial, mas as rotas Playwright validam apenas a forma da URL. O worker não tem, hoje, uma rede de saída isolada.
- `fill.text` é serializado em claro na tabela `approval_actions`; a descrição apresentada na aprovação omite esse conteúdo.
- `redact()` remove chaves com nomes sensíveis, mas não inspeciona segredos embutidos em texto livre.
- O Assistente já oferece ingestão local de TXT/MD/CSV/JSON/PDF/DOCX, RAG híbrido, OAuth Gmail/Graph, leitura de calendário ICS, hub de skills e um servidor MCP stdio local com tokens por escopo.
- A ingestão de documentos existe; uma API e uma interface de criação/exportação de documentos ainda precisam ser implementadas.

## Objetivos

1. Permitir pesquisa web automatizada em modo de leitura com isolamento de rede verificável.
2. Não persistir dados preenchidos em formulários em claro e tornar revisável qualquer dado que será enviado a um site.
3. Produzir documentos locais, rastreáveis às fontes, em formatos práticos para uso e revisão.
4. Acrescentar skills de domínio e ferramentas MCP usando as rotas, escopos, ownership e aprovações atuais.
5. Estender integrações existentes de modo opt-in e somente leitura antes de considerar qualquer escrita em serviços externos.
6. Documentar implantação, limites, recuperação e validação com evidências reais.

## Restrições e não objetivos

- Todo documento, artefato, token OAuth e dado de execução persistido permanece no volume local já usado pelo Assistente.
- Nenhum serviço de armazenamento em nuvem, MCP público, shell arbitrária no navegador, JavaScript arbitrário em página, upload/download automático ou envio externo autônomo.
- Conteúdo web, documentos e resultados de ferramentas são entrada não confiável e não podem alterar escopos, políticas ou instruções do sistema.
- Toda rota nova declara acesso em `server/index.js`; toda ação de ferramenta revalida escopo, proprietário, destino e estado imediatamente antes do efeito.
- Mudanças de esquema são migrações novas e versionadas; nenhuma migração publicada será editada.
- A integração Playwright permanece desligada por padrão e só será habilitada depois de um smoke test seguro.

## Desenho proposto

### A. Navegador seguro e operável

**Modo de produção:** worker dedicado em container não-root, sem acesso ao socket Docker, com filesystem raiz somente leitura, `tmpfs` limitado e limites de CPU, memória e processos. O serviço não recebe credenciais de serviços de negócio.

**Rede:** criar uma rede de controle privada entre Assistente e worker, e um proxy de saída dedicado para o worker. Chromium será iniciado com proxy obrigatório. O container do worker bloqueará conexões diretas de saída; o proxy resolverá cada destino, recusará qualquer resposta DNS com IP não público e conectará ao mesmo endereço validado. Só HTTP/HTTPS nas portas 80/443 será aceito. O proxy não compartilhará uma rede com os serviços de negócio. O hook Playwright continuará fazendo validação por requisição como defesa adicional. Um teste de implantação verificará que `assistente`, redes privadas, loopback, link-local e metadados são inacessíveis e que um site público controlado continua acessível.

**Operações e autorização:** manter navegação/extração somente leitura como padrão. Separar autorização de leitura e escrita. `click` e `fill` serão operações de escrita por padrão, sujeitas a escopo distinto e a uma segunda confirmação humana. Hosts poderão ser restringidos por política global do administrador verificado. Tokens antigos com `web` não ganharão permissão de escrita implicitamente.

**Segredos e aprovações:** o payload de `fill` será cifrado com AES-GCM usando a chave local já existente; o texto nunca aparecerá em logs, auditoria ou listagem comum de aprovações. Um endpoint autenticado e owner-scoped apresentará uma revisão explícita da ação, com valor mascarado por padrão e opção de revelar ao administrador. Não haverá ação de envio de formulário via `click` sem uma confirmação separada do destino e do efeito. Campos identificados como senha/token/credencial serão recusados por padrão.

**Transição de aprovações existentes:** a migração cifrará in-place o `text` de payloads Playwright já persistidos, incluindo ações pendentes, sem descartar ou executar aprovações. A migração usará `encrypt()`/`decrypt()` e o `master.key` local; criará o backup verificado exigido pelo fluxo de migração e preservará o número e o estado das ações. Se a chave local não puder ser lida ou o backup/verificador falhar, a inicialização da migração falhará fechada e nenhuma ação será alterada. A revisão e a revelação do texto serão permitidas apenas para sessão de administrador verificada que seja proprietária da aprovação. Todo `click` será classificado como escrita e exigirá a confirmação adicional, pois não é confiável inferir efeito só pelo seletor ou pelo nome do botão.

**Saída e artefatos:** conteúdo textual terá teto fixo, remoção de controles e redação determinística de padrões conhecidos de credencial; a redação é defesa auxiliar, não garantia contra segredos arbitrários. Screenshot será guardada como artefato local owner-scoped, com endpoint autenticado, acesso por ID opaco, `Cache-Control: no-store` e expiração. O valor inicial proposto para retenção é 24 horas, com teto configurável de 7 dias; o limite deverá ser validado e expiração terá coleta periódica.

**Operação:** limitar concorrência e tamanho da fila no worker; fechar browser/contextos em shutdown e em falhas; manter timeout/cancelamento. Resultado de `click`/`fill` deve indicar estado e pós-condição observada, sem afirmar sucesso só porque o comando terminou.

### B. Produção e análise de documentos local

Adicionar fluxo “rascunho → revisão → exportação” no painel. O Assistente poderá combinar texto do usuário, trechos dos documentos indexados e fontes web autorizadas. Cada afirmação recuperada carregará referência local (documento/trecho) ou URL e horário de consulta; conteúdo sem suporte será marcado como hipótese/rascunho, nunca como citação verificada.

Implementar geradores locais para DOCX e PDF com dependências Node versionadas no lockfile, sem chamar serviço remoto. Saídas ficam numa área privada do proprietário; rotas de listagem/download usam sessão + ownership. Nomes são normalizados e caminhos não vêm diretamente do modelo. Exportação valida limites de tamanho e tipo. Nenhum documento é enviado por e-mail ou serviço externo sem o fluxo de aprovação já existente.

Adicionar funções de análise de documentos e CSV que devolvam síntese, tabela/dados estruturados e referências às páginas/linhas disponíveis. Tratar todo conteúdo de entrada como não confiável e não executar macros, scripts ou fórmulas. CSV exportado neutraliza células com fórmulas iniciadas por `=`, `+`, `-` ou `@`.

### C. Skills de primeira parte

Incluir cinco skills locais e versionadas no hub já existente: `browser-research`, `document-analysis`, `document-builder`, `data-analysis` e `service-integration`. Cada `SKILL.md` orienta um fluxo reproduzível, lista fontes e ferramentas necessárias e instrui a preservar evidências. Skills não concedem permissões e não carregam segredos. Scripts e referências, se necessários, permanecem no repositório e passam pela validação de caminho já usada pelo catálogo.

O instalador do hub incluirá apenas skills próprias; skills vendorizadas conservarão sua proveniência e checksums atuais. Atualizar catálogo, inventário da UI, testes de carregamento e instruções de instalação.

### D. MCP e serviços OAuth

Estender o MCP stdio atual com ferramentas estreitas para pesquisa somente leitura, análise/criação de rascunho local e exportação de documento. Cada chamada usará o token de serviço atual e as rotas HTTP existentes, sem lógica paralela nem bypass de `callTool`, ownership ou aprovação. Não instalar um Playwright MCP genérico nem permitir `eval`.

Estender OAuth existente com acesso de calendário somente leitura para Google Calendar e Microsoft Graph, sob consentimento explícito e tokens cifrados locais. Preservar leitura ICS. Não adicionar criação/edição de eventos, tarefas ou envio de mensagens neste escopo. Os escopos solicitados serão mínimos e a interface mostrará o provedor, permissões e estado de conexão.

### E. Documentação e liberação

Atualizar `README.md`, `docs/ARQUITETURA.md`, `docs/NAVEGADOR.md`, guia de instalação/implantação e catálogo de skills. Documentar portas/rede, variáveis sem valores secretos, retenção, backup, desativação, rotação de token, falhas conhecidas e rollback da imagem. Atualizar changelog apenas após implementação e validação.

## Fases de implementação

1. **P0 de segurança:** criptografia do payload de formulário, revisão da aprovação, política de leitura/escrita, redaction/bounds, validação por navegação e worker isolado com proxy fixado por IP. Testes de URL/DNS rebinding, segredo persistido, escopo/ownership/replay e ausência de saída direta.
2. **Worker e smoke test:** imagem/container dedicado e configuração Compose; build com versão do navegador fixada; worker permanece desligado até o teste de rede. Smoke test em destino público controlado, sem formulário ou mutação externa.
3. **Documentos:** rascunho, revisão, geração DOCX/PDF, download owner-scoped, referências e saneamento de CSV; testes de isolamento, limites, nomes/caminhos, fórmulas e arquivos inválidos.
4. **Skills e MCP:** incluir as cinco skills, atualizar catálogo e expor ferramentas locais com escopo mínimo; testes de token, escopos e ownership.
5. **OAuth calendário:** acrescentar somente leitura para os provedores já suportados, validar consentimento, callback, armazenamento cifrado e desconexão.
6. **Entrega:** testes unitários/integrados relevantes, lint, build, smoke test de runtime local, atualização documental de ponta a ponta e só então ativar Playwright na configuração.

## Critérios de aceitação

- Playwright não acessa destinos privados nem por redirect, subrecurso, hostname Docker, IPv4/IPv6 ou DNS rebinding; tráfego externo passa pelo proxy que valida e fixa o peer.
- Nenhum texto de formulário em claro aparece em SQLite, logs, auditoria ou saída ao modelo antes de revisão; acesso ao payload exige sessão válida, papel e owner correto.
- Operações de escrita falham fechadas sem escopo específico e confirmação explícita; `web` legado não concede escrita.
- A instalação desabilitada continua sem iniciar Chromium; worker responde saúde sem revelar token; sem dependência do browser na imagem principal.
- Screenshot só pode ser lido pelo proprietário e expira dentro do limite configurado.
- Documentos exportados são locais, owner-scoped, baixáveis, abrem em leitores comuns e têm fontes rastreáveis; falhas não deixam arquivo parcial acessível.
- Skills são carregadas por demanda e nunca ampliam permissões; MCP e REST aplicam exatamente o mesmo controle de acesso.
- Calendar OAuth não pede permissões de escrita e tokens permanecem cifrados localmente.
- A documentação descreve somente comportamento que foi realmente testado; build/container ativo corresponde à árvore e imagem validadas.

## Chamadas deixadas ao implementador

- Selecionar bibliotecas DOCX/PDF atuais e mantidas, após verificar compatibilidade Node 22, licenças e superfície de parsing/geração. Preferir geração, não processamento de arquivos executáveis.
- Escolher mecanismo concreto para egress proxy e enforcement no container após validar compatibilidade com a rede Docker externa atual; o critério obrigatório é o teste de bloqueio no nível da conexão, não somente checagem DNS no hook.
- Projetar o preview/confirm modal seguindo componentes e idioma existentes no painel.
- Definir conteúdo e referências das cinco skills com base nas ferramentas realmente disponíveis após as fases anteriores.

## Chamadas explícitas deste desenho

- Calendário OAuth será somente leitura; escrita em serviços externos fica fora desta entrega.
- Não será adicionado Playwright MCP genérico; o Assistente continuará sendo o único gateway de autorização.
- O worker Playwright será serviço separado e opt-in; não será instalado no container principal.
- O armazenamento continuará local; dependências externas poderão ser acessadas apenas por uma ação deliberada e aprovada.
- Aprovações antigas serão preservadas e cifradas in-place; somente uma sessão de administrador verificada, dona do recurso, pode revelar o valor. Todo `click` e `fill` será operação de escrita com confirmação explícita.
