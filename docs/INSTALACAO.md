# Guia de Instalação e Configuração — J.A.R.V.I.S.

> **Atualizado para a 1.10.0.** Em produção, a via recomendada é **Docker Compose**
> (`docker-compose.yml`) com atualização assistida por `npm run update:release` — ver
> `docs/IMPLANTACAO.md` e `docs/RUNBOOK-RELEASE-2026-10-18.md`. Este guia cobre a instalação
> manual: permissões, execução em segundo plano e inicialização automática como serviço
> persistente tanto em **Windows 10/11** quanto em **Servidores Linux (Ubuntu, Debian, CentOS, RHEL)**.

---

## 1. Pré-requisitos e Dependências

| Plataforma | Instruções de Instalação do Node.js (>=22.13 LTS) e IA Offline |
|---|---|
| **Windows 10/11** | `winget install -e --id OpenJS.NodeJS.LTS`<br>*(Opcional)* IA Offline: `winget install Ollama.Ollama` |
| **Ubuntu / Debian** | `curl -fsSL https://deb.nodesource.com/setup_22.x \| sudo -E bash - && sudo apt install -y nodejs`<br>*(Opcional)* IA Offline: `curl -fsSL https://ollama.com/install.sh \| sh` |
| **CentOS / RHEL / Fedora** | `sudo dnf module install -y nodejs:22` (ou via NodeSource rpm)<br>*(Opcional)* IA Offline: `curl -fsSL https://ollama.com/install.sh \| sh` |

---

## 2. Download do Projeto

- **Via Git Clone (Recomendado):**
  ```bash
  git clone https://github.com/verissimodf/AssistentePessoal.git
  cd AssistentePessoal
  ```
- **Via Pacote ZIP:**
  Extraia o pacote em uma pasta de sua preferência, por exemplo `C:\jarvis` (no Windows) ou `/opt/jarvis` / `~/jarvis` (no Linux).
  > [!TIP]
  > No Windows, evite instalar dentro de `C:\Program Files`, pois a pasta exige privilégios elevados de administrador para escrita do banco de dados SQLite local.

---

## 3. Instalação e Execução no Windows 10/11

### 3.1. Liberação de Execução do PowerShell
Por padrão, o Windows restringe a execução de scripts automáticos. Execute o PowerShell como usuário comum e libere a execução:
```powershell
Set-ExecutionPolicy -ExecutionPolicy RemoteSigned -Scope CurrentUser
```

### 3.2. Configuração de Variáveis de Ambiente
O instalador gera o arquivo `.env` a partir do template `.env.example`. Caso deseje ajustar manualmente:
1. Copie `.env.example` para `.env`:
   ```cmd
   copy .env.example .env
   ```
2. Defina uma chave mestra para criptografia AES-256-GCM (se não definida, uma chave segura será gerada automaticamente em `data/master.key`):
   ```env
   JARVIS_MASTER_KEY=sua_chave_mestra_secreta_aqui
   JARVIS_HOST=127.0.0.1
   JARVIS_PORT=7777
   PANEL_PORT=8090
   ```

### 3.3. Instalação Rápida e Execução em Background
Execute o script de instalação automatizada:
```cmd
scripts\instalar.cmd
```
O script verifica a versão do Node.js, instala as dependências via `npm install`, cria o diretório `data/` para o SQLite local e prepara os assets.

**Para iniciar o J.A.R.V.I.S. em segundo plano:**
```cmd
scripts\jarvis.cmd
```
O script inicia o backend e o frontend de forma silenciosa e abre o navegador automaticamente após a confirmação do boot.

**Para parar os serviços em segundo plano:**
```cmd
scripts\stop_jarvis.cmd
```

### 3.4. Inicialização Automática no Boot do Windows
Crie um atalho na pasta de inicialização do usuário:
```powershell
$s = (New-Object -ComObject WScript.Shell).CreateShortcut("$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Jarvis.lnk")
$s.TargetPath = "$PWD\scripts\jarvis.cmd"
$s.WorkingDirectory = "$PWD"
$s.Save()
```

---

## 4. Instalação e Execução em Servidores Linux (Ubuntu / Debian / CentOS)

### 4.1. Permissões de Execução
No diretório do projeto, conceda permissão de execução a todos os scripts auxiliares:
```bash
chmod +x scripts/*.sh
```

### 4.2. Instalação Automatizada
Execute o assistente de instalação Linux:
```bash
./scripts/instalar.sh
```

### 4.3. Configuração de Serviço Persistente via Systemd
Para que o J.A.R.V.I.S. permaneça em execução contínua e reinicie automaticamente após reinicializações do servidor, crie o arquivo de serviço `/etc/systemd/system/jarvis.service`:

```ini
[Unit]
Description=J.A.R.V.I.S. Personal Assistant Daemon
After=network.target

[Service]
Type=simple
User=jarvis
WorkingDirectory=/opt/jarvis
ExecStart=/usr/bin/node server/index.js
Restart=always
RestartSec=5
Environment=NODE_ENV=production
EnvironmentFile=/opt/jarvis/.env

# Limites e Segurança do Processo
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=multi-user.target
```

Ative e inicialize o serviço:
```bash
sudo systemctl daemon-reload
sudo systemctl enable --now jarvis.service
sudo systemctl status jarvis.service
```

### 4.4. Acesso Remoto Seguro via Proxy Tailscale
Para acessar o assistente fora da rede local de forma privada e segura (sem expor portas públicas na WAN):
```bash
node scripts/tailnet-proxy.mjs
```
O script mapeia a API (`7777`) e a Web UI (`8090`) exclusivamente para o IP da sua rede privada Tailscale (Tailnet).

---

## 5. Validação da Instalação e Teste de Saúde (Health Check)

Após iniciar o assistente, confirme que a API responde com sucesso:

```bash
curl http://127.0.0.1:7777/api/health
```

**Resposta JSON Esperada:**
```json
{
  "ok": true,
  "version": "1.7.8",
  "commit": "<sha>",
  "buildTime": "<RFC3339>",
  "mode": "production",
  "schemaVersion": 12,
  "schemaVersionBuild": 12,
  "commitStatus": "Registrado",
  "setupRequired": false
}
```

Acesse o painel no navegador em **`http://localhost:8080`** (modo dev) ou **`http://localhost:8090`** (build de produção local). Em produção o painel é servido por `https://jarvis.laytech.com.br`; ver `README.md` e `docs/RUNBOOK-RELEASE-2026-10-18.md`.

---

## 6. Síntese e Clonagem de Voz Local (Opcional)

Requisitos: **Python 3.10, 3.11 ou 3.12** (o motor Kokoro exige versão inferior a 3.13).

1. No Windows:
   ```cmd
   winget install -e --id Python.Python.3.11
   scripts\instalar-voz.cmd
   ```
2. No Linux:
   ```bash
   sudo apt install -y python3.11-venv
   ./scripts/instalar-voz.sh
   ```
3. No painel web: acesse **Configurações → Voz e ativação → Enviar amostra de voz** e selecione o motor **XTTS-v2** para clonagem zero-shot.
