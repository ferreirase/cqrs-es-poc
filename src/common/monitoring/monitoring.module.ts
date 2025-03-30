import { Module } from '@nestjs/common';
import { LoggingService } from './logging.service';
import { MonitoringController } from './monitoring.controller';
import { PrometheusService } from './prometheus.service';
import { SystemMetricsService } from './system-metrics.service';

@Module({
  imports: [],
  controllers: [MonitoringController],
  providers: [PrometheusService, LoggingService, SystemMetricsService],
  exports: [PrometheusService, LoggingService],
})
export class MonitoringModule {}
