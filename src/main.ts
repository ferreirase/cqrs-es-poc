import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { Response } from 'express';
import { AppModule } from './app.module';
import { PrometheusService } from './common/monitoring/prometheus.service';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: '*',
    methods: 'GET,HEAD,PUT,PATCH,POST,DELETE',
    preflightContinue: false,
  });

  app.setGlobalPrefix('api');
  app.useGlobalPipes(new ValidationPipe());

  app.use('/health', (_, res: Response) => {
    return res.status(200).json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  app.get(PrometheusService);

  Logger.log(
    'Prometheus metrics disponíveis em: http://localhost:3001/api/metrics',
  );

  await app.listen(3001, () => {
    Logger.log('Application is running on: http://localhost:3001');
  });
}
bootstrap();
