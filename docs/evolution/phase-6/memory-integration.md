# Memória Multimodal (Fase 6)

## Distinções preservadas (§11)

A camada multimodal **não cria memória nova** e não reclassifica nada:

| Conteúdo | Onde vive | Natureza |
|---|---|---|
| Transcrição | `mm_turns.transcript_json` | entrada candidata (com `corrected`) |
| Mensagem enviada | `conversation_messages` (role `user`) | entrada efetiva da conversa |
| Resposta do sistema | `conversation_messages` (role `assistant`) + `mm_turns.output_text` | saída |
| Evidência externa | Knowledge Hub / `execution_evidence` (Fases 2/5) | citável, verificada |
| Preferência declarada | `admin_settings` | explícita do admin |
| Memória episódica/semântica | `memories` (fluxo existente de remember/recall) | intocada |
| Memória procedural | `ci_procedures` (Fase 5) | intocada |

## Regras

- **Áudio não vira memória automática**: transcrever e enviar uma frase não grava
  memória nenhuma; apenas a conversa recebe a mensagem (como na digitação). Lembranças
  continuam dependendo das ferramentas `remember`/`recall` explícitas do fluxo existente.
- **Áudio bruto não é armazenado**: transcrição + metadados bastam (ADR-MM-003).
- **Retenção e exclusão consistentes**: excluir a conversa (fluxo existente) remove as
  mensagens; as linhas `mm_turns` mantêm apenas texto/metadados do turno; eventos são
  limitados a 500 por sessão; sessões expiram em 2 h.
- **Ownership**: `mm_sessions` tem linha própria em `ownership`; dados de outro admin
  são invisíveis (404 uniforme).
- **Nenhuma inferência de atributos sensíveis a partir de áudio**: o servidor não analisa
  o áudio além de encaminhá-lo ao STT local; idioma é o solicitado, não inferido.
