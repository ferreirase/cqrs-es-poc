const { parentPort, workerData } = require('worker_threads');

// Identificador do worker
const workerId = workerData.id;

// Handler para processar mensagens
parentPort.on('message', async message => {
  if (message.type === 'task') {
    try {
      // Aqui faz o processamento real da mensagem
      // Neste caso, apenas simulamos o processamento
      const result = await processMessage(message.payload);

      // Envia o resultado de volta para o thread principal
      parentPort.postMessage({
        type: 'result',
        result,
        error: null,
      });
    } catch (error) {
      // Em caso de erro, envia o erro de volta
      parentPort.postMessage({
        type: 'result',
        result: null,
        error: error.message || 'Erro desconhecido no worker',
      });
    }
  }
});

/**
 * Função que processa a mensagem
 * Na implementação real, esta função seria mais complexa
 * Este é apenas um exemplo simples
 */
async function processMessage(payload) {
  // Simula algum processamento
  return new Promise(resolve => {
    setTimeout(() => {
      resolve({
        processedBy: `worker-${workerId}`,
        original: payload,
        timestamp: new Date().toISOString(),
      });
    }, 10); // Simula um processamento muito rápido (10ms)
  });
}

// Log quando o worker é inicializado
console.log(
  `Worker ${workerId} inicializado e pronto para processar mensagens`,
);
