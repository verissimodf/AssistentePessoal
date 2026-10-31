# Build e Imagem Docker — Fase 9

## Estado atual (árvore de trabalho, pré-commit)

| Verificação | Resultado |
|---|---|
| Build do frontend (`npm run build`) | OK |
| `docker compose` | OK |
| TypeScript / ESLint | 0 / 0 |

## Histórico do verificador de imagem

O verificador `scripts/verificar-imagem-release.sh` foi executado e **APROVADO nas
fases 6, 7 e 8** — imagem construída, **schema correto** e artefatos íntegros.

## F9: executar APÓS o commit

A verificação da imagem da F9 **deve rodar depois do commit final**
(`feat(evolution): finalize platform consolidation and readiness`), pois o
`BUILD_COMMIT` precisa apontar para o commit real. Procedimento:

```bash
# 1. Commit da F9 (fora do escopo deste documento — decisão do operador)

# 2. Capturar o hash do commit
BUILD_COMMIT=$(git rev-parse HEAD)

# 3. Construir a imagem com o commit embutido
docker build --build-arg BUILD_COMMIT="$BUILD_COMMIT" -t jarvis:"$BUILD_COMMIT" .

# 4. Verificar a imagem (mesmo verificador aprovado nas fases 6-8)
./scripts/verificar-imagem-release.sh jarvis:"$BUILD_COMMIT"
```

**Resultado esperado**: APROVADO, com `BUILD_COMMIT` igual ao hash do passo 1 e
schema correto. *(executar após o commit — o resultado não pôde ser registrado antes
porque o hash não existe ainda)*

## Observações

- O `build-info` da imagem é gerado por `scripts/write-build-info.mjs` e validado por
  `tests/build-info.test.mjs`.
- A imagem não contém segredos; credenciais e banco vivem apenas no volume local do
  operador.
- Compose validado sobe os serviços declarados (backend + painel); serviços externos
  opcionais (STT) têm indisponibilidade explícita — ver
  [limitations.md](limitations.md).
