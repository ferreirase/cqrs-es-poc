import { Injectable } from '@nestjs/common';
import * as client from 'prom-client';

@Injectable()
export class PrometheusService {
  private registry: client.Registry;
  private counters: Map<string, client.Counter<string>>;
  private histograms: Map<string, client.Histogram<string>>;
  private gauges: Map<string, client.Gauge<string>>;

  constructor() {
    // Cria um novo registro e configura coleção padrão de métricas
    this.registry = new client.Registry();
    client.collectDefaultMetrics({
      register: this.registry,
      prefix: 'app_', // Prefixo para facilitar a identificação das nossas métricas
    });

    // Inicializa os maps para diferentes tipos de métricas
    this.counters = new Map();
    this.histograms = new Map();
    this.gauges = new Map();

    // Configura métricas iniciais para comandos e consultas
    this.registerCommandMetrics();
    this.registerQueryMetrics();
    this.registerResourceMetrics();
    this.registerApiMetrics();

    // Register domain-specific metrics
    this.registerEventStoreMetrics();
    this.registerTransactionMetrics();
    this.registerAccountMetrics();
  }

  private registerCommandMetrics(): void {
    // Contador para comandos executados
    this.createCounter('commands_total', 'Total de comandos executados', [
      'command',
      'status',
    ]);

    // Histograma para duração da execução de comandos
    this.createHistogram(
      'command_duration_seconds',
      'Duração da execução de comandos em segundos',
      ['command'],
      {
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      },
    );

    // Contador para registrar resultado dos comandos com mais detalhes
    this.createCounter(
      'command_results',
      'Resultados dos comandos executados',
      ['command', 'result', 'status'],
    );

    // Contador para operações de transações
    this.createCounter(
      'transaction_operations_total',
      'Total de operações de transação',
      ['type', 'status'],
    );
  }

  private registerQueryMetrics(): void {
    // Contador para queries executadas
    this.createCounter('queries_total', 'Total de consultas executadas', [
      'query',
      'status',
    ]);

    // Histograma para duração da execução de consultas
    this.createHistogram(
      'query_duration_seconds',
      'Duração da execução de consultas em segundos',
      ['query'],
      {
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      },
    );

    // Contador para registrar resultados de consultas em detalhes
    this.createCounter('query_results', 'Resultados das consultas executadas', [
      'query',
      'has_result',
      'status',
    ]);
  }

  private registerApiMetrics(): void {
    // Contador para requisições à API
    this.createCounter('api_requests_total', 'Total de requisições à API', [
      'path',
      'method',
      'operation',
    ]);

    // Contador para erros na API
    this.createCounter('api_errors_total', 'Total de erros na API', [
      'path',
      'method',
      'error_type',
    ]);

    // Histograma para duração das requisições à API
    this.createHistogram(
      'api_request_duration_seconds',
      'Duração das requisições à API em segundos',
      ['path', 'method', 'status'],
      {
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      },
    );
  }

  private registerResourceMetrics(): void {
    // Gauge para uso de CPU
    this.createGauge(
      'cpu_usage_percent',
      'Percentual de uso da CPU pelo processo',
      ['process'],
    );

    // Gauge para uso de memória
    this.createGauge('memory_usage_bytes', 'Uso de memória em bytes', [
      'process',
      'type',
    ]);

    // Gauge para carga do sistema
    this.createGauge('system_load', 'Carga média do sistema', ['period']);

    // Gauge para uso de memória do sistema
    this.createGauge(
      'system_memory_bytes',
      'Uso de memória do sistema em bytes',
      ['type'],
    );

    // Gauge para porcentagem de uso de memória do sistema
    this.createGauge(
      'system_memory_usage_percent',
      'Percentual de uso de memória do sistema',
      [],
    );

    // Gauge para conexões de rede
    this.createGauge(
      'network_connections',
      'Número de conexões de rede ativas',
      ['state', 'protocol'],
    );

    // Gauge para taxa de transferência de dados atual
    this.createGauge(
      'network_throughput_bytes_sec',
      'Taxa de transferência de dados em bytes por segundo',
      ['direction'],
    );

    // Contador para bytes enviados/recebidos
    this.createCounter(
      'network_traffic_bytes',
      'Bytes enviados ou recebidos pela rede',
      ['direction'],
    );
  }

