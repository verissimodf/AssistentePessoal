@echo off
cd /d "%~dp0\.."
call npx vitest run || exit /b 1
node --no-warnings --test tests\
