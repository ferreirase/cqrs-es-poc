import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
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

  app.get(PrometheusService);

  app.getHttpAdapter().get('/health', (_, res) => {
    return res.json({
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
    });
  });

  Logger.log(
    'Prometheus metrics disponíveis em: http://localhost:3001/api/metrics',
  );

  await app.listen(3001, () => {
    Logger.log('Application is running on: http://localhost:3001');
  });
}
bootstrap();
