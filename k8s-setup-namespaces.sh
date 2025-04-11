#!/bin/bash

echo "===== Criando namespaces e configurações de rede ====="
kubectl apply -f config/k8s/namespaces.yaml
kubectl apply -f config/k8s/network-policies.yaml

echo "✅ Namespaces e políticas de rede configurados com sucesso!" 