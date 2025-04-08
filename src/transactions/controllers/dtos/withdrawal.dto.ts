// DTO para o endpoint de withdrawal
export class WithdrawalDto {
  sourceAccountId: string;
  destinationAccountId: string;
  amount: number;
  description?: string;
}
