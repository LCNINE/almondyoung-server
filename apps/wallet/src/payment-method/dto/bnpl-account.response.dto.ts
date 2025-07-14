export class BNPLAccountResponseDto {
  id: string;
  userId: number;
  settlementPaymentMethodId: string;
  creditLimit: number;
  currentBalance: number;
  status: 'ACTIVE' | 'OVERDUE' | 'SUSPENDED';
  billingCycleDay: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
