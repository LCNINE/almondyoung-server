export class BNPLAccountResponseDto {
  id: string;
  userId: number;
  // settlementPaymentMethodId 제거 - BNPL은 자체 완결형 결제수단
  creditLimit: number;
  currentBalance: number;
  status: 'ACTIVE' | 'INACTIVE' | 'OVERDUE' | 'SUSPENDED';
  billingCycleDay: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}
