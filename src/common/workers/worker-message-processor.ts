import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import * as os from 'os';
import * as path from 'path';
import { Worker } from 'worker_threads';

// Interface para representar uma tarefa enviada para um worker
interface WorkerTask {
  taskId: string;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
  data: any;
}

/**
 * Serviço que processa mensagens usando worker threads
 * Esta implementação é mais simples e focada em performance
 */
@Injectable()
export class WorkerMessageProcessor implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(WorkerMessageProcessor.name);
  private workers: Worker[] = [];
  private workerIndex = 0;
  private pendingTasks = new Map<string, WorkerTask>();
  private isInitialized = false;

  constructor() {}

  async onModuleInit() {
    // Inicialização automática quando o módulo é carregado
    await this.initialize();
  }

  async onModuleDestroy() {
    // Garantir que todos os workers sejam encerrados
    await this.shutdown();
  }

  /**
   * Inicializa o pool de workers
   * @param workerCount Número de workers a serem criados (padrão: número de CPUs disponíveis)
   */
  async initialize(workerCount?: number): Promise<void> {
    if (this.isInitialized) {
      this.logger.warn('Worker pool já está inicializado');
      return;
    }

    const numWorkers = workerCount || os.cpus().length * 1.5;
    this.logger.log(`Inicializando pool com ${numWorkers} workers`);

    try {
      for (let i = 0; i < numWorkers; i++) {
        const worker = this.createWorker();
        this.workers.push(worker);
      }

      this.isInitialized = true;
      this.logger.log('Pool de workers inicializado com sucesso');
    } catch (error) {
      this.logger.error(
        `Erro ao inicializar pool de workers: ${error.message}`,
      );
      // Tenta limpar workers que foram criados antes do erro
      await this.shutdown();
      throw error;
    }
  }

  /**
   * Processa uma mensagem usando o pool de workers
   * @param data Os dados a serem processados
   * @returns Uma promise com o resultado do processamento
   */
  async processMessage<T = any>(data: any): Promise<T> {
    if (!this.isInitialized || this.workers.length === 0) {
      throw new Error('Worker pool não está inicializado');
    }

    return new Promise<T>((resolve, reject) => {
      const taskId = this.generateTaskId();

      // Seleciona o próximo worker usando round-robin
      const workerIndex = this.workerIndex % this.workers.length;
      this.workerIndex++;

      const worker = this.workers[workerIndex];

      // Registra a tarefa
      this.pendingTasks.set(taskId, {
        taskId,
        resolve,
        reject,
        data,
      });

      // Envia os dados para o worker
      worker.postMessage({ taskId, data });

      this.logger.debug(
        `Mensagem enviada para worker ${workerIndex}, taskId: ${taskId}`,
      );
    });
  }

  /**
   * Encerra o pool de workers
   */
  async shutdown(): Promise<void> {
    if (this.workers.length === 0) {
      return;
    }

    this.logger.log(`Encerrando pool de ${this.workers.length} workers`);

    // Rejeita todas as tarefas pendentes
    for (const task of this.pendingTasks.values()) {
      task.reject(new Error('Worker pool sendo desligado'));
    }
    this.pendingTasks.clear();

    // Encerra todos os workers
    const terminationPromises = this.workers.map(worker => {
      return new Promise<void>(resolve => {
        worker.once('exit', () => resolve());
        worker.terminate();
      });
    });

    await Promise.all(terminationPromises);
    this.workers = [];
    this.isInitialized = false;

    this.logger.log('Pool de workers encerrado com sucesso');
  }

  /**
   * Cria um novo worker e configura seus listeners
   */
  private createWorker(): Worker {
    const workerPath = path.resolve(__dirname, 'message-worker.js');
    const worker = new Worker(workerPath);

    // Configura o handler para receber mensagens do worker
    worker.on('message', message => {
      const { taskId, data, error } = message;

      if (!taskId || !this.pendingTasks.has(taskId)) {
        this.logger.warn(
          `Recebida mensagem para taskId desconhecido: ${taskId}`,
        );
        return;
      }

      const task = this.pendingTasks.get(taskId);
      this.pendingTasks.delete(taskId);

      if (error) {
        this.logger.error(
          `Erro no processamento da tarefa ${taskId}: ${error}`,
        );
        task.reject(new Error(error));
      } else {
        this.logger.debug(`Tarefa ${taskId} concluída com sucesso`);
        task.resolve(data);
      }
    });

    // Tratamento de erros do worker
    worker.on('error', error => {
      this.logger.error(`Erro no worker: ${error.message}`);
      // Não encerramos o pool aqui - seria melhor implementar uma lógica
      // para recriar o worker que falhou
    });

    // Monitoramento do ciclo de vida do worker
    worker.on('exit', code => {
      if (code !== 0) {
        this.logger.warn(`Worker encerrado com código ${code}`);
      }
    });

    return worker;
  }

  /**
   * Gera um ID único para a tarefa
   */
  private generateTaskId(): string {
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 5);
  }
}
