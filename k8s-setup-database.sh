#!/bin/bash

echo "===== Implantando serviços de banco de dados ====="

# Verificar se o namespace database existe, senão criar
kubectl get namespace database > /dev/null 2>&1 || kubectl apply -f config/k8s/namespaces.yaml

echo "-> Implantando PostgreSQL..."
kubectl apply -f config/k8s/database/postgres.yaml

echo "-> Implantando MongoDB..."
kubectl apply -f config/k8s/database/mongodb.yaml

echo "-> Implantando RabbitMQ..."
kubectl apply -f config/k8s/database/rabbitmq.yaml

echo "✅ Serviços de banco de dados implantados com sucesso!"
echo "ℹ️  Para verificar o status: kubectl get pods -n database" 