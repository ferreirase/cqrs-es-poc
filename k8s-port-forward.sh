#!/bin/bash

# Este script configura port-forwarding para os principais serviços em background

echo "===== Configurando acesso local aos serviços Kubernetes ====="

# Verificar se há processos anteriores de port-forwarding e matá-los
echo "-> Encerrando processos anteriores de port-forwarding..."
pkill -f "kubectl port-forward" || true
sleep 2

# Aplicação principal
echo "-> Configurando acesso à aplicação Transaction Service (http://localhost:3001)..."
kubectl port-forward -n app svc/transaction-service 3001:3001 &
APP_PID=$!

# Grafana
echo "-> Configurando acesso ao Grafana (http://localhost:3000)..."
kubectl port-forward -n monitoring svc/grafana 3000:3000 &
GRAFANA_PID=$!

# Prometheus
echo "-> Configurando acesso ao Prometheus (http://localhost:9090)..."
kubectl port-forward -n monitoring svc/prometheus 9090:9090 &
PROMETHEUS_PID=$!

# RabbitMQ Management
echo "-> Configurando acesso ao RabbitMQ Management (http://localhost:15672)..."
kubectl port-forward -n database svc/rabbitmq 15672:15672 &
RABBITMQ_PID=$!

# Aguardar um pouco para os port-forwards estabelecerem
sleep 3

# Verificar se os processos ainda estão rodando
function check_process {
  if ps -p $1 > /dev/null; then
    echo "✅ Port-forward para $2 está em execução (PID: $1)"
  else
    echo "❌ Falha ao iniciar port-forward para $2"
  fi
}

check_process $APP_PID "Transaction Service"
check_process $GRAFANA_PID "Grafana"
check_process $PROMETHEUS_PID "Prometheus"
check_process $RABBITMQ_PID "RabbitMQ Management"

echo ""
echo "Serviços disponíveis:"
echo "- Aplicação: http://localhost:3001/api"
echo "- Grafana: http://localhost:3000 (usuário: admin, senha: admin)"
echo "- Prometheus: http://localhost:9090"
echo "- RabbitMQ: http://localhost:15672 (usuário: admin, senha: admin)"
echo ""
echo "Para encerrar todos os port-forwards: pkill -f 'kubectl port-forward'"
echo ""
echo "Pressione CTRL+C para encerrar este script e todos os port-forwards"

# Manter o script rodando para que o usuário possa ver os logs
trap "pkill -f 'kubectl port-forward'; echo -e '\nTodos os port-forwards encerrados.'; exit 0" INT
wait 