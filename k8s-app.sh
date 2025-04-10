#!/bin/bash

kubectl create namespace app && find config/k8s/app -type f -name "*.yaml" | xargs -I {} kubectl apply -f {} -n app && echo "Deployment completed."