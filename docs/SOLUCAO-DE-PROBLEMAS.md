# Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Indicador “Modo demonstração” | serviço local parado | rode `scripts/jarvis`; teste `http://127.0.0.1:7777/api/health` |
| “Modo demonstração” mesmo com o serviço no ar | painel aberto pelo **IP da máquina** (ex.: `http://192.168.4.121:8080`). O serviço só confia em origens `localhost`/`127.0.0.1`, devolve 403 e o painel cai no modo demonstração | abra `http://localhost:8080`. Para usar o IP de propósito, veja “Acesso por outro computador” em [IMPLANTACAO.md](IMPLANTACAO.md) |
| `node:sqlite` não encontrado | Node antigo | instale Node 22.13+ |
| “origin not allowed” | painel aberto por outro endereço | adicione-o em `JARVIS_ALLOWED_ORIGINS` |
| Erro `ECONNREFUSED` em `localhost:11434` ao conversar | o **agente** continua apontando para o Ollama. Ligar outro provedor em Configurações não troca o provedor do agente | **Agentes** → agente ativo (estrela) → mude **Provedor** e **Modelo** |
| `is not valid JSON` com `data: {...}` no começo | o provedor respondeu em `text/event-stream` (SSE). Corrigido no `server/llm.js`, que agora envia `stream: false` | atualize o projeto; se mantiver uma versão antiga, acrescente `stream: false` ao corpo em `callOpenAI` |
| Microfone: `not-allowed`, `abort`, `network` | a Web Speech API do Chrome/Edge exige **contexto seguro**: `localhost`/`127.0.0.1` ou HTTPS. Pelo IP da rede em HTTP ela nega o microfone (`not-allowed`) e falha o reconhecimento (`network`) | abra o painel em `http://localhost:8080` e permita o microfone no cadeado da barra de endereço |
| Microfone não funciona | navegador sem permissão ou Firefox | use Chrome/Edge e permita o microfone |
| Campo de API Key aparece vazio depois de salvar | é o comportamento esperado: a chave é cifrada e **nunca** volta ao navegador. O campo mostra `••••••••` como placeholder e o provedor fica com `hasKey: true` | confirme com **Testar** no provedor; para trocar a chave, digite a nova (campo vazio mantém a guardada) |
| `http://127.0.0.1:7777` não abre nada no navegador | esperado: a porta 7777 é só a API, não serve páginas. A raiz responde 404 | o painel é o `:8080`; para checar o serviço use `http://127.0.0.1:7777/api/health` |
| Palmas não disparam | sensibilidade baixa | aumente e use **Testar palmas** |
| Ollama 404 | modelo não baixado | `ollama pull llama3.1` |
| Comando recusado | Ações no host desligadas | Configurações → Geral → Ações no host |
| Voz local 500 | serviço Python não instalado | `scripts/instalar-voz` |
| `instalar-voz` falha no `pip install` (`coqui-tts`/`kokoro` sem versão compatível) | a `.venv` foi criada com Python 3.13+ porque o `py -3.11` não existe e o script caiu no `python` do PATH | instale o 3.11 (`winget install -e --id Python.Python.3.11`), apague `scripts\voz\.venv` e rode o instalador de novo |
| Voz clonada (XTTS) não aparece | `.venv` da voz ausente ou incompleta | confira `scripts\voz\.venv`; o `jarvis.cmd` só sobe o serviço de voz se `scripts\voz\.venv\Scripts\python.exe` existir |
| Gmail recusa login | senha normal | use senha de app |
