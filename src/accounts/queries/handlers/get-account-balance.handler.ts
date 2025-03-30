import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { AccountDocument } from '../../models/account.schema';
import { GetAccountBalanceQuery } from '../impl/get-account-balance.query';

@QueryHandler(GetAccountBalanceQuery)
export class GetAccountBalanceHandler
  implements IQueryHandler<GetAccountBalanceQuery>
{
  constructor(
    @InjectModel(AccountDocument.name)
    private accountModel: Model<AccountDocument>,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(query: GetAccountBalanceQuery) {
    const queryName = 'GetAccountBalanceQuery';
    const startTime = Date.now();

    // Log início da consulta
    this.loggingService.logQueryStart(queryName, { id: query.id });

    try {
      const account = await this.accountModel.findOne({ id: query.id }).exec();

      if (!account) {
        // Registrar consulta sem resultados
        this.prometheusService
          .getCounter('queries_total')
          .inc({ query: queryName, status: 'not_found' }, 1);

        this.loggingService.warn(`Account not found with ID: ${query.id}`, {
          queryName,
          accountId: query.id,
          type: 'query_not_found',
        });

        throw new NotFoundException(`Account with ID "${query.id}" not found`);
      }

      // Registrar métricas de sucesso
      const executionTime = (Date.now() - startTime) / 1000;
      this.prometheusService
        .getCounter('queries_total')
        .inc({ query: queryName, status: 'success' }, 1);
      this.prometheusService
        .getHistogram('query_duration_seconds')
        .observe({ query: queryName }, executionTime);

      // Log sucesso (sem incluir o valor do saldo por questões de privacidade)
      this.loggingService.logQuerySuccess(
        queryName,
        { id: query.id },
        executionTime,
      );

      return account.balance;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        // Registrar métricas de erro (somente para erros que não são NotFoundException)
        this.prometheusService
          .getCounter('queries_total')
          .inc({ query: queryName, status: 'error' }, 1);
        this.loggingService.logQueryError(queryName, error);
      }

      throw error;
    }
  }
}
