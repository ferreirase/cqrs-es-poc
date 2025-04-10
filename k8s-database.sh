#!/bin/bash

kubectl create namespace database && find config/k8s/database -type f -name "*.yaml" | xargs -I {} kubectl apply -f {} -n database && echo "Deployment completed."