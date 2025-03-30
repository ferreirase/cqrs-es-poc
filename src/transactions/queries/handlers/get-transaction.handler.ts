import { NotFoundException } from '@nestjs/common';
import { IQueryHandler, QueryHandler } from '@nestjs/cqrs';
import { InjectModel } from '@nestjs/mongoose';
import { Model } from 'mongoose';
import { LoggingService } from '../../../common/monitoring/logging.service';
import { PrometheusService } from '../../../common/monitoring/prometheus.service';
import { TransactionDocument } from '../../models/transaction.schema';
import { GetTransactionQuery } from '../impl/get-transaction.query';

@QueryHandler(GetTransactionQuery)
export class GetTransactionHandler
  implements IQueryHandler<GetTransactionQuery>
{
  constructor(
    @InjectModel(TransactionDocument.name)
    private transactionModel: Model<TransactionDocument>,
    private loggingService: LoggingService,
    private prometheusService: PrometheusService,
  ) {}

  async execute(query: GetTransactionQuery) {
    const queryName = 'GetTransactionQuery';
    const startTime = Date.now();

    // Log início da consulta com os parâmetros
    this.loggingService.logQueryStart(queryName, {
      id: query.id,
    });

    try {
      const transaction = await this.transactionModel.findOne({
        id: query.id,
      });

      const executionTime = (Date.now() - startTime) / 1000;

      if (!transaction) {
        // Registrar métricas de consulta sem resultados
        this.prometheusService
          .getCounter('queries_total')
          .inc({ query: queryName, status: 'not_found' }, 1);

        this.prometheusService
          .getHistogram('query_duration_seconds')
          .observe({ query: queryName }, executionTime);

        this.prometheusService
          .getCounter('query_results')
          .inc(
            { query: queryName, has_result: 'false', status: 'not_found' },
            1,
          );

        // Log de resultado não encontrado
        this.loggingService.warn(`Transaction not found with ID: ${query.id}`, {
          queryName,
          transactionId: query.id,
          duration: executionTime,
          status: 'not_found',
        });

        throw new NotFoundException(
          `Transaction with ID "${query.id}" not found`,
        );
      }

      // Registrar métricas de sucesso da consulta
      this.prometheusService
        .getCounter('queries_total')
        .inc({ query: queryName, status: 'success' }, 1);

      this.prometheusService
        .getHistogram('query_duration_seconds')
        .observe({ query: queryName }, executionTime);

      this.prometheusService
        .getCounter('query_results')
        .inc({ query: queryName, has_result: 'true', status: 'success' }, 1);

      // Log resultado da consulta
      this.loggingService.logQuerySuccess(
        queryName,
        { id: query.id },
        executionTime,
        {
          transactionId: transaction.id,
          type: transaction.type,
          status: transaction.status,
          amount: transaction.amount,
          createdAt: transaction.createdAt,
        },
      );

      return transaction;
    } catch (error) {
      if (!(error instanceof NotFoundException)) {
        // Registrar métricas de erro (exceto para NotFoundException que já foi registrada)
        this.prometheusService
          .getCounter('queries_total')
          .inc({ query: queryName, status: 'error' }, 1);

        // Log de erro
        this.loggingService.logQueryError(queryName, error, { id: query.id });
      }

      throw error;
    }
  }
}
