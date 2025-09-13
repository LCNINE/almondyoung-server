// shared/dtos/payment-request.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsObject,
  IsBoolean,
  Min,
  Max,
  IsPositive,
  ValidateNested,
  IsInt,
} from 'class-validator';
import { Type } from 'class-transformer';
import { maskAccountNumber } from '../utils/masking.util';

/**
 * 가격 스냅샷 DTO (문서 가이드라인 준수)
 * - 저장 전용, 계산/검증하지 않음
 */
export class PricingSnapshotDto {
  @ApiPropertyOptional({
    description: '원가 (할인 전)',
    example: 60000,
  })
  @IsOptional()
  @IsNumber()
  originalAmount?: number;

  @ApiPropertyOptional({
    description: '할인 금액',
    example: 10000,
  })
  @IsOptional()
  @IsNumber()
  discountAmount?: number;

  @ApiPropertyOptional({
    description: '최종 금액 (결제 금액과 동일해야 함)',
    example: 50000,
  })
  @IsOptional()
  @IsNumber()
  finalAmount?: number;

  @ApiPropertyOptional({
    description: '쿠폰 ID',
    example: 'CPN-123',
  })
  @IsOptional()
  @IsString()
  couponId?: string;

  @ApiPropertyOptional({
    description: '할인율 (%)',
    example: 16.67,
  })
  @IsOptional()
  @IsNumber()
  discountRate?: number;
}

/**
 * 통합 결제 요청 DTO (문서 가이드라인 준수)
 * - 일반결제, 정기결제, 멤버십결제, BNPL 모두 처리
 * - 조건 필드로 변형을 흡수
 */
export class PaymentRequestDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_123456789',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  paymentMethodId!: string;

  @ApiProperty({
    description: '결제 금액 (최종, 원)',
    example: 50000,
    minimum: 100,
    maximum: 10_000_000,
  })
  @IsNumber({ allowNaN: false, maxDecimalPlaces: 0 })
  @IsPositive()
  @Min(100)
  @Max(10_000_000)
  amount!: number;

  @ApiPropertyOptional({
    description: '통화 코드',
    example: 'KRW',
    default: 'KRW',
  })
  @IsOptional()
  @IsString()
  currency?: string;

  @ApiPropertyOptional({
    description: '결제 세션 ID (일반 결제용)',
    example: 'ps_session_xyz789',
  })
  @IsOptional()
  @IsString()
  sessionId?: string;

  @ApiPropertyOptional({
    description: '정기결제 여부',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isRecurring?: boolean;

  @ApiPropertyOptional({
    description: '멤버십 결제 여부',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isMembership?: boolean;

  @ApiPropertyOptional({
    description: 'BNPL 배치 결제 여부',
    example: false,
    default: false,
  })
  @IsOptional()
  @IsBoolean()
  isBnplBatch?: boolean;

  @ApiPropertyOptional({
    description: '가격/할인 스냅샷 (저장 전용)',
    type: () => PricingSnapshotDto,
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PricingSnapshotDto)
  pricingSnapshot?: PricingSnapshotDto;

  @ApiPropertyOptional({
    description: '불투명 메타데이터 (저장 전용)',
    example: {
      paymentPurpose: 'SUBSCRIPTION',
      source: 'scheduler',
      hmsMemberId: 'HMS-9999',
      billingCycle: 'MONTHLY',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class CreatePaymentIntentDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '결제 금액(원)',
    example: 50_000,
    minimum: 100,
    maximum: 10_000_000,
  })
  @IsInt()
  @IsPositive()
  @Min(100)
  @Max(10_000_000)
  amount!: number;

  @ApiProperty({
    description: '결제 의도 타입',
    enum: maskAccountNumber(paymentIntentTypeEnum.enumValues),
    example: 'ORDER',
  })
  @IsEnum(maskAccountNumber(paymentIntentTypeEnum.enumValues))
  type!: PaymentIntentType;

  @ApiProperty({
    description: '세션 만료까지(분) - 미지정 시 기본 30분',
    example: 30,
    required: false,
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(24 * 60)
  sessionExpiryMinutes?: number;

  @ApiProperty({
    description: '외부 도메인 맥락(주문번호 등) - JSON 문자열',
    required: false,
    example: '{"orderId":"ord_123"}',
  })
  @IsOptional()
  @IsString()
  metadata?: string;
}
