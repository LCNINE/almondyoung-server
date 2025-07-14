export class BNPLTransactionResponseDto {
  id: string;
  bnplAccountId: string;
  invoiceId: number;
  transactionType: 'DEBIT' | 'CREDIT';
  status: 'AUTHORIZED' | 'CAPTURED' | 'VOIDED';
  amount: number;
  createdAt: Date;
}
