import { Controller, Get, Header, Res } from '@nestjs/common';
import { Response } from 'express';
import { PrometheusService } from './prometheus.service';

@Controller('metrics')
export class MonitoringController {
  constructor(private readonly prometheusService: PrometheusService) {}

  @Get()
  @Header('Content-Type', 'text/plain')
  getMetrics(@Res() response: Response): void {
    response.set('Content-Type', this.prometheusService.getContentType());
    response.send(this.prometheusService.getMetrics());
  }

  @Get('health')
  health() {
    return { status: 'UP' };
  }
}
