# 💸 Sistema de Gerenciamento de Transações com CQRS + Event Sourcing

## 🎯 Propósito do Projeto

Este projeto é uma prova de conceito (POC) para um sistema de gerenciamento de transações financeiras implementado utilizando os padrões arquiteturais CQRS (Command Query Responsibility Segregation) e Event Sourcing. O sistema permite:

- 💰 Criar e gerenciar contas
- 💱 Processar transações financeiras
- 📊 Consultar saldos e histórico de transações
- 📈 Monitorar o sistema através de métricas e logs

A arquitetura escolhida proporciona alta escalabilidade, resiliência e rastreabilidade das operações, sendo ideal para sistemas financeiros onde o histórico completo de transações é essencial.

## 🛠️ Tecnologias, Arquiteturas e Bibliotecas Utilizadas

### 🧰 Framework e Linguagem

- **NestJS**: Framework Node.js para construção de aplicações server-side escaláveis
- **TypeScript**: Linguagem de programação tipada que compila para JavaScript

### 🏗️ Arquiteturas e Padrões

- **CQRS**: Command Query Responsibility Segregation - separação entre operações de leitura e escrita
- **Event Sourcing**: Armazenamento do estado da aplicação como sequência de eventos
- **Domain-Driven Design (DDD)**: Organização do código baseada em domínios de negócio

### 🗄️ Bancos de Dados

- **PostgreSQL**: Banco de dados relacional utilizado como Event Store
- **MongoDB**: Banco de dados NoSQL utilizado para armazenamento de modelos de leitura (Read Models)

### 📨 Mensageria

- **RabbitMQ**: Message broker para comunicação assíncrona entre serviços

### 👁️ Observabilidade

- **Prometheus**: Coleta e armazenamento de métricas
- **Grafana**: Visualização de métricas e logs
- **Loki**: Agregação e indexação de logs
- **Fluent Bit**: Coleta e encaminhamento de logs

### 📚 Bibliotecas Principais

- **@nestjs/cqrs**: Implementação de CQRS para NestJS
- **@nestjs/mongoose**: Integração com MongoDB
- **@nestjs/typeorm**: Integração com PostgreSQL via TypeORM
- **@golevelup/nestjs-rabbitmq**: Integração com RabbitMQ
- **@nestjs/schedule**: Agendamento de tarefas
- **prom-client**: Cliente Prometheus para coleta de métricas
- **winston/pino**: Logging

## 🚀 Como Rodar o Projeto

### ⚙️ Pré-requisitos

- Node.js (versão 14 ou superior)
- Docker e Docker Compose

### 🔧 Configuração

1. Clone o repositório:

   ```bash
   git clone <url-do-repositorio>
   cd cqrs-es-poc
   ```

2. Instale as dependências:

   ```bash
   npm install
   ```

3. Configure as variáveis de ambiente:

   - Para desenvolvimento, crie um arquivo `.env.local`
   - Para produção, crie um arquivo `.env`

   Exemplo de configuração:

   ```
   # Configuração PostgreSQL
   POSTGRES_HOST=localhost
   POSTGRES_PORT=5432
   POSTGRES_USER=postgres
   POSTGRES_PASSWORD=postgres
   POSTGRES_DB=transaction_db

   # Configuração MongoDB
   MONGO_URI=mongodb://localhost:27017/transaction_db

   # Configuração RabbitMQ
   RABBITMQ_URL=amqp://guest:guest@localhost:5672

   # Ambiente
   NODE_ENV=development
   ```

### 🐳 Executando com Docker

1. Inicie todos os serviços com Docker Compose:

   ```bash
   npm run docker:up
   ```

   Isso iniciará todos os serviços necessários:

   - PostgreSQL (porta 5432)
   - MongoDB (porta 27017)
   - RabbitMQ (portas 5672 e 15672 para o painel de administração)
   - Prometheus (porta 9090)
   - Grafana (porta 3300)
   - Loki (porta 3100)
   - Fluent Bit (porta 24224)

2. Para parar todos os serviços:
   ```bash
   npm run docker:down
   ```

### ▶️ Executando a Aplicação

- **Desenvolvimento**:

  ```bash
  npm run start:dev
  ```

- **Debug**:

  ```bash
  npm run start:debug
  ```

- **Produção**:
  ```bash
  npm run build
  npm run start:prod
  ```

### 🔗 Acessando os Serviços

- **API**: http://localhost:3001/api
- **Métricas Prometheus**: http://localhost:3001/api/metrics
- **Painel RabbitMQ**: http://localhost:15672 (usuário: guest, senha: guest)
- **Grafana**: http://localhost:3300 (usuário: admin, senha: admin)
- **Prometheus**: http://localhost:9090

## 🏛️ Arquitetura do Sistema

![alt text](mermaid.png)

## 📁 Estrutura do Projeto

- **/src**: Código fonte da aplicação

  - **/accounts**: Módulo de gerenciamento de contas
  - **/transactions**: Módulo de gerenciamento de transações
  - **/common**: Componentes compartilhados
    - **/events**: Implementação do Event Sourcing
    - **/messaging**: Integração com RabbitMQ
    - **/monitoring**: Monitoramento com Prometheus e logging
    - **/sync**: Sincronização entre serviços

- **/config**: Arquivos de configuração
  - **/fluentbit**: Configuração do Fluent Bit
  - **/grafana**: Dashboards e configuração do Grafana
  - **/loki**: Configuração do Loki
  - **/prometheus**: Configuração do Prometheus

## 🔄 Fluxo de Processamento de Transações

1. 📥 Uma solicitação de transação é recebida via API REST
2. ⚡ Um comando `CreateTransaction` é enviado ao Command Handler correspondente
3. ✅ O Command Handler valida o comando e gera um evento `TransactionCreated`
4. 💾 O evento é armazenado no Event Store (PostgreSQL)
5. 🔄 O Event Handler processa o evento e:
   - 📝 Atualiza o modelo de leitura no MongoDB
   - 📢 Publica o evento no RabbitMQ para processamento assíncrono
6. ⏰ O Transaction Scheduler agenda o processamento da transação
7. ⚙️ Quando chega o momento, um comando `ProcessTransaction` é executado
8. 💼 A transação é processada, atualizando os saldos das contas envolvidas
9. 📝 Novos eventos são gerados e armazenados (`TransactionProcessed`, `AccountBalanceUpdated`)
10. 🔍 As consultas são realizadas diretamente no modelo de leitura (MongoDB)

## 👥 Contribuição

1. 🍴 Faça um fork do projeto
2. 🌿 Crie uma branch para sua feature (`git checkout -b feature/nova-funcionalidade`)
3. 💾 Commit suas mudanças (`git commit -m 'Adiciona nova funcionalidade'`)
4. 📤 Push para a branch (`git push origin feature/nova-funcionalidade`)
5. 🔍 Abra um Pull Request

## ℹ️ Informações Adicionais

Este projeto segue os princípios de:

- **🔷 Arquitetura Hexagonal**: Separação clara entre domínio e infraestrutura
- **🧩 Domain-Driven Design**: Foco no domínio de negócios
- **📊 Observabilidade**: Monitoramento completo através de métricas e logs

Para mais informações sobre CQRS e Event Sourcing, consulte:

- [Microsoft - CQRS Pattern](https://docs.microsoft.com/en-us/azure/architecture/patterns/cqrs) 📚
- [Martin Fowler - Event Sourcing](https://martinfowler.com/eaaDev/EventSourcing.html) 📖
