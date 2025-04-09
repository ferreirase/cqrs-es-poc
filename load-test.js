import { check, sleep } from 'k6';
import http from 'k6/http';

// Configuração do teste
export const options = {
  stages: [
    { duration: '30s', target: 8 }, // Rampa mais lenta para 8 usuários, reduzindo a carga inicial
    { duration: '1m', target: 10 }, // Aumenta gradualmente para 10 usuários
    { duration: '30s', target: 0 }, // Rampa de descida
  ],
  thresholds: {
    http_req_failed: ['rate<0.01'], // Menos de 1% de falhas
    http_req_duration: ['p(95)<500'], // 95% das requisições abaixo de 500ms
  },
};

const BASE_URL = 'http://localhost:3001/api'; // Verifique se esta é a URL correta da sua API

// Função para gerar UUID v4 (necessário se a API valida)
function uuidv4() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
    var r = (Math.random() * 16) | 0,
      v = c == 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// Função para criar um usuário
function createUser(emailPrefix) {
  const uniqueId = uuidv4();
  const payload = JSON.stringify({
    name: `${emailPrefix}_${uniqueId.substring(0, 8)}`,
    document: `${Math.floor(10000000000 + Math.random() * 90000000000)}`, // Gera um CPF fictício
    email: `${emailPrefix}_${uniqueId.substring(0, 8)}@loadtest.com`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(`${BASE_URL}/users`, payload, params);

  check(response, { 'user created successfully': r => r.status === 201 });

  if (response.status !== 201) {
    console.error(`Failed to create user: ${response.status} ${response.body}`);
    return null;
  }

  return response.json();
}

// Função para criar uma conta para um usuário
function createAccount(ownerId, initialBalance = 0) {
  const payload = JSON.stringify({
    ownerId: ownerId,
    initialBalance: initialBalance,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(`${BASE_URL}/accounts`, payload, params);

  check(response, { 'account created successfully': r => r.status === 201 });

  if (response.status !== 201) {
    console.error(
      `Failed to create account for owner ${ownerId}: ${response.status} ${response.body}`,
    );
    return null;
  }
  return response.json();
}

// Função para verificar o saldo
function getBalance(accountId) {
  const response = http.get(`${BASE_URL}/accounts/${accountId}/balance`);
  check(response, { 'get balance successful': r => r.status === 200 });
  if (response.status !== 200) {
    console.error(
      `Failed to get balance for account ${accountId}: ${response.status} ${response.body}`,
    );
    return -1; // Retorna -1 para indicar falha
  }
  // O balance pode vir como string ou número, garantir que seja número
  const balance = parseFloat(response.json().balance);
  return isNaN(balance) ? -1 : balance;
}

// Função para criar uma transação de SAQUE (Withdrawal)
function createWithdrawal(sourceAccountId, destinationAccountId, amount) {
  const payload = JSON.stringify({
    sourceAccountId: sourceAccountId,
    destinationAccountId: destinationAccountId,
    amount: amount,
    type: 'withdrawal',
    description: `Withdrawal load test - ${amount}`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  // Usar o endpoint específico de withdrawal
  const response = http.post(`${BASE_URL}/transactions`, payload, params);

  // Espera-se 202 Accepted, pois inicia uma saga
  check(response, {
    'withdrawal initiated successfully': r =>
      r.status === 200 || r.status === 201 || r.status === 202,
  });

  if (
    response.status !== 200 &&
    response.status !== 201 &&
    response.status !== 202
  ) {
    console.error(
      `Failed to initiate withdrawal: ${response.status} ${response.body}`,
    );
  }

  return response.json();
}

// Função principal do teste
export default function () {
  // 1. Criar Payer User e Receiver User
  const payerUser = createUser('payer');
  const receiverUser = createUser('receiver');

  if (!payerUser || !receiverUser) {
    console.error('Failed to create users, aborting VU iteration.');
    return; // Aborta esta iteração do usuário virtual
  }
  const payerUserId = payerUser.id;
  const receiverUserId = receiverUser.id;

  // 2. Criar Payer Account e Receiver Account
  const payerAccount = createAccount(payerUserId, 1000); // Payer começa com 1000
  const receiverAccount = createAccount(receiverUserId, 0); // Receiver começa com 0

  if (!payerAccount || !receiverAccount) {
    console.error('Failed to create accounts, aborting VU iteration.');
    return; // Aborta esta iteração do usuário virtual
  }
  const payerAccountId = payerAccount.id;
  const receiverAccountId = receiverAccount.id;

  console.log(
    `VU ${__VU}: Payer User ${payerUserId}, Account ${payerAccountId}`,
  );
  console.log(
    `VU ${__VU}: Receiver User ${receiverUserId}, Account ${receiverAccountId}`,
  );

  // 3. Loop de transações de Withdrawal
  const withdrawalAmount = 50; // Valor de cada saque
  let withdrawalCount = 0;
  const maxWithdrawals = 5; // Limite para 5 saques por usuário para evitar sobrecarga

  while (withdrawalCount < maxWithdrawals) {
    const currentBalance = getBalance(payerAccountId);
    console.log(
      `VU ${__VU}: Payer Account ${payerAccountId} current balance: ${currentBalance}`,
    );

    if (currentBalance < withdrawalAmount) {
      console.log(
        `VU ${__VU}: Payer balance (${currentBalance}) insufficient for withdrawal (${withdrawalAmount}). Ending loop.`,
      );
      break; // Sai do loop se não houver saldo suficiente
    }

    if (currentBalance === -1) {
      console.error(
        `VU ${__VU}: Failed to get payer balance. Aborting withdrawals for this iteration.`,
      );
      break; // Sai se falhou em obter o saldo
    }

    console.log(
      `VU ${__VU}: Initiating withdrawal #${
        withdrawalCount + 1
      } of ${withdrawalAmount} from ${payerAccountId} to ${receiverAccountId}`,
    );
    createWithdrawal(payerAccountId, receiverAccountId, withdrawalAmount);
    withdrawalCount++;

    // Pausa entre operações para simular um fluxo mais realista
    sleep(5); // Pausa de 5 segundos entre saques
  }

  console.log(
    `VU ${__VU}: Completed ${withdrawalCount} withdrawals for payer ${payerAccountId}.`,
  );

  // Opcional: verificar saldo final
  const finalPayerBalance = getBalance(payerAccountId);
  const finalReceiverBalance = getBalance(receiverAccountId);

  console.log(
    `VU ${__VU}: Final Payer Balance: ${finalPayerBalance}, Final Receiver Balance: ${finalReceiverBalance}`,
  );

  sleep(10); // Pausa final antes do próximo VU (ou fim) - aumentado para 10 segundos
}
