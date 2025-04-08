# 💸 Sistema de Gerenciamento de Transações com CQRS + Event Sourcing

## 🎯 Propósito do Projeto

Este projeto é uma prova de conceito (POC) para um sistema de gerenciamento de transações financeiras implementado utilizando os padrões arquiteturais CQRS (Command Query Responsibility Segregation) e Event Sourcing. O sistema permite:

- 💰 Criar e gerenciar contas
- 💱 Processar transações financeiras
- 📊 Consultar saldos e histórico de transações
- 📈 Monitorar o sistema através de métricas e logs
- 🔄 Orquestrar operações complexas usando o padrão Saga
- 🧩 Manter a consistência de dados usando contextos de transação

A arquitetura escolhida proporciona alta escalabilidade, resiliência e rastreabilidade das operações, sendo ideal para sistemas financeiros onde o histórico completo de transações é essencial.

## 🛠️ Tecnologias, Arquiteturas e Bibliotecas Utilizadas

### 🧰 Framework e Linguagem

- **NestJS**: Framework Node.js para construção de aplicações server-side escaláveis
- **TypeScript**: Linguagem de programação tipada que compila para JavaScript

### 🏗️ Arquiteturas e Padrões

- **CQRS**: Command Query Responsibility Segregation - separação entre operações de leitura e escrita
- **Event Sourcing**: Armazenamento do estado da aplicação como sequência de eventos
- **Domain-Driven Design (DDD)**: Organização do código baseada em domínios de negócio
- **Saga Pattern**: Orquestração de transações distribuídas com compensação
- **Context Service Pattern**: Gerenciamento de contexto para operações de longa duração

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

## 🧩 Padrão Saga: Orquestrando Transações Complexas

O sistema implementa o padrão Saga para gerenciar transações distribuídas complexas, como operações de saque (withdrawal) que envolvem múltiplos passos e possíveis compensações em caso de falha.

### 🌊 Fluxo da Saga de Withdrawal

1. 🔍 **Verificação de Saldo**: Verifica se a conta tem saldo suficiente para o saque
2. 💰 **Reserva de Saldo**: Reserva o valor na conta de origem
3. 📊 **Processamento da Transação**: Registra a transação como processada
4. ✅ **Confirmação da Transação**: Confirma a transação após o processamento
5. 📝 **Atualização do Extrato**: Atualiza os extratos das contas de origem e destino
6. 📨 **Notificações**: Notifica os usuários envolvidos na transação

### 🔙 Compensação em Caso de Falha

Se qualquer etapa falhar, a saga executa operações de compensação para desfazer as etapas anteriores:

1. ❌ **Falha no Processamento**: Libera o saldo reservado
2. ❌ **Falha na Confirmação**: Reverte o saldo e marca a transação como cancelada
3. ❌ **Falha na Atualização do Extrato**: Registra a falha, mas mantém a transação confirmada
4. ❌ **Falha na Notificação**: Registra a falha para tentativa posterior

### 📦 Contexto de Transação

Para manter a consistência e evitar hardcoding de informações, implementamos um `TransactionContextService` que:

1. 🗃️ Armazena informações relevantes da transação durante todo o fluxo da saga
2. 🔄 Carrega dados dinamicamente quando necessário (lazy loading)
3. 🌐 Mantém o contexto consistente entre as diferentes etapas da saga
4. 🔒 Garante a disponibilidade das informações mesmo em caso de falhas parciais

### 🧰 Padronização de Status

Implementamos enums consistentes para gerenciamento de status:

- `TransactionStatus`: Define os estados possíveis de uma transação (PENDING, RESERVED, PROCESSED, CONFIRMED, etc.)
- `NotificationType`: Define os tipos de notificações (WITHDRAWAL, DEPOSIT)
- `NotificationStatus`: Define os status de notificações (SUCCESS, FAILED)

Isso garante uma tipagem forte e consistência em todo o sistema, evitando erros de string literals.

## ✅ Por que CQRS + Event Sourcing + Saga?

### 🎯 Motivação

A escolha desta arquitetura para o sistema de gerenciamento de transações financeiras foi motivada por:

1. **Necessidade de Auditoria**: Sistemas financeiros exigem histórico completo e imutável de todas as operações
2. **Escalabilidade**: Separação entre leitura e escrita permite escalar cada lado independentemente
3. **Resiliência**: Armazenamento baseado em eventos facilita a recuperação de falhas
4. **Complexidade Transacional**: Transações financeiras envolvem múltiplos passos e possíveis compensações
5. **Evolução do Sistema**: Capacidade de reconstruir o estado a partir dos eventos facilita mudanças no modelo

### 🌟 Vantagens da Abordagem Implementada

