#!/bin/bash

echo "===== Criando nova imagem da aplicação com correções ====="

# Construir a nova imagem
echo "-> Construindo imagem..."
docker build -t transaction-service:latest .

# Atualizar o Deployment
echo "-> Aplicando configurações atualizadas do FluentBit..."
kubectl apply -f config/k8s/monitoring/fluentbit/configs/configmap.yaml

# Reiniciar os pods
echo "-> Reiniciando FluentBit..."
kubectl rollout restart deployment -n monitoring fluentbit

echo "-> Aplicando novas variáveis de ambiente para a aplicação..."
kubectl apply -f config/k8s/app/configmap.yaml

echo "-> Reiniciando a aplicação..."
kubectl rollout restart deployment -n app transaction-service

echo "✅ Imagem atualizada e aplicada com sucesso!"
echo "Aguarde alguns instantes enquanto os pods são reiniciados..." 