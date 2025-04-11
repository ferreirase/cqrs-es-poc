#!/bin/bash

echo "===== Configurando Ingress para acesso aos serviços ====="

# Verificar se o namespace ingress-nginx existe
if ! kubectl get namespace ingress-nginx &> /dev/null; then
  echo "-> Instalando o controlador NGINX Ingress..."
  kubectl apply -f https://raw.githubusercontent.com/kubernetes/ingress-nginx/controller-v1.8.2/deploy/static/provider/cloud/deploy.yaml
  
  echo "-> Aguardando o controlador Ingress estar pronto..."
  kubectl wait --namespace ingress-nginx \
    --for=condition=ready pod \
    --selector=app.kubernetes.io/component=controller \
    --timeout=120s
else
  echo "-> Controlador NGINX Ingress já está instalado."
fi

# Aplicar a configuração de Ingress
echo "-> Aplicando configuração de Ingress..."
kubectl apply -f config/k8s/ingress.yaml

# Pegar o endereço do Ingress
echo "-> Obtendo o endereço do Ingress..."
sleep 5
INGRESS_IP=$(kubectl get ingress app-ingress -o jsonpath='{.status.loadBalancer.ingress[0].ip}')
if [ -z "$INGRESS_IP" ]; then
  INGRESS_IP="app.local (adicione esta entrada no seu arquivo /etc/hosts apontando para 127.0.0.1)"
fi

echo ""
echo "✅ Ingress configurado com sucesso!"
echo ""
echo "Para acessar os serviços, use os seguintes URLs:"
echo "- Aplicação: http://$INGRESS_IP/api"
echo "- Grafana: http://$INGRESS_IP/grafana (usuário: admin, senha: admin)"
echo "- Prometheus: http://$INGRESS_IP/prometheus"
echo "- RabbitMQ: http://$INGRESS_IP/rabbitmq (usuário: admin, senha: admin)"
echo ""
echo "Para configurar o acesso local, adicione a seguinte linha ao seu arquivo /etc/hosts:"
echo "127.0.0.1 app.local" 