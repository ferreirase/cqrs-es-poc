import { Injectable } from '@nestjs/common';
import * as winston from 'winston';
const LokiTransport = require('winston-loki');
const { hostname } = require('os');

@Injectable()
export class LoggingService {
  private logger: winston.Logger;
  private commandStartTimes: Map<string, number> = new Map();
  private queryStartTimes: Map<string, number> = new Map();

  constructor() {
    const host =
      process.env.NODE_ENV === 'production' ? 'fluentbit' : 'localhost';
    this.logger = winston.createLogger({
      level: 'info',
      format: winston.format.combine(
        winston.format.timestamp(),
        winston.format.json(),
      ),
      defaultMeta: {
        service: 'transaction-service',
        host: hostname(),
        environment: process.env.NODE_ENV || 'development',
      },
      transports: [
        new winston.transports.Console({
          format: winston.format.combine(
            winston.format.colorize(),
            winston.format.timestamp(),
            winston.format.printf(({ timestamp, level, message, ...meta }) => {
              return `${timestamp} [${level}]: ${message} ${
                Object.keys(meta).length ? JSON.stringify(meta) : ''
              }`;
            }),
          ),
        }),
        new LokiTransport({
          host: 'http://loki.monitoring.svc.cluster.local:3100',
          labels: {
            app: 'cqrs-es-poc',
            service: 'transaction-service',
            environment: process.env.NODE_ENV || 'development',
          },
          json: true,
          format: winston.format.json(),
          replaceTimestamp: true,
          batching: true,
          interval: 5,
          onConnectionError: err =>
            console.error('Loki connection error:', err),
          timeout: 5000,
          basicAuth: process.env.LOKI_AUTH
            ? {
                username: process.env.LOKI_USERNAME || 'admin',
                password: process.env.LOKI_PASSWORD || 'admin',
              }
            : undefined,
        }),
        // FluentBit transport over TCP
        new winston.transports.Http({
          host: host,
          port: 24224,
          path: '/',
          ssl: false,
          format: winston.format.json(),
        }),
      ],
    });
  }

  info(message: string, meta?: any): void {
    this.logger.info(message, meta);
  }

  warn(message: string, meta?: any): void {
    this.logger.warn(message, meta);
  }

  error(message: string, meta?: any): void {
    this.logger.error(message, meta);
  }

  // Registra métricas de sistema periodicamente
  logSystemMetrics(metrics: any): void {
    this.logger.info('System metrics', {
      type: 'system_metrics',
      ...metrics,
    });
  }

  // Comandos
  logCommandError(commandName: string, error: Error, args?: any): void {
    const startTime = this.commandStartTimes.get(commandName);
    if (startTime) {
      this.commandStartTimes.delete(commandName);
    }

    this.logger.error('Command execution failed', {
      commandName,
      commandType: 'command',
      error: error.message,
      stack: error.stack,
      args,
      success: false,
      timestamp: Date.now(),
    });
  }

  logHandlerStart(handlerName: string, args: any): void {
    const startTime = Date.now();
    if (handlerName.includes('Command')) {
      this.commandStartTimes.set(handlerName, startTime);
    } else {
      this.queryStartTimes.set(handlerName, startTime);
    }

    this.logger.info('Handler execution started', {
      handlerName,
      handlerType: handlerName.includes('Command') ? 'command' : 'query',
      args,
      timestamp: startTime,
    });
  }

  logCommandSuccess(
    commandName: string,
    args: any,
    duration: number,
    result?: any,
  ): void {
    this.logger.info('Command execution succeeded', {
      commandName,
      commandType: 'command',
      args,
      duration,
      output: this.sanitizeOutput(result),
      success: true,
      timestamp: Date.now(),
    });
  }

  logHandlerEnd(handlerName: string, event: any): void {
    const startTime = handlerName.includes('Command')
      ? this.commandStartTimes.get(handlerName)
      : this.queryStartTimes.get(handlerName);

    if (!startTime) {
      this.logger.warn('No start time found for handler', { handlerName });
      return;
    }

    const duration = (Date.now() - startTime) / 1000; // Convert to seconds

    if (handlerName.includes('Command')) {
      this.commandStartTimes.delete(handlerName);
    } else {
      this.queryStartTimes.delete(handlerName);
    }

    this.logger.info('Handler execution finished', {
      handlerName,
      handlerType: handlerName.includes('Command') ? 'command' : 'query',
      duration: duration.toFixed(3), // Format to 3 decimal places
      result: this.sanitizeOutput(event),
      success: true,
      timestamp: Date.now(),
    });
  }

  // Eventos
  logEvent(eventName: string, args: any, duration: number): void {
    this.logger.info('Event dispatched', {
      eventName,
      eventType: 'event',
      args,
      duration,
      timestamp: Date.now(),
    });
  }

  // Consultas
  logQueryStart(queryName: string, args: any): void {
    this.logger.info('Query execution started', {
      queryName,
      queryType: 'query',
      args,
      timestamp: Date.now(),
    });
  }

  logQuerySuccess(
    queryName: string,
    args: any,
    duration: number,
    result?: any,
  ): void {
    this.logger.info('Query execution succeeded', {
      queryName,
      queryType: 'query',
      args,
      duration,
      result: this.sanitizeOutput(result),
      success: true,
      timestamp: Date.now(),
    });
  }

  logQueryError(queryName: string, error: Error, args?: any): void {
    const startTime = this.queryStartTimes.get(queryName);
    if (startTime) {
      this.queryStartTimes.delete(queryName);
    }

    this.logger.error('Query execution failed', {
      queryName,
      queryType: 'query',
      error: error.message,
      stack: error.stack,
      args,
      success: false,
      timestamp: Date.now(),
    });
  }

  // Rotas de API
  logRoute(route: string, method: string, requestParams: any): void {
    this.logger.info('API route called', {
      route,
      method,
      requestType: 'http',
      args: requestParams,
      timestamp: Date.now(),
    });
  }

  // Sanitiza a saída para evitar dados muito grandes no log
  private sanitizeOutput(output: any): any {
    if (!output) return null;

    try {
      // Se for um array grande, resumir
      if (Array.isArray(output) && output.length > 5) {
        return {
          type: 'array',
          length: output.length,
          sample: output.slice(0, 3),
          truncated: true,
        };
      }

      // Para objetos, limitamos o tamanho
      if (typeof output === 'object') {
        const stringifiedOutput = JSON.stringify(output);
        if (stringifiedOutput.length > 1000) {
          return {
            type: 'large_object',
            size: stringifiedOutput.length,
            truncated: true,
            preview: JSON.parse(stringifiedOutput.substring(0, 500) + '...'),
          };
        }
      }

      return output;
    } catch (e) {
      return {
        type: 'unserializable',
        error: 'Could not serialize output for logging',
      };
    }
  }
}
