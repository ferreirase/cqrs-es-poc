import { check, sleep } from 'k6';
import http from 'k6/http';

// Configuração do teste
export const options = {
  stages: [
    { duration: '1m', target: 20 }, // Rampa de subida para 20 usuários em 1 minuto
    { duration: '2m', target: 20 }, // Manter 20 usuários por 2 minutos
    { duration: '1m', target: 0 }, // Rampa de descida para 0 em 1 minuto
  ],
};

const BASE_URL = 'http://localhost:3000'; // Ajuste conforme sua configuração

// Função auxiliar para gerar ID único
function generateId() {
  return Math.random().toString(36).substring(2, 15);
}

// Função para criar uma conta
function createAccount() {
  const payload = JSON.stringify({
    owner: `user_${generateId()}`,
    initialBalance: 1000,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(`${BASE_URL}/accounts`, payload, params);
  check(response, { 'account created successfully': r => r.status === 201 });

  return response.json();
}

// Função para verificar o saldo
function getBalance(accountId) {
  const response = http.get(`${BASE_URL}/accounts/${accountId}/balance`);
  check(response, { 'get balance successful': r => r.status === 200 });

  return response.json().balance;
}

// Função para criar uma transação (deposit ou withdrawal)
function createTransaction(accountId, amount, type) {
  const payload = JSON.stringify({
    sourceAccountId: accountId,
    destinationAccountId: accountId, // Para simplificar, usamos a mesma conta
    amount: Math.abs(amount), // Sempre valor positivo, o tipo define se é crédito ou débito
    type: type,
    description: `${type} operation - load test`,
  });

  const params = {
    headers: {
      'Content-Type': 'application/json',
    },
  };

  const response = http.post(`${BASE_URL}/transactions`, payload, params);

  check(response, {
    'transaction created successfully': r => r.status === 201,
  });

  return response.json();
}

// Função principal do teste
export default function () {
  // Criar uma nova conta
  const account = createAccount();
  const accountId = account.id;

  // Loop de operações até zerar o saldo
  while (true) {
    const currentBalance = getBalance(accountId);

    if (currentBalance <= 0) break;

    // Alterna entre deposit e withdrawal
    if (Math.random() > 0.5 && currentBalance < 1000) {
      // Limita o saldo máximo a 1000
      // Deposit
      createTransaction(accountId, 100, 'deposit');
    } else {
      // Withdrawal (verifica se tem saldo suficiente primeiro)
      if (currentBalance >= 50) {
        createTransaction(accountId, 50, 'withdrawal');
      }
    }

    // Pequena pausa entre operações
    sleep(1);
  }
}
