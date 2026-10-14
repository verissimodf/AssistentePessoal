@echo off
REM Opcional: voz local (Kokoro) e voz clonada (XTTS-v2), offline apos baixar os modelos.
REM
REM O kokoro exige Python <3.13, entao 3.13 e 3.14 nao servem. Procuramos um 3.11, 3.12 ou
REM 3.10 de verdade em vez de so testar se o launcher "py" existe: o launcher pode estar
REM instalado sem nenhuma dessas versoes, e nesse caso o script caia no "python" do PATH
REM (em geral a versao mais nova do sistema), criando uma .venv onde o pip nao consegue
REM resolver coqui-tts/kokoro e falhando no fim, depois de parecer que tudo deu certo.
setlocal
cd /d "%~dp0\voz"

set "PY="
for %%v in (3.11 3.12 3.10) do (
  if not defined PY (
    py -%%v --version >nul 2>nul && set "PY=py -%%v"
  )
  if not defined PY (
    python%%v --version >nul 2>nul && set "PY=python%%v"
  )
)

if not defined PY (
  echo Python 3.10-3.12 nao encontrado. Instalando o 3.11...
  winget install -e --id Python.Python.3.11 || (echo Instale o Python 3.11 em https://www.python.org/downloads/ & exit /b 1)
  py -3.11 --version >nul 2>nul && set "PY=py -3.11"
)

if not defined PY (
  echo [erro] Nao encontrei um Python 3.10, 3.11 ou 3.12 ^(o kokoro exige ^<3.13^).
  echo        Se acabou de instalar, abra um terminal novo e rode este script de novo.
  exit /b 1
)

for /f "tokens=*" %%d in ('%PY% --version 2^>^&1') do echo Usando %%d
%PY% -m venv .venv || (echo [erro] Falha ao criar a .venv. & exit /b 1)
.venv\Scripts\python -m pip install --upgrade pip || exit /b 1
.venv\Scripts\python -m pip install coqui-tts kokoro soundfile numpy || (
  echo [erro] Falha ao instalar os pacotes de voz. Apague scripts\voz\.venv e tente de novo.
  exit /b 1
)
echo Pronto. No painel: Configuracoes ^> Voz e ativacao ^> Motor de voz = Kokoro ou XTTS-v2.
endlocal
