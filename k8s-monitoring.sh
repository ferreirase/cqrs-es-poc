#!/bin/bash

kubectl create namespace monitoring && find config/k8s/monitoring -type f -name "*.yaml" | xargs -I {} kubectl apply -f {} -n monitoring && echo "Deployment completed."