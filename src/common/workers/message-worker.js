const { parentPort } = require('worker_threads');

// Garante que o script está sendo executado como um worker
if (!parentPort) {
  console.error('Este script deve ser executado como um worker thread');
  process.exit(1);
}

// Log para debug
console.log(`Worker inicializado: ${process.pid}`);

// Função para processar mensagens
async function processMessage(data) {
  try {
    // Verifica a operação solicitada
    if (data.operation === 'createTransaction') {
      return processTransaction(data.data);
    } else {
      // Para outras operações, use o processamento padrão
      return simulateProcessing(data);
    }
  } catch (error) {
    console.error(`Erro no processamento da mensagem: ${error.message}`);
    throw error;
  }
}

// Função específica para processar transações
async function processTransaction(transactionData) {
  console.log(
    `Processando transação ${transactionData.transactionId} no worker`,
  );

  try {
    // Validação de dados
    if (
      !transactionData.transactionId ||
      !transactionData.sourceAccountId ||
      !transactionData.amount
    ) {
      throw new Error('Dados de transação incompletos');
    }

    // Aqui seria implementada lógica pesada, como:
    // - Validações complexas
    // - Cálculos financeiros
    // - Verificações de regras de negócio

    // Simular algum processamento que consome CPU
    let result = 0;
    for (let i = 0; i < 100000; i++) {
      result += Math.sqrt(i) * Math.random();
    }

    return {
      processed: true,
      transactionId: transactionData.transactionId,
      sourceAccountId: transactionData.sourceAccountId,
      destinationAccountId: transactionData.destinationAccountId,
      amount: transactionData.amount,
      type: transactionData.type,
      timestamp: new Date().toISOString(),
      processingResult: result,
      status: 'CREATED',
    };
  } catch (error) {
    console.error(`Erro ao processar transação: ${error.message}`);
    throw error;
  }
}

// Função que simula algum processamento assíncrono genérico
async function simulateProcessing(data) {
  return new Promise(resolve => {
    // Simula algum processamento que leva tempo
    setTimeout(() => {
      const result = {
        processed: true,
        originalData: data,
        timestamp: new Date().toISOString(),
      };

      resolve(result);
    }, 10); // Tempo de processamento simulado (10ms)
  });
}

// Registra manipulador de mensagens do thread principal
parentPort.on('message', async message => {
  if (!message || !message.taskId) {
    parentPort.postMessage({
      error: 'Formato de mensagem inválido',
    });
    return;
  }

  const { taskId, data } = message;

  try {
    console.log(`Worker recebeu tarefa ${taskId}`);

    // Processa a mensagem
    const result = await processMessage(data);

    console.log(`Worker concluiu tarefa ${taskId}`);

    // Retorna o resultado para o thread principal
    parentPort.postMessage({
      taskId,
      data: result,
    });
  } catch (error) {
    console.error(`Erro na tarefa ${taskId}: ${error.message}`);

    // Retorna o erro para o thread principal
    parentPort.postMessage({
      taskId,
      error: error.message || 'Erro desconhecido no processamento',
    });
  }
});

// Log quando o worker é finalizado
process.on('exit', code => {
  console.log(`Worker finalizando com código: ${code}`);
});

// Tratamento de erros não capturados
process.on('uncaughtException', error => {
  console.error(`Exceção não capturada no worker: ${error.message}`);
  console.error(error.stack);
  // Não encerramos o worker para manter o pool funcionando
});

// Tratamento de rejeições não tratadas
process.on('unhandledRejection', (reason, promise) => {
  console.error('Rejeição não tratada no worker:');
  console.error(reason);
  // Não encerramos o worker para manter o pool funcionando
});
