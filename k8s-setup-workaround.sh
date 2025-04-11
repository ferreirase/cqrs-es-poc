#!/bin/bash

echo "===== Aplicando solução temporária para aplicação ====="

# Criar um ConfigMap para desabilitar Loki na aplicação
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: app
data:
  NODE_ENV: "production"
  # MongoDB Config
  MONGO_USER: "admin"
  MONGO_HOST: "mongodb.database.svc.cluster.local"
  MONGO_PORT: "27017"
  MONGO_DB: "transaction_db"
  MONGO_AUTH_SOURCE: "admin"
  # Postgres Config
  POSTGRES_HOST: "postgres.database.svc.cluster.local"
  POSTGRES_PORT: "5432"
  POSTGRES_USER: "postgres"
  POSTGRES_DB: "transaction_db"
  # RabbitMQ Config
  RABBITMQ_HOST: "rabbitmq.database.svc.cluster.local"
  RABBITMQ_PORT: "5672"
  RABBITMQ_USER: "admin"
  # Loki Config - URL completa do Loki
  LOKI_URL: "http://loki.monitoring.svc.cluster.local:3100"
  # Desativamos o host separado para evitar conflitos
  LOKI_HOST: ""
  LOKI_PORT: "3100"
  LOKI_USERNAME: "admin"
EOF

# Reiniciar a aplicação
echo "-> Reiniciando a aplicação..."
kubectl rollout restart deployment -n app transaction-service

echo "✅ Solução temporária aplicada com sucesso!"
echo "ℹ️  Aguarde alguns instantes enquanto os pods são reiniciados..." 