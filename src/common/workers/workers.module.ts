import { Global, Module } from '@nestjs/common';
import { WorkerMessageProcessor } from './worker-message-processor';

/**
 * Módulo para lidar com processamento paralelo usando worker threads
 * Este módulo é global para que você possa injetar o serviço WorkerMessageProcessor em qualquer parte da aplicação
 */
@Global()
@Module({
  providers: [WorkerMessageProcessor],
  exports: [WorkerMessageProcessor],
})
export class WorkersModule {}
