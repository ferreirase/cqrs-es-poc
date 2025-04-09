# Fluxo de Saque (Withdrawal) com RabbitMQ

Este documento descreve o fluxo de uma operação de saque (withdrawal) no sistema após a migração para filas RabbitMQ.

## Diagrama do Fluxo

```mermaid
sequenceDiagram
    participant Client
    participant API
    participant WithdrawalHandler
    participant RabbitMQ
    participant BalanceService
    participant TransactionService
    participant StatementService
    participant NotificationService
    participant WithdrawalSaga
    participant EventStoreService
    participant DeduplicationService

    Client->>API: Solicita saque
    API->>WithdrawalHandler: Processa pedido de saque
    WithdrawalHandler->>TransactionService: Cria transação (TransactionAggregate)
    WithdrawalHandler->>RabbitMQ: Publica CheckAccountBalanceCommand
    RabbitMQ-->>BalanceService: Consome CheckAccountBalanceCommand

    BalanceService->>RabbitMQ: Publica BalanceCheckedEvent
    RabbitMQ-->>WithdrawalSaga: Consome BalanceCheckedEvent

    alt Saldo suficiente
        WithdrawalSaga->>RabbitMQ: Publica ReserveBalanceCommand
        RabbitMQ-->>BalanceService: Consome ReserveBalanceCommand
        BalanceService->>RabbitMQ: Publica BalanceReservedEvent
        RabbitMQ-->>WithdrawalSaga: Consome BalanceReservedEvent

        WithdrawalSaga->>TransactionService: Atualiza status para PROCESSING
        WithdrawalSaga->>RabbitMQ: Publica ProcessTransactionCommand
        RabbitMQ-->>TransactionService: Consome ProcessTransactionCommand
        TransactionService->>RabbitMQ: Publica TransactionProcessedEvent
        RabbitMQ-->>WithdrawalSaga: Consome TransactionProcessedEvent

        WithdrawalSaga->>RabbitMQ: Publica ConfirmTransactionCommand
        RabbitMQ-->>TransactionService: Consome ConfirmTransactionCommand
        TransactionService->>RabbitMQ: Publica TransactionConfirmedEvent
        RabbitMQ-->>WithdrawalSaga: Consome TransactionConfirmedEvent

        WithdrawalSaga->>RabbitMQ: Publica UpdateAccountStatementCommand (Source)
        RabbitMQ-->>StatementService: Consome UpdateAccountStatementCommand
        StatementService->>RabbitMQ: Publica StatementUpdatedEvent (Source)
        Note right of RabbitMQ: EventStoreService verifica duplicidade (inclui accountId)
        EventStoreService->>DeduplicationService: isDuplicateOrProcessing(StatementUpdatedEvent, txId, sourceAccountId)
        alt Evento não duplicado
            EventStoreService->>EventStoreService: Salva Evento
            EventStoreService->>DeduplicationService: registerEventAsProcessed(...)
            RabbitMQ-->>WithdrawalSaga: Consome StatementUpdatedEvent (Source)
            WithdrawalSaga->>RabbitMQ: Publica UpdateAccountStatementCommand (Destination) # Se houver
            RabbitMQ-->>StatementService: Consome UpdateAccountStatementCommand
            StatementService->>RabbitMQ: Publica StatementUpdatedEvent (Destination)
            Note right of RabbitMQ: EventStoreService verifica duplicidade (inclui accountId)
            EventStoreService->>DeduplicationService: isDuplicateOrProcessing(StatementUpdatedEvent, txId, destAccountId)
            alt Evento não duplicado
                EventStoreService->>EventStoreService: Salva Evento
                EventStoreService->>DeduplicationService: registerEventAsProcessed(...)
                RabbitMQ-->>WithdrawalSaga: Consome StatementUpdatedEvent (Destination)
                WithdrawalSaga->>RabbitMQ: Publica NotifyUserCommand (Source)
            else Evento duplicado
                 Note over EventStoreService, WithdrawalSaga: Evento Ignorado
            end
        else Evento duplicado
             Note over EventStoreService, WithdrawalSaga: Evento Ignorado
        end

        RabbitMQ-->>NotificationService: Consome NotifyUserCommand (Source)
        NotificationService->>RabbitMQ: Publica UserNotifiedEvent (Source)
        Note right of RabbitMQ: EventStoreService verifica duplicidade (inclui userId, accountId)
        EventStoreService->>DeduplicationService: isDuplicateOrProcessing(UserNotifiedEvent, txId, sourceUserId, sourceAccId)
        alt Evento não duplicado
           EventStoreService->>EventStoreService: Salva Evento
           EventStoreService->>DeduplicationService: registerEventAsProcessed(...)
           RabbitMQ-->>WithdrawalSaga: Consome UserNotifiedEvent (Source)
           alt Há conta de destino
                WithdrawalSaga->>RabbitMQ: Publica NotifyUserCommand (Destination)
                RabbitMQ-->>NotificationService: Consome NotifyUserCommand (Destination)
                NotificationService->>RabbitMQ: Publica UserNotifiedEvent (Destination)
                Note right of RabbitMQ: EventStoreService verifica duplicidade (inclui userId, accountId)
                EventStoreService->>DeduplicationService: isDuplicateOrProcessing(UserNotifiedEvent, txId, destUserId, destAccId)
                alt Evento não duplicado
                    EventStoreService->>EventStoreService: Salva Evento
                    EventStoreService->>DeduplicationService: registerEventAsProcessed(...)
                    RabbitMQ-->>WithdrawalSaga: Consome UserNotifiedEvent (Destination)
                    WithdrawalSaga->>TransactionService: Atualiza status para COMPLETED
                    WithdrawalSaga->>RabbitMQ: Publica TransactionCompletedEvent # Evento final
                else Evento duplicado
                    Note over EventStoreService, WithdrawalSaga: Evento Ignorado
                end
           else Não há conta de destino
                WithdrawalSaga->>TransactionService: Atualiza status para COMPLETED
                WithdrawalSaga->>RabbitMQ: Publica TransactionCompletedEvent # Evento final
           end
        else Evento duplicado
            Note over EventStoreService, WithdrawalSaga: Evento Ignorado
        end

    else Saldo insuficiente
        WithdrawalSaga->>TransactionService: Atualiza status para FAILED
    end
```

