@echo off
REM Inicia o servico local + painel e abre o navegador
cd /d "%~dp0\.."
start "Jarvis - servico local" cmd /k "cd server && node --no-warnings index.js"
if exist scripts\voz\.venv\Scripts\python.exe start "Jarvis - voz" cmd /k "scripts\voz\.venv\Scripts\python.exe scripts\voz\voice_service.py"
start "Jarvis - painel" cmd /k "npm run dev -- --port 8080"
timeout /t 6 >nul
start http://localhost:8080