  private registerEventStoreMetrics(): void {
    this.createCounter(
      'event_store_events_total',
      'Total de eventos armazenados',
      ['event_type', 'aggregate_type'],
    );

    this.createHistogram(
      'event_store_processing_duration_seconds',
      'Tempo de processamento de eventos em segundos',
      ['event_type'],
      {
        buckets: [0.01, 0.05, 0.1, 0.5, 1, 2, 5],
      },
    );

    this.createGauge(
      'event_store_last_event_timestamp',
      'Timestamp do último evento processado',
      ['aggregate_type'],
    );
  }

  private registerTransactionMetrics(): void {
    this.createCounter(
      'transactions_total',
      'Total de transações processadas',
      ['type', 'status'],
    );

    this.createHistogram(
      'transaction_amount_distribution',
      'Distribuição dos valores das transações',
      ['type'],
      {
        buckets: [10, 50, 100, 500, 1000, 5000, 10000],
      },
    );

    this.createGauge(
      'transactions_in_progress',
      'Número de transações em processamento',
      ['type'],
    );
  }

  private registerAccountMetrics(): void {
    this.createGauge('active_accounts', 'Número de contas ativas', ['status']);

    this.createHistogram(
      'account_balance_distribution',
      'Distribuição dos saldos das contas',
      ['account_type'],
      {
        buckets: [0, 100, 500, 1000, 5000, 10000, 50000],
      },
    );

    this.createCounter(
      'account_operations_total',
      'Total de operações em contas',
      ['operation_type', 'status'],
    );
  }

  public createCounter(
    name: string,
    help: string,
    labelNames: string[],
  ): client.Counter<string> {
    const fullName = `app_${name}`;
    if (!this.counters.has(fullName)) {
      const counter = new client.Counter({
        name: fullName,
        help,
        labelNames,
        registers: [this.registry],
      });
      this.counters.set(fullName, counter);
    }
    return this.counters.get(fullName);
  }

  public createHistogram(
    name: string,
    help: string,
    labelNames: string[],
    options?: Omit<
      client.HistogramConfiguration<string>,
      'name' | 'help' | 'labelNames' | 'registers'
    >,
  ): client.Histogram<string> {
    const fullName = `app_${name}`;
    if (!this.histograms.has(fullName)) {
      const histogram = new client.Histogram({
        name: fullName,
        help,
        labelNames,
        ...options,
        registers: [this.registry],
      });
      this.histograms.set(fullName, histogram);
    }
    return this.histograms.get(fullName);
  }

  public createGauge(
    name: string,
    help: string,
    labelNames: string[],
  ): client.Gauge<string> {
    const fullName = `app_${name}`;
    if (!this.gauges.has(fullName)) {
      const gauge = new client.Gauge({
        name: fullName,
        help,
        labelNames,
        registers: [this.registry],
      });
      this.gauges.set(fullName, gauge);
    }
    return this.gauges.get(fullName);
  }

  public getCounter(name: string): client.Counter<string> {
    const fullName = `app_${name}`;
    return this.counters.get(fullName);
  }

  public getHistogram(name: string): client.Histogram<string> {
    const fullName = `app_${name}`;
    return this.histograms.get(fullName);
  }

  public getGauge(name: string): client.Gauge<string> {
    const fullName = `app_${name}`;
    if (!this.gauges.has(fullName)) {
      console.warn(
        `Gauge '${fullName}' não encontrado. Registrando automaticamente.`,
      );
      // Cria um gauge padrão para evitar erros
      this.createGauge(name, `Auto-registered gauge for ${name}`, []);
    }
    return this.gauges.get(fullName);
  }

  public async getMetrics(): Promise<string> {
    return this.registry.metrics();
  }

  public getContentType(): string {
    return this.registry.contentType;
  }
}
