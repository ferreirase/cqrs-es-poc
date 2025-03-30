import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import * as os from 'os';
import { LoggingService } from './logging.service';
import { PrometheusService } from './prometheus.service';

@Injectable()
export class SystemMetricsService implements OnModuleInit {
  private readonly logger = new Logger(SystemMetricsService.name);
  private startTime: number;
  private lastCpuUsage: NodeJS.CpuUsage;
  private lastNetworkStats: {
    rx_bytes: number;
    tx_bytes: number;
    timestamp: number;
  };

  constructor(
    private prometheusService: PrometheusService,
    private loggingService: LoggingService,
  ) {
    this.startTime = Date.now();
    this.lastCpuUsage = process.cpuUsage();
    this.lastNetworkStats = {
      rx_bytes: 0,
      tx_bytes: 0,
      timestamp: this.startTime,
    };
  }

  onModuleInit() {
    this.logger.log('System metrics monitoring started');
    // Inicialização imediata
    this.collectMetrics();
  }

  @Interval(15000) // Coleta métricas a cada 15 segundos
  async collectMetrics(): Promise<void> {
    try {
      this.collectCpuMetrics();
      this.collectMemoryMetrics();
      this.collectNetworkMetrics();

      // Registra no log todas as métricas coletadas
      this.loggingService.logSystemMetrics({
        cpu: this.getCpuInfo(),
        memory: this.getMemoryInfo(),
        network: await this.estimateNetworkUsage(),
        uptime: process.uptime(),
      });
    } catch (error) {
      this.logger.error(`Error collecting system metrics: ${error.message}`);
    }
  }

  private collectCpuMetrics(): void {
    const cpuInfo = this.getCpuInfo();

    // Registra uso de CPU
    this.prometheusService
      .getGauge('cpu_usage_percent')
      .set({ process: 'main' }, cpuInfo.processUsage);

    // Registra também a carga do sistema
    for (let i = 0; i < cpuInfo.systemLoadAvg.length; i++) {
      this.prometheusService
        .getGauge('system_load')
        .set({ period: `${i + 1}min` }, cpuInfo.systemLoadAvg[i]);
    }
  }

  private collectMemoryMetrics(): void {
    const memoryInfo = this.getMemoryInfo();

    // Registra uso de memória do processo
    this.prometheusService
      .getGauge('memory_usage_bytes')
      .set({ process: 'main', type: 'rss' }, memoryInfo.processMemory.rss);

    this.prometheusService
      .getGauge('memory_usage_bytes')
      .set(
        { process: 'main', type: 'heapTotal' },
        memoryInfo.processMemory.heapTotal,
      );

    this.prometheusService
      .getGauge('memory_usage_bytes')
      .set(
        { process: 'main', type: 'heapUsed' },
        memoryInfo.processMemory.heapUsed,
      );

    // Registra uso de memória do sistema
    this.prometheusService
      .getGauge('system_memory_bytes')
      .set({ type: 'total' }, memoryInfo.systemMemory.total);

    this.prometheusService
      .getGauge('system_memory_bytes')
      .set({ type: 'free' }, memoryInfo.systemMemory.free);

    this.prometheusService
      .getGauge('system_memory_usage_percent')
      .set({}, memoryInfo.systemMemory.usedPercent);
  }

  private async collectNetworkMetrics(): Promise<void> {
    try {
      const networkStats = await this.estimateNetworkUsage();

      // Incrementa contadores de tráfego de rede
      this.prometheusService
        .getCounter('network_traffic_bytes')
        .inc({ direction: 'received' }, networkStats.bytesReceived);

      this.prometheusService
        .getCounter('network_traffic_bytes')
        .inc({ direction: 'sent' }, networkStats.bytesSent);

      // Atualiza gauge para taxa de transferência atual
      this.prometheusService
        .getGauge('network_throughput_bytes_sec')
        .set({ direction: 'received' }, networkStats.rxBytesPerSecond);

      this.prometheusService
        .getGauge('network_throughput_bytes_sec')
        .set({ direction: 'sent' }, networkStats.txBytesPerSecond);
    } catch (error) {
      this.logger.error(`Error collecting network metrics: ${error.message}`);
    }
  }

  private getCpuInfo() {
    // Obtém informações de uso da CPU
    const currentCpuUsage = process.cpuUsage(this.lastCpuUsage);
    const cpuUsageMicros = currentCpuUsage.user + currentCpuUsage.system;
    const elapsedMs = 15000; // assumindo intervalos de 15 segundos

    // Calcula a porcentagem de uso (considerando todos os núcleos)
    const numCores = os.cpus().length;
    const processUsage = ((cpuUsageMicros / 1000 / elapsedMs) * 100) / numCores;

    this.lastCpuUsage = process.cpuUsage();

    return {
      processUsage,
      systemLoadAvg: os.loadavg(),
      numCpus: numCores,
    };
  }

  private getMemoryInfo() {
    const processMemory = process.memoryUsage();
    const systemMemory = {
      total: os.totalmem(),
      free: os.freemem(),
      usedPercent: (1 - os.freemem() / os.totalmem()) * 100,
    };

    return {
      processMemory,
      systemMemory,
    };
  }

  private async estimateNetworkUsage() {
    // Esta é uma estimativa simplificada do uso de rede
    // Em um ambiente real, você pode usar bibliotecas como 'systeminformation'

    // Simula cálculos de recepção e transmissão para demonstração
    const now = Date.now();
    const elapsedSecs = (now - this.lastNetworkStats.timestamp) / 1000;

    // Simula valores de rede com base em conexões HTTP e outros fatores
    // Numa aplicação real, use bibliotecas dedicadas para medir o tráfego real
    // Aqui estamos apenas simulando para demonstração das métricas
    const currentStats = {
      rx_bytes:
        this.lastNetworkStats.rx_bytes + Math.floor(Math.random() * 50000),
      tx_bytes:
        this.lastNetworkStats.tx_bytes + Math.floor(Math.random() * 30000),
      timestamp: now,
    };

    const bytesReceived =
      currentStats.rx_bytes - this.lastNetworkStats.rx_bytes;
    const bytesSent = currentStats.tx_bytes - this.lastNetworkStats.tx_bytes;

    const rxBytesPerSecond = bytesReceived / elapsedSecs;
    const txBytesPerSecond = bytesSent / elapsedSecs;

    // Atualiza o último estado para a próxima medição
    this.lastNetworkStats = currentStats;

    return {
      bytesReceived,
      bytesSent,
      rxBytesPerSecond,
      txBytesPerSecond,
    };
  }
}
