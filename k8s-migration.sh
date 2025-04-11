#!/bin/bash

echo "===== Executando migrações do banco de dados ====="

# Verificar se a aplicação está pronta
echo "Aguardando a aplicação estar pronta..."
kubectl wait --for=condition=available --timeout=120s deployment/transaction-service -n app || {
  echo "❌ Timeout: A aplicação não está pronta dentro do tempo limite."
  echo "Verifique o status com: kubectl get pods -n app"
  exit 1
}

echo "-> Aplicando job de migração..."
kubectl apply -f config/k8s/app/transaction-migration-job.yaml -n app

echo "✅ Job de migração enviado com sucesso!"
echo "ℹ️  Para verificar o status: kubectl get jobs -n app"
echo "ℹ️  Para ver os logs: kubectl logs -n app job/transaction-migration-job" 