1. **Rastreabilidade Completa**: Cada mudança de estado é registrada como um evento imutável
2. **Performance de Leitura**: Modelos de leitura otimizados para consultas específicas
3. **Consistência Eventual**: Operações complexas mantêm consistência mesmo em caso de falhas parciais
4. **Replayability**: Capacidade de reconstruir o estado aplicando eventos históricos
5. **Isolamento de Falhas**: O padrão Saga isola falhas e permite compensações controladas
6. **Desacoplamento**: Componentes loosely coupled facilitam manutenção e evolução
7. **Observabilidade**: Facilidade em monitorar cada etapa do processo

### 🧗‍♂️ Desafios Enfrentados

1. **Complexidade Inicial**: Implementar CQRS + Event Sourcing + Saga exige esforço inicial maior
2. **Consistência Eventual**: Requer mudança de paradigma em relação à consistência imediata
3. **Debugging**: Rastrear problemas através de eventos assíncronos pode ser desafiador
4. **Gerenciamento de Contexto**: Manter contexto entre etapas da saga exige mecanismos adicionais
5. **Idempotência**: Garantir que comandos possam ser repetidos sem efeitos colaterais
6. **Versionamento de Eventos**: Evolução do esquema de eventos requer estratégias cuidadosas

### 📊 Comparação com API GraphQL Tradicional sem CQRS/ES/Saga

| Aspecto                    | Nossa Abordagem (CQRS+ES+Saga)                        | API GraphQL Tradicional                            |
| -------------------------- | ----------------------------------------------------- | -------------------------------------------------- |
| **Auditoria**              | ✅ Histórico completo de eventos                      | ❌ Apenas estado atual, logs externos necessários  |
| **Escalabilidade**         | ✅ Leitura e escrita escalam independentemente        | ⚠️ Escalabilidade unificada, potenciais gargalos   |
| **Consistência**           | ⚠️ Eventual, com garantias por saga                   | ✅ Imediata/transacional                           |
| **Complexidade Inicial**   | ❌ Alta, curva de aprendizado íngreme                 | ✅ Moderada, familiar para muitos devs             |
| **Transações Complexas**   | ✅ Suporte nativo via saga                            | ⚠️ Requer implementação manual ou monolítica       |
| **Resiliência**            | ✅ Alta, operações podem continuar em falhas parciais | ⚠️ Média, falhas podem deixar dados inconsistentes |
| **Performance de Leitura** | ✅ Otimizada para cada tipo de consulta               | ✅ Boa com DataLoader e caching                    |
| **Evolução do Sistema**    | ✅ Facilita mudanças no modelo de dados               | ⚠️ Requer migrações cuidadosas                     |
| **Observabilidade**        | ✅ Rastreamento natural via eventos                   | ⚠️ Requer instrumentação adicional                 |
| **Time-to-Market**         | ❌ Mais lento inicialmente                            | ✅ Mais rápido para MVPs                           |

### 🎯 Quando Usar Esta Abordagem

Esta arquitetura é mais adequada para:

1. **Sistemas Financeiros**: Onde auditoria e rastreabilidade são críticos
2. **Aplicações de Alta Escala**: Com volume significativo de leituras/escritas
3. **Processos Complexos**: Envolvendo múltiplos passos e possível compensação
4. **Requisitos de Conformidade**: Onde auditoria e histórico imutável são necessários

Para aplicações mais simples, uma API GraphQL tradicional pode oferecer um caminho mais rápido para o desenvolvimento, com menor complexidade inicial.

# Arquitetura do Sistema - CQRS + Event Sourcing

## Diagrama de Arquitetura Completo

```mermaid
graph TB
    subgraph "Frontend / API Clients"
        Client(Cliente HTTP)
    end

    subgraph "API Layer"
        API[API Controllers]
        Metrics[Métricas/Monitoring]
    end

    subgraph "CQRS Pattern"
        Commands[Commands]
        Events[Events]
        Queries[Queries]
    end

    subgraph "Domain Modules"
        AccountsModule[Accounts Module]
        TransactionsModule[Transactions Module]
        UsersModule[Users Module]
    end

    subgraph "Saga Orchestration"
        WithdrawalSaga[Withdrawal Saga]
        TransactionContext[Transaction Context Service]
    end

    subgraph "Data Storage"
        EventStore[(Event Store - PostgreSQL)]
        ReadModel[(Read Model - MongoDB)]
    end

    subgraph "Messaging"
        RabbitMQ[RabbitMQ]
    end

    subgraph "Monitoring"
        Prometheus[(Prometheus)]
        Logging[(Logging)]
        Grafana[Grafana]
        Loki[Loki]
        FluentBit[Fluent Bit]
    end

    %% Conexões principais
    Client -->|HTTP Requests| API
    API -->|Dispatch| Commands
    API -->|Query| Queries

    Commands -->|Handle| Domain
    Domain -->|Emit| Events
    Events -->|Update| ReadModel
    Events -->|Store| EventStore

    %% Saga
    Events -->|Trigger| WithdrawalSaga
    WithdrawalSaga -->|Use| TransactionContext
    WithdrawalSaga -->|Dispatch| Commands

    %% Messaging
    Events -->|Publish| RabbitMQ
    RabbitMQ -->|Subscribe| Domain

    %% Monitoring
    API -->|Report| Metrics
    Commands -->|Metrics| Prometheus
    Events -->|Metrics| Prometheus
    Domain -->|Log| Logging
    Logging -->|Send| FluentBit
    FluentBit -->|Forward| Loki
    Prometheus --> Grafana
    Loki --> Grafana

    %% Consultas
    Queries -->|Read| ReadModel

    %% Subgraphs
    Domain[Domain Logic]
    AccountsModule --> Domain
    TransactionsModule --> Domain
    UsersModule --> Domain
```

