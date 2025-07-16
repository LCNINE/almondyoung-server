import { 
  IsBoolean, 
  IsOptional, 
  IsString, 
  MaxLength, 
  IsNumber, 
  IsPositive, 
  Min, 
  Max, 
  IsEmail, 
  IsPhoneNumber, 
  IsIn,
  IsNotEmpty,
  IsUrl
} from 'class-validator';
import { Type } from 'class-transformer';
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

// [내부 비즈니스용 DTO] BNPL 결제수단 생성 (Class 기반으로 변경)
export class CreateBnplPaymentMethodDto {
  @IsIn(['BNPL'])
  @IsNotEmpty()
  methodType: 'BNPL';

  @IsNumber()
  @IsPositive()
  @Type(() => Number)
  userId: number;



  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  methodName: string;

  @IsBoolean()
  @IsOptional()
  @Type(() => Boolean)
  isDefault?: boolean;

  @IsString()
  @IsNotEmpty()
  @MaxLength(32)
  institutionCode: string;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  creditLimit?: number;

  @IsNumber()
  @IsPositive()
  @IsOptional()
  @Type(() => Number)
  approvedLimit?: number;

  @IsNumber()
  @Min(1)
  @Max(31)
  @Type(() => Number)
  billingCycleDay: number;

  @IsUrl()
  @IsOptional()
  termsUrl?: string;

  // settlementPaymentMethodId 제거 - BNPL은 자체 완결형 결제수단

  @IsString()
  @IsOptional()
  @MaxLength(15)
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
