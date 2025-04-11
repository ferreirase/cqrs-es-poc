#!/bin/bash

echo "===== Implantando toda a infraestrutura Kubernetes ====="
echo "Este script irá implantar todos os componentes na seguinte ordem:"
echo "1. Namespaces e políticas de rede"
echo "2. Stack de banco de dados (PostgreSQL, MongoDB, RabbitMQ)"
echo "3. Stack de monitoramento (Prometheus, Loki, FluentBit, Grafana)"
echo "4. Aplicação NestJS"
echo "5. Migrações do banco de dados"
echo ""
echo "Pressione ENTER para continuar ou CTRL+C para cancelar..."
read -r

# Definir função para verificar sucesso
check_success() {
  if [ $? -ne 0 ]; then
    echo "❌ Erro durante a implantação. Abortando."
    exit 1
  fi
}

# 1. Namespaces e políticas de rede
echo ""
echo "1️⃣  Implantando namespaces e políticas de rede..."
./k8s-setup-namespaces.sh
check_success

# 2. Stack de banco de dados
echo ""
echo "2️⃣  Implantando serviços de banco de dados..."
./k8s-setup-database.sh
check_success

# Aguardar bancos de dados estarem prontos
echo "Aguardando banco de dados estarem prontos..."
kubectl wait --for=condition=ready pod -l app=postgres -n database --timeout=120s
kubectl wait --for=condition=ready pod -l app=mongodb -n database --timeout=120s
kubectl wait --for=condition=ready pod -l app=rabbitmq -n database --timeout=120s

# 3. Stack de monitoramento
echo ""
echo "3️⃣  Implantando stack de monitoramento..."
./k8s-setup-monitoring.sh
check_success

# 4. Aplicação NestJS
echo ""
echo "4️⃣  Implantando aplicação NestJS..."
./k8s-setup-app.sh
check_success

# 5. Migrações do banco de dados
echo ""
echo "5️⃣  Executando migrações do banco de dados..."
./k8s-migration.sh

echo ""
echo "✅ Implantação completa da infraestrutura!"
echo ""
echo "Para acessar os serviços:"
echo "- Aplicação: kubectl port-forward -n app svc/transaction-service 3001:3001"
echo "- Grafana: kubectl port-forward -n monitoring svc/grafana 3000:3000"
echo "- Prometheus: kubectl port-forward -n monitoring svc/prometheus 9090:9090" 