#!/bin/bash

echo "===== Implantando aplicação NestJS ====="

# Verificar se o namespace app existe, senão criar
kubectl get namespace app > /dev/null 2>&1 || kubectl apply -f config/k8s/namespaces.yaml

echo "-> Aplicando ConfigMaps e Secrets..."
kubectl apply -f config/k8s/app/configmap.yaml
kubectl apply -f config/k8s/app/secrets.yaml

echo "-> Implantando aplicação..."
kubectl apply -f config/k8s/app/deployment.yaml

echo "✅ Aplicação implantada com sucesso!"
echo "ℹ️  Para verificar o status: kubectl get pods -n app"
echo "ℹ️  Para acessar a aplicação: kubectl port-forward -n app svc/transaction-service 3001:3001" 