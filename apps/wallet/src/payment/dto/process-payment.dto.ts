// src/payment/dto/process-payment.dto.ts (혼합 결제 지원)

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
  @IsEnum(['BNPL', 'REWARD_POINT']) // 사용 가능한 결제수단 타입
  @IsNotEmpty()
  methodType: 'BNPL' | 'REWARD_POINT';

  @IsNumber()
  amount: number;

  // BNPL 등 ID가 필요한 결제수단일 경우 전달
  @IsString()
  @IsOptional()
  paymentMethodId?: string; 
}

// 메인 결제 요청 DTO
export class ProcessPaymentDto {
  @IsString()
  @IsNotEmpty()
  invoiceId: string;

  @IsString()
  @IsNotEmpty()
  invoiceSessionId: string; // 청구서 세션 ID 필수 추가

  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentDetailDto)
  payments: PaymentDetailDto[]; // ✅ 결제 정보를 배열로 받음

  // 하위 호환성을 위한 기존 필드 (deprecated)
  @IsString()
  @IsOptional()
  paymentMethodId?: string; // 기존 단일 결제 지원
}
