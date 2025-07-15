import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateMemberRequestDto } from 'hms-api-wrapper/dist/services/BatchCms/types';
// 카드 결제수단 생성 DTO (HMS API 필수 필드 포함)
export interface CreateCardPaymentMethodDto {
  methodType: 'CARD';
  userId: number;
  methodName: string;
  isDefault?: boolean;
  institutionCode: string;
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

// 계좌이체 결제수단 생성 DTO (가상)
export interface CreateBankAccountPaymentMethodDto {
  methodType: 'BANK_ACCOUNT';
  userId: number;
  methodName: string;
  isDefault?: boolean;
  institutionCode: string;
  // 계좌 관련 필드들
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
}

// BNPL 결제수단 생성 DTO (내부용)
export interface CreateBnplPaymentMethodDto {
  userId: number;
  methodType: 'BNPL';
  methodName: string;
  isDefault?: boolean;
  institutionCode: string;
  creditLimit?: number;
  approvedLimit?: number;
  billingCycleDay: number;
  termsUrl?: string;
  settlementPaymentMethodId: string;
  phone?: string; // HMS 연동용 필드만 optional로 추가
}

// 통합 DTO 타입 (Discriminated Union) - 외부 PG사 연동이 필요한 결제수단만
export type CreatePaymentMethodDto =
  | CreateCardPaymentMethodDto
  | CreateBankAccountPaymentMethodDto
  | CreateBnplPaymentMethodDto;

export class UpdatePaymentMethodDto {
  @IsString()
  @IsOptional()
  @MaxLength(64)
  methodName?: string;

  @IsBoolean()
  @IsOptional()
  isDefault?: boolean;
}
