# Instalação

## 1. Dependências
| Sistema | Comando |
|---|---|
| Windows | `winget install -e --id OpenJS.NodeJS.LTS` (Node 22.13+) e, se quiser IA offline, `winget install Ollama.Ollama` |
| Ubuntu/Debian | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs` e `curl -fsSL https://ollama.com/install.sh \| sh` |

## 2. Baixar
- **ZIP**: extraia em uma pasta, por exemplo `C:\jarvis` ou `~/jarvis`.
- **GitHub**: `git clone https://github.com/laytech-ia-debug/AssistentePessoal.git && cd AssistentePessoal`.

O caminho `C:\jarvis` é o usado como exemplo no resto da documentação (inclusive na configuração
do MCP, em [CONFIGURACAO.md](CONFIGURACAO.md)). Evite instalar dentro de `C:\Program Files`, onde
a escrita exige privilégio de administrador.

## 3. Instalar e iniciar
```cmd
scripts\instalar.cmd   &  scripts\jarvis.cmd
```
```bash
./scripts/instalar.sh  && ./scripts/jarvis.sh
```

O `instalar` confere a versão do Node, roda `npm install` na raiz e em `server/`, cria `data/` e
copia `.env.example` para `.env`. Ele leva alguns minutos e **não imprime nada durante o
`npm install`** — é normal.

Antes de iniciar, vale rodar os testes (opcional, ~30 s):

```cmd
npx vitest run
node --test tests/hostpolicy.test.mjs
```

Esperado: 7 testes do painel e 6 da política de host, todos passando.

Depois do `jarvis`, confirme que o serviço respondeu:

```cmd
curl http://127.0.0.1:7777/api/health
```

Resposta esperada: `{"ok":true,"version":"1.0.0","name":"Jarvis","platform":"win32"}`.

## 4. Primeiro uso
1. Abra `http://localhost:8080` — o indicador deve mostrar **Conectado ao Jarvis local**.
2. Em **Configurações → Provedores de IA**, ligue um provedor (ex.: Ollama) e clique **Testar**.
3. Em **Agentes**, confira o provedor/modelo do agente ativo (estrela).
4. Na **Conversa**, clique no microfone ou ligue **Métodos de ativação** e bata palmas duas vezes.

## 5. Voz local e clonada (opcional)

Precisa de **Python 3.10, 3.11 ou 3.12** — o `kokoro` exige `<3.13`, então 3.13 e 3.14 **não**
funcionam.

O instalador procura um 3.11, 3.12 ou 3.10 e avisa se não achar nenhum; no Windows ele tenta
instalar o 3.11 com o winget. Se você já sabe que não tem uma dessas versões, adiantar o passo
evita a ida e volta:

```cmd
winget install -e --id Python.Python.3.11
py -3.11 --version
```

O segundo comando deve responder `Python 3.11.x`. Se você acabou de instalar e ele não responder,
abra um terminal novo. No Linux, instale o pacote `venv` da versão correspondente (ex.:
`sudo apt install python3.12-venv`) ou use `uv venv -p 3.12`.

Uma observação sobre o `py --list`: interpretadores gerenciados pelo **uv** aparecem como
`Astral/CPython3.12.15` e **não** respondem a `py -3.12`. Mesmo assim o instalador os encontra,
porque o uv também deixa um `python3.12` no PATH — foi assim que a instalação de referência rodou.
Se ainda assim nenhum for achado, dá para criar a `.venv` à mão:

```cmd
uv venv -p 3.12 scripts\voz\.venv
scripts\voz\.venv\Scripts\python -m pip install coqui-tts kokoro soundfile numpy
```

Depois rode o instalador (~2 GB de modelos no primeiro uso):

```cmd
scripts\instalar-voz.cmd
```
```bash
./scripts/instalar-voz.sh
```

Por fim: **Configurações → Voz e ativação → Enviar amostra de voz** e escolha **XTTS-v2** como motor.

## Iniciar com o sistema
- **Windows**: `Win+R` → `shell:startup` → crie nessa pasta um atalho para
  `C:\jarvis\scripts\jarvis.cmd`. Pela linha de comando:
  ```powershell
  $s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Jarvis.lnk")
  $s.TargetPath = 'C:\jarvis\scripts\jarvis.cmd'; $s.WorkingDirectory = 'C:\jarvis'; $s.Save()
  ```
  Para rodar como serviço, veja o NSSM em [IMPLANTACAO.md](IMPLANTACAO.md).
- **Linux**: veja o serviço systemd em [IMPLANTACAO.md](IMPLANTACAO.md).
