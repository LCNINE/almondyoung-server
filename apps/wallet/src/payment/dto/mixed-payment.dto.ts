import { Type } from 'class-transformer';
import {
  IsString,
  IsNotEmpty,
  IsArray,
  ValidateNested,
  IsNumber,
  IsEnum,
  IsOptional,
} from 'class-validator';

// 개별 결제 수단에 대한 정보를 담는 DTO
export class PaymentDetailDto {
  @IsEnum(['BNPL', 'REWARD_POINT'])
  @IsNotEmpty()
  methodType: 'BNPL' | 'REWARD_POINT';

  @IsNumber()
  amount: number;

  // BNPL 등 ID가 필요한 결제수단일 경우 전달
  @IsString()
  @IsOptional()
  paymentMethodId?: string;
}

// 혼합 결제 요청 DTO
export class ProcessMixedPaymentDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @IsString()
  @IsNotEmpty()
  userId: string; // 임시로 직접 받음 (추후 인증 Guard에서 처리)

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentDetailDto)
  payments: PaymentDetailDto[]; // 결제 정보를 배열로 받음
}