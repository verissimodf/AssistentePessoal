@echo off
:: Garante codificação UTF-8 para exibir acentos corretamente
chcp 65001 > nul

echo [JARVIS] Desconectando ecossistema e encerrando serviços em background...

:: 1. Encerra o Servidor Core (procura pelo index.js executado no diretório 'server')
echo [JARVIS] Finalizando servidor Node.js (Core)...
taskkill /f /fi "IMAGENAME eq node.exe" /fi "WINDOWTITLE eq Jarvis - servico local" >nul 2>&1
:: Fallback de segurança para o processo node baseado no caminho do arquivo do servidor
wmic process where "commandline like '%%server%%index.js%%'" call terminate >nul 2>&1

:: 2. Encerra o Painel Web (procura pelo processo do Vite/NPM na porta 8080)
echo [JARVIS] Finalizando painel web (Frontend)...
wmic process where "commandline like '%%npm run dev%%--port 8080%%' or commandline like '%%vite%%'" call terminate >nul 2>&1

:: 3. Encerra o Serviço de Voz (procura pelo script específico rodando no ambiente virtual)
if exist scripts\voz\.venv\Scripts\python.exe (
    echo [JARVIS] Finalizando módulo de inteligência de voz (Python)...
    wmic process where "commandline like '%%voice_service.py%%'" call terminate >nul 2>&1
)

echo [JARVIS] Todos os serviços foram finalizados com sucesso.
timeout /t 3 /nobreak > nul
