#!/bin/bash

echo "Aplicando migração da tabela de transações..."
kubectl apply -f config/k8s/app/transaction-migration-job.yaml -n app
echo "Job de migração enviado. Para verificar o status: kubectl get jobs -n app transaction-migration-job"
echo "Para ver os logs: kubectl logs -n app job/transaction-migration-job" 