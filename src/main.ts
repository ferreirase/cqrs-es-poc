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

  // Obtém o serviço do Prometheus para garantir que a instância seja inicializada
  const prometheusService = app.get(PrometheusService);
  Logger.log(
    'Prometheus metrics disponíveis em: http://localhost:3001/api/metrics',
  );

  await app.listen(3001, () => {
    Logger.log('Application is running on: http://localhost:3001');
  });
}
bootstrap();
