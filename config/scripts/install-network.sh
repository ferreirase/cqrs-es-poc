#!/bin/bash

echo "===== Configurando acesso a todos os serviços ====="

# Matar quaisquer processos de port-forward existentes
echo "-> Encerrando port-forwards anteriores..."
pkill -f "kubectl port-forward" || true
sleep 2

# Array para armazenar os PIDs
declare -a PIDS=()
declare -a SERVICE_NAMES=()

# Função para configurar port-forward para um serviço
setup_forward() {
  local ns=$1
  local svc=$2
  local local_port=$3
  local remote_port=$4
  local desc=$5
  
  # Verificar se o serviço existe
  if kubectl get svc -n $ns $svc &>/dev/null; then
    echo "-> Configurando acesso a $desc (http://localhost:$local_port)..."
    kubectl port-forward -n $ns svc/$svc $local_port:$remote_port &
    local pid=$!
    PIDS+=($pid)
    SERVICE_NAMES+=("$desc")
    return 0
  else
    echo "⚠️  Serviço $svc não encontrado no namespace $ns."
    return 1
  fi
}

# Configurar port-forward para todos os serviços
echo "-> Configurando port-forward para todos os serviços..."

# Aplicação principal
setup_forward "app" "transaction-service" 3001 3001 "Transaction Service API"

# Serviços de Monitoramento
setup_forward "monitoring" "grafana" 3000 3000 "Grafana"
setup_forward "monitoring" "prometheus" 9090 9090 "Prometheus"
setup_forward "monitoring" "loki" 3100 3100 "Loki"
setup_forward "monitoring" "fluentbit" 2020 2020 "FluentBit Metrics"

# Serviços de Banco de Dados
setup_forward "database" "rabbitmq" 15672 15672 "RabbitMQ Management"
setup_forward "database" "rabbitmq" 5672 5672 "RabbitMQ AMQP"
setup_forward "database" "postgres" 5432 5432 "PostgreSQL"
setup_forward "database" "mongodb" 27017 27017 "MongoDB"

# Verificar se algum port-forward foi configurado com sucesso
sleep 3
success_count=0
echo ""
echo "Serviços disponíveis:"

for i in "${!PIDS[@]}"; do
  pid=${PIDS[$i]}
  name=${SERVICE_NAMES[$i]}
  
  if ps -p $pid > /dev/null; then
    echo "✅ $name"
    ((success_count++))
  else
    echo "❌ $name (falha ao configurar port-forward)"
  fi
done

if [ $success_count -eq 0 ]; then
  echo "❌ Nenhum port-forward configurado com sucesso."
  exit 1
fi

echo ""
echo "Acesse a aplicação principal em: http://localhost:3001/api"
echo ""
echo "Credenciais para serviços:"
echo "- Grafana: admin / admin"
echo "- RabbitMQ: admin / admin"
echo "- PostgreSQL: postgres / postgres"
echo "- MongoDB: admin / mongodb"
echo ""
echo "Pressione CTRL+C para encerrar todos os port-forwards"

# Manter o script rodando para os port-forwards continuarem ativos
trap "pkill -f 'kubectl port-forward'; echo -e '\nTodos os port-forwards encerrados.'; exit 0" INT
wait 