## Fluxo da Saga de Saque (Withdrawal)

```mermaid
sequenceDiagram
    participant Client as Cliente
    participant API as API Layer
    participant Commands as Command Handlers
    participant Events as Event Handlers
    participant Saga as Withdrawal Saga
    participant ReadDB as MongoDB (Read Model)
    participant EventDB as PostgreSQL (Event Store)
    participant Queue as RabbitMQ
    participant Metrics as Prometheus/Logging

    Client->>API: POST /transactions/withdrawal
    API->>Commands: WithdrawalCommand

    Commands->>Events: BalanceCheckedEvent
    Events->>Saga: Trigger balanceChecked saga
    Saga->>Commands: ReserveBalanceCommand

    Commands->>Events: BalanceReservedEvent
    Events->>Saga: Trigger balanceReserved saga
    Saga->>Commands: ProcessTransactionCommand

    Commands->>Events: TransactionProcessedEvent
    Events->>Saga: Trigger transactionProcessed saga
    Saga->>Commands: ConfirmTransactionCommand

    Commands->>Events: TransactionConfirmedEvent
    Events->>Saga: Trigger transactionConfirmed saga
    Saga->>Commands: UpdateStatementCommand (Source)

    Commands->>Events: SourceStatementUpdatedEvent
    Events->>Saga: Trigger sourceStatementUpdated saga
    Saga->>Commands: NotifyUserCommand (Source)

    Commands->>Events: UserNotifiedEvent (Source)
    Events->>Saga: Trigger sourceUserNotified saga

    Note over Saga: Fim do fluxo bem-sucedido

    alt Falha no Processamento
        Commands-->>Events: TransactionProcessedEvent (failed)
        Events-->>Saga: Trigger compensation
        Saga-->>Commands: ReleaseBalanceCommand
    end

    alt Falha na Confirmação
        Commands-->>Events: TransactionConfirmedEvent (failed)
        Events-->>Saga: Trigger compensation
        Saga-->>Commands: ReleaseBalanceCommand
    end

    Events->>EventDB: Store Events
    Events->>ReadDB: Update Read Models
    Events->>Queue: Publish Events

    API->>Metrics: Record API metrics
    Commands->>Metrics: Record command metrics
    Events->>Metrics: Record event metrics
```

## Estrutura de Monitoramento

```mermaid
flowchart TB
    App[Aplicação NestJS]

    subgraph "Coleta de Métricas e Logs"
        Prometheus[(Prometheus)]
        FluentBit[Fluent Bit]
    end

    subgraph "Armazenamento e Visualização"
        Grafana[Grafana]
        Loki[(Loki)]
    end

    App -->|Expõe métricas| Prometheus
    App -->|Gera logs| FluentBit
    FluentBit -->|Encaminha logs| Loki
    Prometheus -->|Visualização de métricas| Grafana
    Loki -->|Visualização de logs| Grafana

    subgraph "Monitorado"
        CPU[CPU Usage]
        Memory[Memory Usage]
        Network[Network Traffic]
        API[API Requests]
        Commands[Command Execution]
        Queries[Query Execution]
        Errors[Error Rates]
    end

    App -->|Monitora| CPU
    App -->|Monitora| Memory
    App -->|Monitora| Network
    App -->|Monitora| API
    App -->|Monitora| Commands
    App -->|Monitora| Queries
    App -->|Monitora| Errors
```

## Modelo de Dados Principal

```mermaid
classDiagram
    class User {
        +String id
        +String name
        +String email
        +Date createdAt
        +Date updatedAt
    }

    class Account {
        +String id
        +String userId
        +Number balance
        +Number reservedBalance
        +String accountNumber
        +Date createdAt
        +Date updatedAt
    }

    class Transaction {
        +String id
        +String sourceAccountId
        +String destinationAccountId
        +Number amount
        +TransactionType type
        +TransactionStatus status
        +String description
        +Date createdAt
        +Date updatedAt
    }

    class Event {
        +String id
        +String aggregateId
        +String aggregateType
        +String eventType
        +Object data
        +Number version
        +Date timestamp
    }

    User "1" -- "n" Account : possui
    Account "1" -- "n" Transaction : participa
    Transaction "1" -- "n" Event : gera
```
