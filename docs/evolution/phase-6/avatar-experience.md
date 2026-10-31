# Avatar Experience (Fase 6)

## Objetivo (§9)

Representar visualmente o estado REAL da interação homem-máquina — sem simular
capacidades inexistentes. A camada é **desacoplada** do motor de conversa, STT e TTS:
o componente recebe um estado derivado (`avatarStateFromTurn`) e nada mais.

## Estados (§9.2) e sua fonte da verdade

| Estado do avatar | Fonte (estado real) |
|---|---|
| `idle` | sem turno ativo; última interação concluída |
| `listening` | turno `listening` **E** microfone capturando (tracks ativas no cliente) |
| `thinking` | turnos `transcribing` / `processing` / `generating` |
| `speaking` | **áudio TTS realmente em reprodução** (eventos play do `<audio>`) |
| `interrupted` | turno `interrupted` |
| `error` | turno `failed` |
| `unavailable` | sessão fechada ou modalidade indisponível |

Regras duras implementadas e testadas:
- **Nunca** exibir animação de fala sem áudio em reprodução;
- **Nunca** indicar escuta com o microfone desligado;
- Estados derivam de eventos e do estado persistido dos turnos (§9.3), não de timers
  otimistas.

## Implementação visual (§9.4)

- **SVG + CSS puro**, zero dependências gráficas (ADR-MM-006): núcleo com anéis; cada
  estado tem forma/movimento próprios (respiração, pulsos, órbita, ondas, traço).
- **Fallback estático**: com `prefers-reduced-motion: reduce` as animações são
  desligadas e o estado é distinguido por cor/ícone — a interface nunca depende do
  movimento.
- A interface funciona SEM o avatar (componente isolado; falha de render não bloqueia
  a conversa).

## Performance (§9.5)

- Apenas transformações/opacity CSS (compositor, sem reflow); nenhum canvas/WebGL.
- Sem carregamento de ativos externos (SVG inline).
- Respeito à redução de movimento (bateria/CPU em dispositivos móveis).
