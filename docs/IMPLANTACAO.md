# Implantação (servidor / sempre ligado)

## Linux com systemd
```ini
# /etc/systemd/system/jarvis.service
[Unit]
Description=Jarvis local
After=network.target

[Service]
WorkingDirectory=/opt/jarvis/server
ExecStart=/usr/bin/node --no-warnings index.js
Restart=always
User=jarvis

[Install]
WantedBy=multi-user.target
```
`sudo systemctl enable --now jarvis`. Para o painel, gere a versão de produção com `npm run build`
e rode `npm run preview -- --port 8080`, ou mantenha `npm run dev`.

## Windows
Use o Agendador de Tarefas → “Ao fazer logon” → `scripts\jarvis.cmd`, ou [NSSM](https://nssm.cc) para rodar
`node --no-warnings index.js` como serviço:

```cmd
nssm install Jarvis "C:\Program Files\nodejs\node.exe" "--no-warnings index.js"
nssm set Jarvis AppDirectory C:\jarvis\server
nssm start Jarvis
```

Como serviço, só o backend sobe — o painel precisa ser servido à parte
(`npm run build` e `npm run preview -- --port 8080`). Para só iniciar no logon, o atalho em
`shell:startup` é mais simples: veja [INSTALACAO.md](INSTALACAO.md).

## Acesso por outro computador da rede
`JARVIS_HOST=0.0.0.0` e `JARVIS_ALLOWED_ORIGINS=http://IP-DO-SERVIDOR:8080`; no painel, **Geral → Endereço do Jarvis local** = `http://IP-DO-SERVIDOR:7777`. Use apenas em rede confiável.

## Publicar no GitHub
```bash
git init && git add . && git commit -m "Assistente pessoal 1.0"
git remote add origin https://github.com/laytech-ia-debug/AssistentePessoal.git && git push -u origin main
```
`data/`, `.env`, `node_modules/` e `scripts/voz/.venv/` já estão no `.gitignore` — confira com
`git status` antes do primeiro commit, porque é ali que ficam o banco, as amostras de voz e a
chave mestra.
