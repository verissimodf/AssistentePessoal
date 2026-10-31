# Limitações Reais e Itens Adiados — Fase 5

## Interpretação visual

1. **Sem dump estruturado de DOM/a11y** — o worker v1 retorna texto + título + URL (sem árvore
   de acessibilidade/coordenadas); a identificação de elementos é por seletores propostos pelo
   plano (semânticos quando a página usa ids/roles) + verificação pós-ação. OCR/vision model
   NÃO integrados (o screenshot é evidência visual, não entrada de visão computacional).
2. **Confiança de elemento simplificada** — identified/probable/ambiguous derivam do resultado
   da verificação (e pós-observação), não de um modelo de grounding visual dedicado.

## Execução

3. **Cada escrita = 1 aprovação D9** — sem batch de aprovações (fluxos longos geram várias);
   revisitável com "síntese de plano aprovável como um todo" (decisão de produto).
4. **Modo gerenciado exige worker** — sem socket do worker, a sessão falha com
   `ci_browser_disabled`/`browser_worker_required` (indisponibilidade explícita, sem simulação).
5. **Scroll não é nativo no worker** — mapeado para `wait_for`; `select` mapeado para `fill`.

## Procedural

6. **Validação procedural por contagem** — tested (1 verificação) → validated (2 sucessos
   consecutivos) → deprecated (2 falhas); sem assinatura criptográfica da interface (hash de
   observação é a âncora).
7. **Procedimentos são por admin** — sem biblioteca compartilhada de procedimentos.

## Plataforma

8. **Nós de workflow dedicados não registrados** — a execução de Computer Intelligence via
   Workflow Studio acontece por ferramentas dos agentes (computer_*) e API; nós dedicados
   (computer_session/execute no grafo) ficam para a integração completa (requer transporte de
   sessão entre nós — adiada para não duplicar o runtime da Fase 1).
9. **Narração multimodal** — fora do escopo (Fase 6).
