import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsArray,
  ValidateNested,
  IsNumber,
  IsOptional,
  Min,
  ArrayMinSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/**
 * 혼합결제 내 개별 결제 정보
 */
export class MixedPaymentItemDto {
  @ApiProperty({
    example: 'pm_abc123',
    description: '결제수단 ID (포인트의 경우 "REWARD_POINT" 고정값 사용)',
  })
  @IsString()
  paymentMethodId!: string;

  @ApiProperty({ example: 10000, description: '결제 금액' })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({
    required: false,
    example: { priority: 1 },
    description: '개별 결제 메타데이터',
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * 혼합결제 요청 DTO
 */
export class MixedPaymentDto {
  @ApiProperty({ example: 'ps_abc123', description: '결제 세션 ID' })
  @IsString()
  sessionId!: string;

  @ApiProperty({
    type: [MixedPaymentItemDto],
    description: '혼합결제 항목들 (순차 처리됨)',
  })
  @IsArray()
  @ArrayMinSize(2, {
    message: '혼합결제는 최소 2개 이상의 결제수단이 필요합니다',
  })
  @ValidateNested({ each: true })
  @Type(() => MixedPaymentItemDto)
  payments!: MixedPaymentItemDto[];

  @ApiProperty({
    required: false,
    example: { orderId: 'ord_123' },
    description: '전체 혼합결제 메타데이터',
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

/**
 * 혼합결제 응답 DTO
 */
export interface MixedPaymentResponse {
  sessionId: string;
  totalAmount: number;
  status: 'COMPLETED' | 'FAILED' | 'PARTIAL_ROLLBACK';
  completedPayments: Array<{
    paymentId: string;
    paymentMethodId: string;
    amount: number;
    status: 'AUTHORIZED' | 'CAPTURED';
    pgTransactionId: string;
  }>;
  failedPayments?: Array<{
    paymentMethodId: string;
    amount: number;
    error: string;
  }>;
  rolledBackPayments?: Array<{
    paymentId: string;
    paymentMethodId: string;
    amount: number;
    refundTransactionId: string;
  }>;
  authorizedAt: Date;
  capturedAt?: Date;
  metadata: Record<string, any>;
}
