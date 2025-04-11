#!/bin/bash

echo "===== Configurando acesso à aplicação ====="

# Matar quaisquer processos de port-forward existentes
pkill -f "kubectl port-forward" || true
sleep 2

# Verificar se o pod da aplicação está rodando
if ! kubectl get pod -n app -l app=transaction-service &>/dev/null; then
  echo "❌ Nenhum pod da aplicação encontrado. Verifique se a aplicação está implantada."
  exit 1
fi

# Configurar port-forward para a aplicação
echo "-> Configurando acesso à aplicação (http://localhost:3001)..."
kubectl port-forward -n app svc/transaction-service 3001:3001 &
APP_PID=$!

# Verificar se o port-forward foi configurado com sucesso
sleep 3
if ps -p $APP_PID > /dev/null; then
  echo "✅ Port-forward configurado com sucesso!"
else
  echo "❌ Falha ao configurar port-forward."
  exit 1
fi

echo ""
echo "A aplicação está acessível em: http://localhost:3001/api"
echo ""
echo "Pressione CTRL+C para encerrar o port-forward"

# Manter o script rodando para o port-forward continuar ativo
trap "pkill -f 'kubectl port-forward'; echo -e '\nPort-forward encerrado.'; exit 0" INT
wait $APP_PID 