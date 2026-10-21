@echo off
:: Garante codificação UTF-8 para exibir acentos corretamente no prompt
chcp 65001 > nul
setlocal

:: Garante que o instalador execute a partir da raiz do repositório
cd /d "%~dp0\.."
echo ==============================================================================
echo 🦾 J.A.R.V.I.S. - SISTEMA DE INSTALAÇÃO AUTOMÁTICA (WINDOWS)
echo ==============================================================================

:: 1. Verificação e Instalação Automatizada do Node.js
where node >nul 2>nul
if %errorlevel% neq 0 (
    echo [INSTALADOR] Node.js não foi detectado no sistema.
    echo [INSTALADOR] Iniciando instalação automática da versão LTS via winget...
    winget install -e --id OpenJS.NodeJS.LTS --silent --accept-source-agreements --accept-package-agreements
    if %errorlevel% neq 0 (
        echo [ERRO] Falha ao instalar via winget. Por favor, instale o Node.js 22+ manualmente em https://nodejs.org
        pause
        exit /b 1
    )
    echo [INSTALADOR] Node.js instalado com sucesso!
    echo [INSTALADOR] Atualizando variáveis de ambiente da sessão atual...
    :: Atualiza o PATH do terminal atual sem precisar fechar e abrir de novo o CMD
    for /f "tokens=2*" %%a in ('reg query "HKLM\System\CurrentControlSet\Control\Session Manager\Environment" /v Path') do set "Path=%%b"
    for /f "tokens=2*" %%a in ('reg query "HKCU\Environment" /v Path') do set "Path=%%b;%Path%"
)

:: 2. Validação Rígida da Versão do Node.js (Requer v22.13.0+)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (
    echo [ERRO] O Jarvis requer o Node.js na versão 22 ou superior.
    echo [ERRO] Sua versão atual detectada é a v%NODEMAJOR%. Por favor, atualize em https://nodejs.org
    pause
    exit /b 1
)

:: 3. Instalação das Dependências do Frontend (Painel Web)
echo.
echo [1/4] Instalando dependências do Painel Web (Frontend TanStack)...
call npm install --no-audit --no-fund || (echo [ERRO] Falha ao instalar dependências do Frontend. & pause & exit /b 1)

:: 4. Instalação das Dependências do Servidor Local (Backend)
echo.
echo [2/4] Instalando dependências do Serviço Local (Backend Node)...
if exist server (
    pushd server
    call npm install --no-audit --no-fund || (echo [ERRO] Falha ao instalar dependências do Servidor. & popd & pause & exit /b 1)
    popd
) else (
    echo [ERRO] Direitório /server não encontrado! Verifique a integridade do repositório.
    pause
    exit /b 1
)

:: 5. Criação da Estrutura de Pastas e Configuração de Ambiente (.env)
echo.
echo [3/4] Estruturando diretórios locais de persistência...
if not exist data mkdir data

if not exist .env (
    echo [4/4] Criando arquivo de configuração .env a partir do modelo...
    if exist .env.example (
        copy .env.example .env > nul
        
        echo [INSTALADOR] Gerando chave de criptografia de segurança AES-256 local...
        :: Usa o próprio Node recém-validado para gerar uma chave aleatória e segura no .env
        for /f "delims=" %%g in ('node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"') do set "SECRET_HEX=%%g"
        
        :: Atualiza a linha ENCRYPTION_KEY dentro do .env criado
        powershell -Command "(Get-Content .env) -replace 'ENCRYPTION_KEY=.*', 'ENCRYPTION_KEY=%SECRET_HEX%' | Set-Content .env" 2>nul
        echo [INSTALADOR] Chave de segurança aplicada com sucesso ao seu .env!
    ) else (
        echo [AVISO] .env.example não encontrado. Lembre-se de criar seu arquivo .env manualmente.
    )
) else (
    echo [4/4] Arquivo .env existente detectado. Pulando etapa de criação para proteger seus dados.
)

:: 6. Finalização e Próximos Passos
echo.
echo ==============================================================================
echo 🎉 INSTALAÇÃO CONCLUÍDA COM SUCESSO!
echo ==============================================================================
echo.
echo 💻 Para iniciar o J.A.R.V.I.S. em segundo plano: scripts\jarvis.cmd
echo 🎙️ Para ativar clonagem de voz local (opcional): scripts\instalar-voz.cmd
echo.
pause
endlocal
