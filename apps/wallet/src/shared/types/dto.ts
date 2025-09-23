// src/payment-method/dto/create-payment-method.dto.ts
export interface CreatePaymentMethodDto {
  userId: string; // 다른 MSA(user-service)에서 관리됨
  methodName: string; // 카드/계좌 별칭 정도
  methodType?: string; // 'CMS' 기본
  metadata?: Record<string, any>;
}
