# Solução de problemas

| Sintoma | Causa provável | Solução |
|---|---|---|
| Indicador “Modo demonstração” | serviço local parado | rode `scripts/jarvis`; teste `http://127.0.0.1:7777/api/health` |
| `node:sqlite` não encontrado | Node antigo | instale Node 22.13+ |
| “origin not allowed” | painel aberto por outro endereço | adicione-o em `JARVIS_ALLOWED_ORIGINS` |
| Microfone não funciona | navegador sem permissão ou Firefox | use Chrome/Edge e permita o microfone |
| Palmas não disparam | sensibilidade baixa | aumente e use **Testar palmas** |
| Ollama 404 | modelo não baixado | `ollama pull llama3.1` |
| Comando recusado | Ações no host desligadas | Configurações → Geral → Ações no host |
| Voz local 500 | serviço Python não instalado | `scripts/instalar-voz` |
| `instalar-voz` falha no `pip install` (`coqui-tts`/`kokoro` sem versão compatível) | a `.venv` foi criada com Python 3.13+ porque o `py -3.11` não existe e o script caiu no `python` do PATH | instale o 3.11 (`winget install -e --id Python.Python.3.11`), apague `scripts\voz\.venv` e rode o instalador de novo |
| Voz clonada (XTTS) não aparece | `.venv` da voz ausente ou incompleta | confira `scripts\voz\.venv`; o `jarvis.cmd` só sobe o serviço de voz se `scripts\voz\.venv\Scripts\python.exe` existir |
| Gmail recusa login | senha normal | use senha de app |
