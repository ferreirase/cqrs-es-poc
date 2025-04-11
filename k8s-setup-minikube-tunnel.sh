#!/bin/bash

echo "===== Configurando Minikube Tunnel para acesso externo aos serviços ====="

# Verificar se o minikube está sendo usado
if ! command -v minikube &> /dev/null; then
  echo "❌ Minikube não está instalado. Este script é apenas para clusters Minikube."
  exit 1
fi

# Verificar o status do minikube
if ! minikube status | grep -q "Running"; then
  echo "❌ Minikube não está em execução. Inicie-o com 'minikube start' primeiro."
  exit 1
fi

echo "-> Iniciando minikube tunnel (isso pode solicitar a senha de sudo)..."
echo "-> Mantenha este terminal aberto. Pressione CTRL+C para encerrar o tunnel."
echo "-> Abra outro terminal para continuar trabalhando."
echo ""

# Iniciar o tunnel
minikube tunnel 