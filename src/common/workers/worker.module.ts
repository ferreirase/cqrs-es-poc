import { DynamicModule, Module } from '@nestjs/common';
import { WorkerThreadService } from './worker-thread.service';

@Module({
  providers: [WorkerThreadService],
  exports: [WorkerThreadService],
})
export class WorkerModule {
  static forRoot(): DynamicModule {
    return {
      module: WorkerModule,
      global: true,
      providers: [WorkerThreadService],
      exports: [WorkerThreadService],
    };
  }
}
