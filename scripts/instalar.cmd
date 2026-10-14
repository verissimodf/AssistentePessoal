@echo off
REM Instalador do Jarvis para Windows 10/11
setlocal
cd /d "%~dp0\.."
echo === J.A.R.V.I.S. - instalacao ===

where node >nul 2>nul || (
  echo Node.js nao encontrado. Instalando via winget...
  winget install -e --id OpenJS.NodeJS.LTS || (echo Instale o Node.js 22+ em https://nodejs.org & exit /b 1)
)
for /f %%v in ('node -p "process.versions.node.split('.')[0]"') do set NODEMAJOR=%%v
if %NODEMAJOR% LSS 22 (echo Requer Node.js 22.13 ou superior. & exit /b 1)

echo [1/3] Dependencias do painel...
call npm install || exit /b 1
echo [2/3] Dependencias do servico local...
pushd server & call npm install & popd
echo [3/3] Pasta de dados local...
if not exist data mkdir data
if not exist .env copy .env.example .env >nul

echo.
echo Instalado. Para iniciar: scripts\jarvis.cmd
echo Voz clonada/local (opcional): scripts\instalar-voz.cmd
endlocal
