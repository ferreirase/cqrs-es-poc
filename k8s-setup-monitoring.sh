#!/bin/bash

echo "===== Implantando stack de monitoramento ====="

# Verificar se o namespace monitoring existe, senão criar
kubectl get namespace monitoring > /dev/null 2>&1 || kubectl apply -f config/k8s/namespaces.yaml

echo "-> Implantando Prometheus..."
kubectl apply -f config/k8s/monitoring/prometheus/configs/configmap.yaml
kubectl apply -f config/k8s/monitoring/prometheus/pvc/pvc.yaml
kubectl apply -f config/k8s/monitoring/prometheus/deployment/deployment.yaml
kubectl apply -f config/k8s/monitoring/prometheus/service/service.yaml

echo "-> Implantando Loki..."
kubectl apply -f config/k8s/monitoring/loki/configs/configmap.yaml
kubectl apply -f config/k8s/monitoring/loki/pvc/pvc.yaml
kubectl apply -f config/k8s/monitoring/loki/deployment/deployment.yaml
kubectl apply -f config/k8s/monitoring/loki/service/service.yaml

echo "-> Implantando FluentBit..."
kubectl apply -f config/k8s/monitoring/fluentbit/configs/configmap.yaml
kubectl apply -f config/k8s/monitoring/fluentbit/rbac/rbac.yaml
kubectl apply -f config/k8s/monitoring/fluentbit/deployment/deployment.yaml
kubectl apply -f config/k8s/monitoring/fluentbit/service/service.yaml

echo "-> Implantando Grafana..."
kubectl apply -f config/k8s/monitoring/grafana/configs/datasources.yaml
kubectl apply -f config/k8s/monitoring/grafana/configs/dashboard-providers.yaml
kubectl apply -f config/k8s/monitoring/grafana/configs/dashboards.yaml
kubectl apply -f config/k8s/monitoring/grafana/pvc/pvc.yaml
kubectl apply -f config/k8s/monitoring/grafana/deployment/deployment.yaml
kubectl apply -f config/k8s/monitoring/grafana/service/service.yaml

echo "✅ Stack de monitoramento implantada com sucesso!"
echo "ℹ️  Para verificar o status: kubectl get pods -n monitoring"
echo "ℹ️  Acessar Grafana: kubectl port-forward -n monitoring svc/grafana 3000:3000"
echo "ℹ️  Acessar Prometheus: kubectl port-forward -n monitoring svc/prometheus 9090:9090" 