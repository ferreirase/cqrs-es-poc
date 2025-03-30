import { Module } from '@nestjs/common';
import { LoggingService } from './logging.service';
import { MetricsController } from './metrics.controller';
import { PrometheusService } from './prometheus.service';
import { SystemMetricsService } from './system-metrics.service';

@Module({
  imports: [],
  controllers: [MetricsController],
  providers: [PrometheusService, SystemMetricsService, LoggingService],
  exports: [PrometheusService, SystemMetricsService, LoggingService],
})
export class MonitoringModule {}
