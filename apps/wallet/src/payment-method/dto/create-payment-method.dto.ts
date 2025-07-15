import { IsBoolean, IsOptional, IsString, MaxLength } from 'class-validator';
import { CreateMemberRequestDto } from 'hms-api-wrapper/dist/services/BatchCms/types';
// [내부 비즈니스용 DTO] 카드 결제수단 생성
export interface CreateCardPaymentMethodDto {
  methodType: 'CARD';
  userId: number;
  methodName: string;
  isDefault?: boolean;
  institutionCode: string;
  // 카드 결제에 필요한 내부 필드만 포함
  cardNumber: string;
  cardPassword: string;
  validMonth: string;
  validYear: string;
  identityNumber: string;
  customerEmail: string;
  payerName: string;
  phone: string;
}

// [내부 비즈니스용 DTO] 계좌 결제수단 생성
export interface CreateBankAccountPaymentMethodDto {
  methodType: 'BANK_ACCOUNT';
  userId: number;
  methodName: string;
  isDefault?: boolean;
  institutionCode: string;
  bankCode: string;
  accountNumber: string;
  accountHolderName: string;
}

// [내부 비즈니스용 DTO] BNPL 결제수단 생성
export interface CreateBnplPaymentMethodDto {
  methodType: 'BNPL';
  userId: number;
  methodName: string;
  isDefault?: boolean;
  institutionCode: string;
  creditLimit?: number;
  approvedLimit?: number;
  billingCycleDay: number;
  termsUrl?: string;
  settlementPaymentMethodId: string;
  phone?: string;
}

// [PG 연동용 DTO]는 각 서비스/전략에서 공식 타입(CreatePaymentProfileDto, CreateMemberRequestDto 등) import 후 변환 함수에서 사용

// 통합 타입 (내부 비즈니스용)
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
