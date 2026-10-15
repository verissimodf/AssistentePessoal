#!/usr/bin/env bash

# Configura flags de segurança: encerra o script se houver erros, variáveis indefinidas ou falhas em pipes
set -euo pipefail

# Garante que o instalador execute a partir da raiz do repositório
cd "$(dirname "$0")/.."

echo "=============================================================================="
echo "🦾 J.A.R.V.I.S. - SISTEMA DE INSTALAÇÃO AUTOMÁTICA (LINUX / MACOS)"
echo "=============================================================================="

# 1. Validação de Existência do Node.js
if ! command -v node >/dev/null 2>&1; then
  echo "[ERRO] Node.js não foi detectado no sistema."
  echo "[ERRO] Por favor, instale o Node.js 22+ utilizando o gerenciador de sua distro ou o NVM."
  echo "       Exemplo: nvm install 22"
  exit 1
fi

# 2. Validação Rígida da Versão do Node.js (Requer v22.13.0+)
MAJOR=$(node -p 'process.versions.node.split(".")[0]')
if [ "$MAJOR" -lt 22 ]; then
  echo "[ERRO] O Jarvis requer o Node.js na versão 22 ou superior."
  echo "[ERRO] Sua versão atual detectada é a $(node -v). Por favor, atualize seu ambiente."
  exit 1
fi

# 3. Instalação das Dependências do Frontend (Painel Web)
echo ""
echo "[1/4] Instalando dependências do Painel Web (Frontend)..."
npm install --no-audit --no-fund

# 4. Instalação das Dependências do Servidor Local (Backend)
echo ""
echo "[2/4] Instalando dependências do Serviço Local (Backend)..."
if [ -d server ]; then
  (cd server && npm install --no-audit --no-fund)
else
  echo "[ERRO] Diretório /server não encontrado! Verifique a integridade do repositório."
  exit 1
fi

# 5. Estruturação de Pastas e Geração Automática do .env
echo ""
echo "[3/4] Estruturando diretórios locais de persistência..."
mkdir -p data

if [ ! -f .env ]; then
  echo "[4/4] Criando arquivo de configuração .env a partir do modelo..."
  if [ -f .env.example ]; then
    cp .env.example .env
    
    echo "[INSTALADOR] Gerando chave de criptografia de segurança AES-256 local..."
    # Usa o módulo nativo node:crypto para gerar uma string hexadecimal aleatória e segura
    SECRET_HEX=$(node -e "console.log(require('crypto').randomBytes(32).toString('hex'))")
    
    # Injeta a chave gerada de forma segura substituindo o placeholder do .env.example
    # Utiliza sintaxe compatível tanto com o sed do Linux (GNU) quanto do macOS (BSD)
    sed -i.bak "s/ENCRYPTION_KEY=.*/ENCRYPTION_KEY=${SECRET_HEX}/" .env && rm .env.bak
    
    echo "[INSTALADOR] Chave de segurança aplicada com sucesso ao seu .env!"
  else
    echo "[AVISO] .env.example não encontrado. Lembre-se de configurar seu .env manualmente."
  fi
else
  echo "[4/4] Arquivo .env existente detectado. Etapa pulada para proteger seus dados atuais."
fi

# 6. Atribuição de Permissões de Execução nos Scripts
echo ""
echo "[INSTALADOR] Configurando permissões de execução dos scripts locais..."
chmod +x scripts/*.sh 2>/dev/null || true

echo "=============================================================================="
echo "🎉 INSTALAÇÃO CONCLUÍDA COM SUCESSO!"
echo "=============================================================================="
echo ""
echo "💻 Para iniciar o J.A.R.V.I.S. em segundo plano: ./scripts/jarvis.sh"
echo "🎙️ Para ativar clonagem de voz local (opcional): ./scripts/instalar-voz.sh"
echo ""
