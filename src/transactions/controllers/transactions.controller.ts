import {
  Body,
  Controller,
  Get,
  NotFoundException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { Request } from 'express';
import { v4 as uuidv4 } from 'uuid';
import { RabbitMQService } from '../../common/messaging/rabbitmq.service';
import { LoggingService } from '../../common/monitoring/logging.service';
import { PrometheusService } from '../../common/monitoring/prometheus.service';
import { CreateTransactionCommand } from '../commands/impl/create-transaction.command';
import { TransactionType } from '../models/transaction.entity';
import { GetAccountTransactionsQuery } from '../queries/impl/get-account-transactions.query';
import { GetAllTransactionsQuery } from '../queries/impl/get-all-transactions.query';
import { GetTransactionQuery } from '../queries/impl/get-transaction.query';
import { WithdrawalDto } from './dtos/withdrawal.dto';

class CreateTransactionDto {
  sourceAccountId: string;
  destinationAccountId?: string;
  amount: number;
  type: TransactionType;
  description?: string;
}

@Controller('transactions')
export class TransactionsController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
    private readonly loggingService: LoggingService,
    private readonly prometheusService: PrometheusService,
    private readonly rabbitmqService: RabbitMQService,
  ) {}

  @Post()
  async createTransaction(@Body() createTransactionDto: CreateTransactionDto) {
    const startTime = Date.now();
    const route = 'POST /transactions';

    // Log da chamada de API
    this.loggingService.logRoute(route, 'POST', createTransactionDto);

    // Registra intenção da API
    this.prometheusService.getCounter('api_requests_total').inc(
      {
        path: '/transactions',
        method: 'POST',
        operation: 'create_transaction',
      },
      1,
    );

    try {
      await this.commandBus.execute(
        new CreateTransactionCommand(
          null, // id will be generated in the handler
          createTransactionDto.sourceAccountId,
          createTransactionDto.destinationAccountId || null,
          createTransactionDto.amount,
          createTransactionDto.type,
          createTransactionDto.description,
        ),
      );

      // Registra sucesso da API
      const executionTime = (Date.now() - startTime) / 1000;

      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions',
            method: 'POST',
            status: '202', // Accepted - a saga foi iniciada
          },
          executionTime,
        );

      return {
        message: 'Withdrawal operation started',
        status: 'PROCESSING',
        _metadata: {
          responseTime: executionTime,
        },
      };
    } catch (error) {
      // Registra erro da API
      const executionTime = (Date.now() - startTime) / 1000;

      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions',
            method: 'POST',
            status: error.status || '500',
          },
          executionTime,
        );

      this.prometheusService.getCounter('api_errors_total').inc(
        {
          path: '/transactions',
          method: 'POST',
          error_type: error.name || 'UnknownError',
        },
        1,
      );

      this.loggingService.error(`API error in ${route}`, {
        route,
        method: 'POST',
        error: error.message,
        stack: error.stack,
        requestBody: createTransactionDto,
      });

      throw error;
    }
  }

  @Get(':id')
  async getTransaction(@Param('id') id: string, @Req() request: Request) {
    const startTime = Date.now();
    const route = `GET /transactions/${id}`;

    // Log da chamada de API
    this.loggingService.logRoute(route, 'GET', { id });

    // Registra intenção da API
    this.prometheusService.getCounter('api_requests_total').inc(
      {
        path: '/transactions/:id',
        method: 'GET',
        operation: 'get_transaction',
      },
      1,
    );

    try {
      const transaction = await this.queryBus.execute(
        new GetTransactionQuery(id),
      );

      // Registra sucesso da API
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions/:id',
            method: 'GET',
            status: '200',
          },
          executionTime,
        );

      return {
        transaction,
        _metadata: {
          responseTime: executionTime,
        },
      };
    } catch (error) {
      // Registra erro da API
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions/:id',
            method: 'GET',
            status:
              error instanceof NotFoundException
                ? '404'
                : error.status || '500',
          },
          executionTime,
        );

      this.prometheusService.getCounter('api_errors_total').inc(
        {
          path: '/transactions/:id',
          method: 'GET',
          error_type:
            error instanceof NotFoundException
              ? 'NotFound'
              : error.name || 'UnknownError',
        },
        1,
      );

      this.loggingService.error(`API error in ${route}`, {
        route,
        method: 'GET',
        error: error.message,
        params: { id },
      });

      if (error instanceof NotFoundException) {
        throw error;
      }
      throw new NotFoundException(`Transaction with ID "${id}" not found`);
    }
  }

  @Get('account/:accountId')
  async getAccountTransactions(
    @Param('accountId') accountId: string,
    @Req() request: Request,
  ) {
    const startTime = Date.now();
    const route = `GET /transactions/account/${accountId}`;

    // Log da chamada de API
    this.loggingService.logRoute(route, 'GET', { accountId });

    // Registra intenção da API
    this.prometheusService.getCounter('api_requests_total').inc(
      {
        path: '/transactions/account/:accountId',
        method: 'GET',
        operation: 'get_account_transactions',
      },
      1,
    );

    try {
      const transactions = await this.queryBus.execute(
        new GetAccountTransactionsQuery(accountId),
      );

      // Registra sucesso da API
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions/account/:accountId',
            method: 'GET',
            status: '200',
          },
          executionTime,
        );

      return {
        transactions,
        count: transactions.length,
        _metadata: {
          responseTime: executionTime,
        },
      };
    } catch (error) {
      // Registra erro da API
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions/account/:accountId',
            method: 'GET',
            status: error.status || '500',
          },
          executionTime,
        );

      this.prometheusService.getCounter('api_errors_total').inc(
        {
          path: '/transactions/account/:accountId',
          method: 'GET',
          error_type: error.name || 'UnknownError',
        },
        1,
      );

      this.loggingService.error(`API error in ${route}`, {
        route,
        method: 'GET',
        error: error.message,
        params: { accountId },
      });

      throw error;
    }
  }

  @Post('withdrawal')
  async withdrawal(@Body() withdrawalDto: WithdrawalDto) {
    const startTime = Date.now();
    const route = 'POST /transactions/withdrawal';

    this.loggingService.logRoute(route, 'POST', withdrawalDto);
    this.prometheusService
      .getCounter('api_requests_total')
      .inc({ path: route, method: 'POST', operation: 'withdrawal' }, 1);

    try {
      // Gerar um ID de transação aqui, pois o handler agora espera um
      const transactionId = uuidv4();

      // Criar o payload da mensagem para RabbitMQ
      const messagePayload = {
        commandName: 'WithdrawalCommand', // Identifica o tipo de comando para o handler
        payload: {
          id: transactionId, // Passar o ID gerado
          sourceAccountId: withdrawalDto.sourceAccountId,
          destinationAccountId: withdrawalDto.destinationAccountId,
          amount: withdrawalDto.amount,
          description: withdrawalDto.description || 'Withdrawal operation',
        },
      };

      // Publicar diretamente na exchange/routing key que o handler está ouvindo
      await this.rabbitmqService.publishToExchange(
        'commands.withdrawal', // Routing key
        messagePayload, // Mensagem completa
        { exchangeName: 'paymaker-exchange' }, // Nome da exchange
      );

      // Log e métricas de sucesso (API aceitou a requisição)
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe({ path: route, method: 'POST', status: '202' }, executionTime);

      this.loggingService.info(`[${route}] Withdrawal request accepted`, {
        transactionId, // Loggar o ID gerado
        requestBody: withdrawalDto,
      });

      // Retornar status 202 Accepted, indicando que a requisição foi aceita para processamento
      return {
        message: 'Withdrawal operation accepted for processing.',
        status: 'ACCEPTED',
        transactionId: transactionId, // Retornar o ID para rastreamento
        _metadata: { responseTime: executionTime },
      };
    } catch (error) {
      // Lógica de erro da API (sem alterações significativas)
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          { path: route, method: 'POST', status: error.status || '500' },
          executionTime,
        );
      this.prometheusService.getCounter('api_errors_total').inc(
        {
          path: route,
          method: 'POST',
          error_type: error.name || 'UnknownError',
        },
        1,
      );
      this.loggingService.error(`API error in ${route}`, {
        route,
        method: 'POST',
        error: error.message,
        stack: error.stack,
        requestBody: withdrawalDto,
      });
      throw error;
    }
  }

  @Get('')
  async getAllTransactions() {
    const startTime = Date.now();
    const route = 'GET /transactions';

    // Log da chamada de API
    this.loggingService.logRoute(route, 'GET', {});

    // Registra intenção da API
    this.prometheusService.getCounter('api_requests_total').inc(
      {
        path: '/transactions',
        method: 'GET',
        operation: 'get_all_transactions',
      },
      1,
    );

    try {
      const transactions = await this.queryBus.execute(
        new GetAllTransactionsQuery(),
      );

      // Registra sucesso da API
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions',
            method: 'GET',
            status: '200',
          },
          executionTime,
        );

      return {
        transactions,
        count: transactions.length,
        _metadata: {
          responseTime: executionTime,
        },
      };
    } catch (error) {
      // Registra erro da API
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getHistogram('api_request_duration_seconds')
        .observe(
          {
            path: '/transactions',
            method: 'GET',
            status: error.status || '500',
          },
          executionTime,
        );

      this.prometheusService.getCounter('api_errors_total').inc(
        {
          path: '/transactions',
          method: 'GET',
          error_type: error.name || 'UnknownError',
        },
        1,
      );

      this.loggingService.error(`API error in ${route}`, {
        route,
        method: 'GET',
        error: error.message,
      });

      throw error;
    }
  }
}
