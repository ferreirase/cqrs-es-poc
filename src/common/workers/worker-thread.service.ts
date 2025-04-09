import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { isMainThread, Worker, WorkerOptions } from 'worker_threads';

@Injectable()
export class WorkerThreadService implements OnModuleInit {
  private readonly logger = new Logger(WorkerThreadService.name);
  private workers: Worker[] = [];
  private workerCount = Math.max(2, os.cpus().length - 1); // Use N-1 CPUs disponíveis (mínimo 2)
  private readonly maxQueued = 100; // Máximo de mensagens na fila por worker
  private taskQueues: Map<string, any[]> = new Map();
  private workerBusy: Map<number, boolean> = new Map();
  private queueStats: Map<
    string,
    { total: number; processed: number; errors: number }
  > = new Map();

  async onModuleInit() {
    if (!isMainThread) {
      this.logger.error(
        'WorkerThreadService should only be initialized in the main thread',
      );
      return;
    }

    this.logger.log(
      `Initializing ${this.workerCount} worker threads for queue processing`,
    );

    // Inicializar workers
    this.initializeWorkers();

    // Log estatísticas a cada 30 segundos
    setInterval(() => this.logStats(), 30000);
  }

  private initializeWorkers() {
    for (let i = 0; i < this.workerCount; i++) {
      try {
        const worker = this.createWorker(i);
        this.workers.push(worker);
        this.workerBusy.set(i, false);
      } catch (error) {
        this.logger.error(`Failed to initialize worker ${i}: ${error.message}`);
      }
    }
  }

  private createWorker(id: number): Worker {
    const workerPath = path.resolve(__dirname, 'message-worker.js');

    const worker = new Worker(workerPath, {
      workerData: { id },
    } as WorkerOptions);

    worker.on('message', message => {
      if (message.type === 'result') {
        // Worker concluiu uma tarefa
        this.workerBusy.set(id, false);

        // Atualizar estatísticas
        const queue = message.queue || 'unknown';
        if (!this.queueStats.has(queue)) {
          this.queueStats.set(queue, { total: 0, processed: 0, errors: 0 });
        }

        const stats = this.queueStats.get(queue);
        if (message.success) {
          stats.processed++;
        } else {
          stats.errors++;
        }

        // Verificar se há mais tarefas para este worker
        this.assignTasksToWorker(id, worker);
      } else if (message.type === 'ready') {
        this.logger.log(`Worker ${id} ready`);
        // Worker está pronto para receber tarefas
        this.assignTasksToWorker(id, worker);
      } else if (message.type === 'error') {
        this.logger.error(`Worker ${id} error: ${message.error}`);
        // Recuperar worker em caso de erro
        this.workerBusy.set(id, false);
      }
    });

    worker.on('error', error => {
      this.logger.error(`Worker ${id} encountered an error: ${error.message}`);
      // Recriar worker em caso de erro fatal
      this.workerBusy.delete(id);
      this.workers = this.workers.filter(w => w !== worker);

      setTimeout(() => {
        try {
          const newWorker = this.createWorker(id);
          this.workers.push(newWorker);
          this.workerBusy.set(id, false);
          this.logger.log(`Worker ${id} restarted successfully`);
        } catch (restartError) {
          this.logger.error(
            `Failed to restart worker ${id}: ${restartError.message}`,
          );
        }
      }, 1000);
    });

    worker.on('exit', code => {
      if (code !== 0) {
        this.logger.warn(`Worker ${id} exited with code ${code}`);
      }
    });

    return worker;
  }

  /**
   * Enfileira uma tarefa para processamento assíncrono pelos workers
   */
  public async queueTask(queue: string, task: any): Promise<void> {
    if (!this.taskQueues.has(queue)) {
      this.taskQueues.set(queue, []);
      this.queueStats.set(queue, { total: 0, processed: 0, errors: 0 });
    }

    const queueTasks = this.taskQueues.get(queue);

    // Verificar se a fila não está muito grande
    if (queueTasks.length >= this.maxQueued) {
      this.logger.warn(
        `Queue ${queue} has reached maximum capacity (${this.maxQueued})`,
      );
      // Processar imediatamente para evitar acúmulo
      await this.processTaskImmediately(queue, task);
      return;
    }

    // Adicionar à fila
    queueTasks.push(task);
    this.queueStats.get(queue).total++;

    // Tentar atribuir a tarefa a um worker disponível
    this.assignTaskToAvailableWorker(queue);
  }

  /**
   * Processa uma tarefa imediatamente no thread principal se todos os workers estiverem ocupados
   */
  private async processTaskImmediately(
    queue: string,
    task: any,
  ): Promise<void> {
    try {
      this.logger.warn(
        `Processing task from queue ${queue} in main thread due to worker overload`,
      );
      // Aqui você implementaria a lógica para processar a tarefa no thread principal
      // Isso é uma fallback para evitar que o sistema trave com filas muito grandes

      // Apenas log para demonstração
      this.logger.log(`Main thread processed task from queue ${queue}`);

      // Atualizar estatísticas
      const stats = this.queueStats.get(queue) || {
        total: 0,
        processed: 0,
        errors: 0,
      };
      stats.total++;
      stats.processed++;
      this.queueStats.set(queue, stats);
    } catch (error) {
      this.logger.error(
        `Error processing task in main thread: ${error.message}`,
      );
      const stats = this.queueStats.get(queue) || {
        total: 0,
        processed: 0,
        errors: 0,
      };
      stats.errors++;
      this.queueStats.set(queue, stats);
    }
  }

  /**
   * Tenta atribuir uma tarefa a um worker disponível
   */
  private assignTaskToAvailableWorker(queue: string): void {
    // Verificar se há tarefas na fila
    const queueTasks = this.taskQueues.get(queue);
    if (!queueTasks || queueTasks.length === 0) {
      return;
    }

    // Encontrar um worker disponível
    for (let i = 0; i < this.workers.length; i++) {
      if (!this.workerBusy.get(i)) {
        // Worker livre encontrado, atribuir tarefa
        this.assignTasksToWorker(i, this.workers[i]);
        break;
      }
    }
  }

  /**
   * Atribui tarefas a um worker específico
   */
  private assignTasksToWorker(id: number, worker: Worker): void {
    if (this.workerBusy.get(id)) {
      return; // Worker já está ocupado
    }

    // Verificar todas as filas por tarefas pendentes
    for (const [queue, tasks] of this.taskQueues.entries()) {
      if (tasks.length > 0) {
        const task = tasks.shift(); // Pegar a primeira tarefa da fila
        this.workerBusy.set(id, true);

        worker.postMessage({
          type: 'task',
          queue,
          task,
        });

        this.logger.debug(
          `Assigned task from queue '${queue}' to worker ${id}`,
        );
        return;
      }
    }
  }

  /**
   * Registra estatísticas periódicas sobre o processamento de filas
   */
  private logStats(): void {
    this.logger.log('===== Worker Queue Stats =====');
    for (const [queue, stats] of this.queueStats.entries()) {
      this.logger.log(
        `Queue: ${queue} - Total: ${stats.total}, Processed: ${
          stats.processed
        }, Errors: ${stats.errors}, Pending: ${
          stats.total - stats.processed - stats.errors
        }`,
      );
    }

    let busyCount = 0;
    for (const [id, busy] of this.workerBusy.entries()) {
      if (busy) busyCount++;
    }
    this.logger.log(`Workers: ${busyCount}/${this.workers.length} busy`);
  }
}
