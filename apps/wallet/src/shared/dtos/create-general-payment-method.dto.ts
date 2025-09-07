// apps/wallet/src/shared/dtos/payment-methods/create-general-payment-method.dto.ts
import {
  IsBoolean,
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  ValidateNested,
  IsInt,
  Min,
  Max,
} from 'class-validator';
import { Type } from 'class-transformer';
import { PaymentMethodType } from '../types/payment-method.types';

export type PaymentUsage = 'PURCHASE' | 'SUBSCRIPTION';

export class CardInfoDto {
  @IsString()
  @IsNotEmpty()
  cardHolderName!: string;

  // 둘 중 하나는 필수: cardNumber 또는 paymentNumber
  @IsOptional()
  @Matches(/^\d{12,19}$/)
  cardNumber?: string;

  @IsOptional()
  @Matches(/^\d{12,19}$/)
  paymentNumber?: string;

  // MM/YY 형식
  @IsString()
  @Matches(/^\d{2}\/\d{2}$/)
  expiryDate!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  // 선택값(필수라면 테스트/요구사항에 맞춰 @IsNotEmpty 로 변경)
  @IsOptional()
  @IsString()
  @Matches(/^\d{6,10}$/) // 6~10자리 주민번호 앞/생년월일 등 가정
  birthDate?: string;

  @IsOptional()
  @IsString()
  cardPassword?: string;

  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(28)
  billingCycleDay?: number;
}

export class CreateGeneralPaymentMethodDto {
  @IsString()
  @IsNotEmpty()
  userId!: string;

  @IsEnum(PaymentMethodType)
  methodType!: PaymentMethodType;

  @IsString()
  @IsNotEmpty()
  methodName!: string;

  @IsOptional()
  @IsBoolean()
  isDefault?: boolean;

  @IsOptional()
  usage?: PaymentUsage; // 'PURCHASE' | 'SUBSCRIPTION'

  // 카드일 때만 필요
  @IsOptional()
  @ValidateNested()
  @Type(() => CardInfoDto)
  cardInfo?: CardInfoDto;
}

export interface PaymentMethodResponseDto {
  id: string;
  userId: string;
  methodType: PaymentMethodType;
  methodName?: string;
  status: 'PENDING' | 'ACTIVE' | 'INACTIVE';
  isDefault: boolean;
  paymentPurpose: PaymentUsage;
  // 카드 전용
  hmsMemberId?: string;
  maskedCardNumber?: string;
  lastFourDigits?: string;
}
