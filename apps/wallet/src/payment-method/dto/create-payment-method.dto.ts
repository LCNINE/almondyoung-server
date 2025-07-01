// 카드 결제수단 생성 DTO (HMS API 필수 필드 포함)
export interface CreateCardPaymentMethodDto {
  methodType: 'CARD';
  userId: number;
  isDefault?: boolean;
  // HMS API 필수 필드들
  memberName: string;
  phone: string;
  validMonth: string;
  validYear: string;
  // 카드 정보
  cardNumber: string;
  cardPassword: string;
  // 본인 인증 정보
  identityNumber: string; // 주민등록번호 또는 사업자번호
  customerEmail: string;
  // 납부자 정보 (identityNumber에서 앞 10자리만 사용)
  payerName: string;
}

// 은행계좌 결제수단 생성 DTO (향후 확장용)
export interface CreateBankPaymentMethodDto {
  methodType: 'BANK_ACCOUNT';
  userId: number;
  isDefault?: boolean;
  // 은행 관련 필드들
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
}

// Discriminated Union Type
export type CreatePaymentMethodDto =
  | CreateCardPaymentMethodDto
  | CreateBankPaymentMethodDto;
