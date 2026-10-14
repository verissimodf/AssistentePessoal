# Contribuindo

1. Faça um fork e crie um branch: `git checkout -b melhoria/minha-ideia`.
2. Rode os testes: `scripts\testar.cmd` ou `./scripts/testar.sh`.
3. Abra um pull request usando o modelo em `.github/pull_request_template.md`.

Regras: nunca comite `data/` nem `.env`; toda nova ação no host passa por `server/hostpolicy.js` e ganha teste em `tests/`.