## Descrição do Fluxo

1. **Início da Transação**:

   - O cliente solicita um saque através da API
   - O WithdrawalHandler cria uma transação de saque via TransactionAggregate
   - Publica o comando CheckAccountBalanceCommand para a fila RabbitMQ

2. **Verificação de Saldo**:

   - O BalanceService consome o comando e verifica se há saldo suficiente
   - Publica o evento BalanceCheckedEvent com o resultado

3. **Fluxo para Saldo Suficiente**:

   - WithdrawalSaga processa o evento BalanceCheckedEvent
   - Se houver saldo, publica o comando ReserveBalanceCommand
   - O BalanceService reserva o saldo e publica BalanceReservedEvent
   - WithdrawalSaga atualiza o status da transação para PROCESSING
   - Publica o comando ProcessTransactionCommand

4. **Processamento e Confirmação**:

   - TransactionService processa e publica TransactionProcessedEvent
   - WithdrawalSaga publica ConfirmTransactionCommand
   - TransactionService confirma e publica TransactionConfirmedEvent

5. **Atualização de Extrato**:

   - WithdrawalSaga publica UpdateAccountStatementCommand
   - StatementService atualiza o extrato e publica StatementUpdatedEvent

6. **Notificação ao Usuário**:

   - WithdrawalSaga publica NotifyUserCommand
   - NotificationService notifica o usuário e publica UserNotifiedEvent
   - WithdrawalSaga finaliza a transação como COMPLETED

7. **Fluxo para Saldo Insuficiente**:
   - Se não houver saldo, a transação é marcada como FAILED

## Compensação em Caso de Falha

Se ocorrer uma falha em qualquer etapa após a reserva do saldo, o sistema executa um processo de compensação:

```mermaid
sequenceDiagram
    participant FailedService
    participant RabbitMQ
    participant BalanceService
    participant WithdrawalSaga
    participant TransactionService

    FailedService->>RabbitMQ: Publica evento de falha
    RabbitMQ-->>WithdrawalSaga: Consome evento de falha
    WithdrawalSaga->>RabbitMQ: Publica ReleaseBalanceCommand
    RabbitMQ-->>BalanceService: Consome ReleaseBalanceCommand
    BalanceService->>RabbitMQ: Publica BalanceReleasedEvent
    RabbitMQ-->>WithdrawalSaga: Consome BalanceReleasedEvent
    WithdrawalSaga->>TransactionService: Atualiza status para FAILED
```

Este fluxo assegura que, mesmo em caso de falhas, o sistema mantenha a consistência e evite problemas como perda de saldo ou transações em estado inconsistente.
