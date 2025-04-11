#!/bin/bash

echo "===== Instalando stack de monitoramento ====="

# Verificar se o namespace de monitoramento existe
if ! kubectl get namespace monitoring &>/dev/null; then
  echo "-> Criando namespace de monitoramento..."
  kubectl create namespace monitoring
fi

# Prometheus
echo "-> Implantando Prometheus..."
kubectl apply -f config/k8s/monitoring/prometheus/configs/configmap.yaml || echo "⚠️  Falha ao aplicar configmap do Prometheus"
kubectl apply -f config/k8s/monitoring/prometheus/pvc/pvc.yaml || echo "⚠️  Falha ao aplicar PVC do Prometheus"
kubectl apply -f config/k8s/monitoring/prometheus/deployment/deployment.yaml || echo "⚠️  Falha ao aplicar deployment do Prometheus"
kubectl apply -f config/k8s/monitoring/prometheus/service/service.yaml || echo "⚠️  Falha ao aplicar service do Prometheus"

# Loki
echo "-> Implantando Loki..."
kubectl apply -f config/k8s/monitoring/loki/configs/configmap.yaml || echo "⚠️  Falha ao aplicar configmap do Loki"
kubectl apply -f config/k8s/monitoring/loki/pvc/pvc.yaml || echo "⚠️  Falha ao aplicar PVC do Loki"
kubectl apply -f config/k8s/monitoring/loki/deployment/deployment.yaml || echo "⚠️  Falha ao aplicar deployment do Loki"
kubectl apply -f config/k8s/monitoring/loki/service/service.yaml || echo "⚠️  Falha ao aplicar service do Loki"

# Grafana
echo "-> Implantando Grafana..."
kubectl apply -f config/k8s/monitoring/grafana/configs/datasources.yaml || echo "⚠️  Falha ao aplicar datasources do Grafana"
kubectl apply -f config/k8s/monitoring/grafana/configs/dashboard-providers.yaml || echo "⚠️  Falha ao aplicar dashboard-providers do Grafana"
kubectl apply -f config/k8s/monitoring/grafana/configs/dashboards.yaml || echo "⚠️  Falha ao aplicar dashboards do Grafana"
kubectl apply -f config/k8s/monitoring/grafana/pvc/pvc.yaml || echo "⚠️  Falha ao aplicar PVC do Grafana"
kubectl apply -f config/k8s/monitoring/grafana/deployment/deployment.yaml || echo "⚠️  Falha ao aplicar deployment do Grafana"
kubectl apply -f config/k8s/monitoring/grafana/service/service.yaml || echo "⚠️  Falha ao aplicar service do Grafana"

# FluentBit
echo "-> Implantando FluentBit..."
kubectl apply -f config/k8s/monitoring/fluentbit/configs/configmap.yaml || echo "⚠️  Falha ao aplicar configmap do FluentBit"
kubectl apply -f config/k8s/monitoring/fluentbit/rbac/rbac.yaml || echo "⚠️  Falha ao aplicar RBAC do FluentBit"
kubectl apply -f config/k8s/monitoring/fluentbit/deployment/deployment.yaml || echo "⚠️  Falha ao aplicar deployment do FluentBit"
kubectl apply -f config/k8s/monitoring/fluentbit/service/service.yaml || echo "⚠️  Falha ao aplicar service do FluentBit"

# Aguardar os pods estarem prontos
echo "-> Aguardando pods de monitoramento estarem prontos..."
kubectl wait --for=condition=ready pod -l app=prometheus -n monitoring --timeout=180s || echo "⚠️  Timeout aguardando Prometheus"
kubectl wait --for=condition=ready pod -l app=loki -n monitoring --timeout=180s || echo "⚠️  Timeout aguardando Loki"
kubectl wait --for=condition=ready pod -l app=grafana -n monitoring --timeout=180s || echo "⚠️  Timeout aguardando Grafana"
kubectl wait --for=condition=ready pod -l app=fluentbit -n monitoring --timeout=180s || echo "⚠️  Timeout aguardando FluentBit"

echo ""
echo "-> Status dos pods de monitoramento:"
kubectl get pods -n monitoring

echo ""
echo "Stack de monitoramento instalado. Para acessar, use o seguinte comando:"
echo "./fix-access.sh" 