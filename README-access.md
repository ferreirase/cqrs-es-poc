# Acessando os Serviços do Cluster Kubernetes

Este guia explica como acessar os serviços implantados no cluster Kubernetes a partir do localhost.

## Opção 1: Port Forwarding (Solução Simples)

O port forwarding é a maneira mais rápida e simples de acessar os serviços, sem necessidade de configuração adicional.

```bash
# Execute o script de port-forwarding
./k8s-port-forward.sh
```

Este script configura o acesso aos seguintes serviços:

- **Aplicação**: http://localhost:3001/api
- **Grafana**: http://localhost:3000 (usuário: admin, senha: admin)
- **Prometheus**: http://localhost:9090
- **RabbitMQ**: http://localhost:15672 (usuário: admin, senha: admin)

Para encerrar todos os port-forwards: `pkill -f 'kubectl port-forward'`

## Opção 2: Ingress (Solução Permanente)

O Ingress oferece uma solução mais permanente e flexível para acesso aos serviços.

### Instalação do Ingress Controller

```bash
# Execute o script de configuração do Ingress
./k8s-setup-ingress.sh
```

### Configuração do Host Local

Adicione a seguinte linha ao seu arquivo `/etc/hosts`:

```
127.0.0.1 app.local
```

Você pode fazer isso com o seguinte comando:

```bash
echo "127.0.0.1 app.local" | sudo tee -a /etc/hosts
```

### URLs de Acesso

Após a configuração, você pode acessar os serviços através dos seguintes URLs:

- **Aplicação**: http://app.local/api
- **Grafana**: http://app.local/grafana
- **Prometheus**: http://app.local/prometheus
- **RabbitMQ**: http://app.local/rabbitmq

## Opção 3: Minikube Tunnel (Apenas para Minikube)

Se você estiver usando Minikube, o tunnel fornece acesso a serviços do tipo LoadBalancer.

```bash
# Execute o script de configuração do tunnel do Minikube
./k8s-setup-minikube-tunnel.sh
```

Mantenha este terminal aberto enquanto precisar acessar os serviços externamente.

## Verificando os Serviços

Para verificar se os serviços estão funcionando corretamente:

```bash
# Verificar pods da aplicação
kubectl get pods -n app

# Verificar pods de monitoramento
kubectl get pods -n monitoring

# Verificar serviços da aplicação
kubectl get svc -n app

# Verificar serviços de monitoramento
kubectl get svc -n monitoring
```

## Solução de Problemas

Se encontrar problemas ao acessar os serviços:

1. **Verifique se os pods estão em execução**:

   ```bash
   kubectl get pods --all-namespaces
   ```

2. **Verifique os logs dos pods**:

   ```bash
   kubectl logs -n <namespace> <pod-name>
   ```

3. **Reinicie os pods, se necessário**:

   ```bash
   kubectl rollout restart deployment -n <namespace> <deployment-name>
   ```

4. **Se estiver usando Ingress, verifique se o controlador está funcionando**:

   ```bash
   kubectl get pods -n ingress-nginx
   ```

5. **Para verificar a configuração do Ingress**:
   ```bash
   kubectl describe ingress app-ingress
   ```
