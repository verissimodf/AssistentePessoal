# 🚀 Contribuindo para o AssistentePessoal

Primeiramente, obrigado por demonstrar interesse em melhorar o AssistentePessoal! Este é um projeto focado em privacidade e IA local, e a colaboração da comunidade é fundamental para torná-lo ainda melhor.

Ao contribuir, você concorda em manter o código limpo, documentado e em respeitar as diretrizes abaixo.

---

## 🐛 Como Abrir uma Issue

Antes de abrir uma Issue, verifique na aba de **Issues** do repositório se alguém já não relatou o mesmo problema ou sugeriu a mesma melhoria.

Se o problema for inédito, clique em **New Issue** e forneça as seguintes informações:
1. **Título Claro:** Resuma o problema ou sugestão (ex: *[BUG] Erro de conexão com Ollama no Windows*).
2. **Descrição do Problema:** O que está acontecendo e o que era esperado ocorrer.
3. **Passo a Passo para Reproduzir:** Como podemos fazer o erro acontecer na nossa máquina.
4. **Ambiente Técnico:**
   - Sistema Operacional (Windows 10/11, Ubuntu, etc.)
   - Versão do Node.js (`node -v`)
   - Versão do Python (`python -v`) — se aplicar ao módulo de voz.
5. **Logs ou Capturas de Tela:** Se aplicável, adicione o output do console ou erros do arquivo de log.

---

## 🛠️ Como Enviar um Pull Request (PR)

Seguimos o fluxo padrão do GitHub (*Fork e Pull Request*). Para enviar suas alterações, siga este passo a passo:

### 1. Faça um Fork e Clone o Repositório
Clone o seu fork localmente na sua máquina:
```bash
git clone https://github.com
cd AssistentePessoal
```

### 2. Crie uma Branch para a sua Feature ou Bugfix
Use nomes descritivos separados por hífen:
```bash
git checkout -b feature/nome-da-sua-feature
# ou
git checkout -b fix/correcao-do-bug
```

### 3. Desenvolva e Teste suas Alterações
- Certifique-se de que o código segue o padrão estético do projeto (rodar o Prettier/ESLint se configurado).
- Garanta que a instalação rápida (`instalar.cmd` ou `instalar.sh`) continua funcionando após suas mudanças.
- Valide o endpoint de saúde local: `curl http://127.0.0`.

### 4. Commits Limpos e Descritivos
Escreva mensagens de commit claras e em português ou inglês. Evite commits genéricos como "ajustes".
```bash
git commit -m "feat: adiciona suporte ao novo provedor de IA X"
```

### 5. Envie para o GitHub e Abra o PR
Faça o push da sua branch para o seu fork:
```bash
git push origin feature/nome-da-sua-feature
```
Vá até a página original do repositório no GitHub, você verá um botão verde sugerindo **"Compare & pull request"**.

### Regras para Aprovação de PRs:
- O PR deve focar em resolver **apenas um problema ou adicionar uma única feature**. PRs gigantescos com múltiplas mudanças aleatórias serão recusados.
- Descreva detalhadamente no corpo do PR o que foi alterado e o porquê.
- Se a sua alteração exigir novas variáveis no arquivo `.env.example`, certifique-se de adicioná-las lá sem expor chaves reais.

---

## 🧭 Política de desenvolvimento por risco

Este é um projeto **interno** (ferramenta pessoal, sem finalidade comercial). Adotamos **desenvolvimento
orientado a risco**: autonomia técnica para o rotineiro e controles explícitos **apenas onde o risco real
justifica**. Revisão independente, múltiplas aprovações e relatórios extensos **não** são requisitos
universais.

| Nível | Exemplos | Processo |
|---|---|---|
| **Baixo** | documentação, testes, refatoração interna sem mudança de comportamento, correções pequenas | implementar no fluxo normal; rodar os testes relevantes; revisar o próprio diff; registrar um **resumo conciso** |
| **Moderado** | novas funcionalidades internas, mudanças de fluxo, novos módulos, integrações com **mocks** | implementar e testar; checar regressões e permissões afetadas; registrar limitações; pedir revisão **só** se houver dúvida técnica concreta |
| **Alto** | autenticação, autorização, isolamento entre usuários, migrações relevantes, titularidade | **testes específicos** para os riscos; verificar falhas de autorização e regressões; preparar recuperação/rollback; revisão adicional quando o impacto justificar |
| **Irreversível / dados reais** | expurgo, transferência real de titularidade, alteração destrutiva de dados | **confirmação explícita antes da execução real** + validação de autorização + backup/recuperação quando aplicável + testes seguros prévios |

**Autonomia:**
- executar implementação e testes de **baixo e moderado** risco sem pedir autorização a cada subetapa;
- corrigir falhas dentro do escopo; se surgir um **risco novo e relevante**, interromper **só a ação afetada** e explicar;
- não pedir aprovações repetidas para decisões **já documentadas**;
- não produzir relatórios extensos quando um **resumo com evidências** basta;
- não reabrir PRs já mesclados para satisfazer formalidades retroativas.

**Rastreabilidade mínima por alteração:** resumo da mudança · arquivos/componentes afetados · testes
executados e resultados · riscos/limitações relevantes.

**Sempre preservado:** segurança (auth/authz/isolamento), testes, recuperação/rollback e a integridade da
`main`. Não desativar proteções do repositório nem ignorar falhas de CI sem justificativa documentada.
Branches e PRs continuam disponíveis quando úteis (isolamento, CI, recuperação) — **não** como cerimônia
obrigatória para toda alteração pequena.

---

Obrigado por ajudar a construir um assistente de IA mais privado e acessível! 🤖

