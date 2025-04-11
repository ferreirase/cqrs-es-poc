#!/bin/bash

echo "===== Instalando aplicação Transaction Service ====="

# Verificar se o namespace app existe
if ! kubectl get namespace app &>/dev/null; then
  echo "-> Criando namespace app..."
  kubectl create namespace app
fi

# Verificar se o namespace de banco de dados existe
if ! kubectl get namespace database &>/dev/null; then
  echo "-> Aplicação requer banco de dados. Criando namespace database..."
  kubectl create namespace database
  
  echo "-> Implantando bancos de dados..."
  kubectl apply -f config/k8s/database
  
  echo "-> Aguardando bancos de dados estarem prontos..."
  kubectl wait --for=condition=ready pod -l app=postgres -n database --timeout=180s || echo "⚠️  Timeout aguardando Postgres"
  kubectl wait --for=condition=ready pod -l app=mongodb -n database --timeout=180s || echo "⚠️  Timeout aguardando MongoDB"
  kubectl wait --for=condition=ready pod -l app=rabbitmq -n database --timeout=180s || echo "⚠️  Timeout aguardando RabbitMQ"
fi

# Configurar aplicação com Loki desativado
echo "-> Configurando aplicação..."
cat <<EOF | kubectl apply -f -
apiVersion: v1
kind: ConfigMap
metadata:
  name: app-config
  namespace: app
data:
  NODE_ENV: 'production'
  # MongoDB Config
  MONGO_USER: 'admin'
  MONGO_HOST: 'mongodb.database.svc.cluster.local'
  MONGO_PORT: '27017'
  MONGO_DB: 'transaction_db'
  MONGO_AUTH_SOURCE: 'admin'
  # Postgres Config
  POSTGRES_HOST: 'postgres.database.svc.cluster.local'
  POSTGRES_PORT: '5432'
  POSTGRES_USER: 'postgres'
  POSTGRES_DB: 'transaction_db'
  # RabbitMQ Config
  RABBITMQ_HOST: 'rabbitmq.database.svc.cluster.local'
  RABBITMQ_PORT: '5672'
  RABBITMQ_USER: 'admin'
  # Loki Config - URL completa do Loki
  LOKI_URL: 'http://loki.monitoring.svc.cluster.local:3100'
  LOKI_HOST: ''
  LOKI_PORT: '3100'
  LOKI_USERNAME: 'admin'
  # Desativar Loki temporariamente
  DISABLE_LOKI: 'true'
EOF

# Aplicar secrets
echo "-> Configurando secrets..."
kubectl apply -f config/k8s/app/secrets.yaml || echo "⚠️  Falha ao aplicar secrets"

# Implantar a aplicação
echo "-> Implantando a aplicação..."
kubectl apply -f config/k8s/app/deployment.yaml || echo "⚠️  Falha ao aplicar deployment"

# Aguardar a aplicação estar pronta
echo "-> Aguardando aplicação estar pronta..."
kubectl rollout status deployment/transaction-service -n app --timeout=180s || echo "⚠️  Timeout aguardando aplicação"

echo ""
echo "-> Status dos pods da aplicação:"
kubectl get pods -n app

echo ""
echo "✅ Aplicação instalada com sucesso!"
echo "Para acessar a aplicação, execute:"
echo "./fix-access.sh" 