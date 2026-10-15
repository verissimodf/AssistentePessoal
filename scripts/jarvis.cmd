@echo off
:: Garante codificação UTF-8 para exibir acentos corretamente se necessário
chcp 65001 > nul

:: Garante que o script execute a partir da raiz do repositório
cd /d "%~dp0\.."

:: 1. Verificação Automática e Criação do .env
if not exist .env (
    echo [JARVIS] Arquivo .env não encontrado. Clonando a partir do .env.example...
    if exist .env.example (
        copy .env.example .env > nul
        echo [JARVIS] Arquivo .env criado com sucesso! Lembre-se de configurar suas chaves depois.
    ) else (
        echo [ERRO] .env.example não foi encontrado. Crie um arquivo .env manualmente.
        pause
        exit /b 1
    )
)

:: 2. Criação do motor de execução oculta (VBScript temporário)
:: Esse arquivo diz ao Windows para executar comandos de terminal com a janela invisível (estilo 0)
set "VBS_LAUNCHER=%TEMP%\jarvis_hidden_launcher.vbs"
echo Set WshShell = CreateObject("WScript.Shell") > "%VBS_LAUNCHER%"
echo WshShell.Run "cmd /c cd server && node --no-warnings index.js", 0, false >> "%VBS_LAUNCHER%"

:: Verifica e adiciona o serviço de voz em background apenas se o ambiente virtual existir
if exist scripts\voz\.venv\Scripts\python.exe (
    echo WshShell.Run "cmd /c scripts\voz\.venv\Scripts\python.exe scripts\voz\voice_service.py", 0, false >> "%VBS_LAUNCHER%"
)

:: Adiciona o painel web frontend em background
echo WshShell.Run "cmd /c npm run dev -- --port 8080", 0, false >> "%VBS_LAUNCHER%"

:: 3. Executa o lançador silencioso
wscript.exe "%VBS_LAUNCHER%"

:: 4. Limpeza e Inicialização do Navegador
:: Remove o arquivo temporário imediatamente após a execução para não sujar o sistema
del "%VBS_LAUNCHER%" > nul 2>&1

echo [JARVIS] Todos os serviços foram iniciados em background com sucesso!
echo [JARVIS] Aguardando inicialização do ecossistema para abrir a interface...

:: Aguarda 6 segundos em modo silencioso e abre a interface do painel web
timeout /t 6 /nobreak > nul
start http://localhost:8080

