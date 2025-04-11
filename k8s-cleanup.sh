#!/bin/bash

echo "===== Limpando todos os recursos Kubernetes ====="
echo "⚠️  ATENÇÃO: Este script irá remover TODOS os recursos criados, incluindo dados persistentes!"
echo "Digite 'confirmar' para continuar ou CTRL+C para cancelar..."
read -r confirmation

if [ "$confirmation" != "confirmar" ]; then
  echo "Operação cancelada."
  exit 0
fi

echo "-> Removendo namespace app..."
kubectl delete namespace app

echo "-> Removendo namespace monitoring..."
kubectl delete namespace monitoring

echo "-> Removendo namespace database..."
kubectl delete namespace database

echo "-> Removendo políticas de rede..."
kubectl delete -f config/k8s/network-policies.yaml --ignore-not-found=true

echo "✅ Todos os recursos foram removidos com sucesso!" 