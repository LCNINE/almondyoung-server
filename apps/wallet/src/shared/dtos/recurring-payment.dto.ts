import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsEnum,
  IsPositive,
  Min,
  Max,
  IsBoolean,
  IsObject,
  ValidateNested,
} from 'class-validator';
import { Type } from 'class-transformer';
import { RecurringPaymentErrorType } from '../errors/recurring-payment.errors';

/* ----------------------------- Enums ----------------------------- */

export enum SubscriptionType {
  MONTHLY = 'monthly',
  YEARLY = 'yearly',
}

export enum PaymentStatus {
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
}

export enum MethodType {
  CARD = 'CARD',
  BNPL = 'BNPL',
  REWARD_POINT = 'REWARD_POINT',
  UNKNOWN = 'UNKNOWN',
}

export enum PaymentPurpose {
  SUBSCRIPTION = 'SUBSCRIPTION',
  PURCHASE = 'PURCHASE',
  BOTH = 'BOTH',
}

/* -------------------- Nested DTO: Pricing Snapshot --------------------- */

export class PricingSnapshotDto {
  @ApiPropertyOptional({
    description: '원가(할인 전 금액)',
    example: 9900,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, maxDecimalPlaces: 0 })
  @Min(0)
  originalAmount?: number;

  @ApiPropertyOptional({
    description: '할인 금액',
    example: 1000,
    minimum: 0,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, maxDecimalPlaces: 0 })
  @Min(0)
  discountAmount?: number;

  @ApiPropertyOptional({
    description: '쿠폰 ID',
    example: 'DISCOUNT10',
  })
  @IsOptional()
  @IsString()
  couponId?: string;

  @ApiPropertyOptional({
    description: '할인율(%)',
    example: 10,
    minimum: 0,
    maximum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, maxDecimalPlaces: 2 })
  @Min(0)
  @Max(100)
  discountRate?: number;
}

/* -------------------------- Request DTOs -------------------------- */

/**
 * 순수 결제 요청 DTO (v2)
 * - 결제 서버는 최종 금액만 처리
 * - 구독 도메인 정보는 metadata로 불투명하게 전달
 * - 할인/원가 등은 pricing 스냅샷으로만 전달(계산/검증하지 않음)
 */
export class RecurringPaymentRequestDto {
  @ApiProperty({ description: '사용자 ID', example: 'user_123456789' })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  paymentMethodId!: string;

  @ApiProperty({
    description: '결제 금액(최종, 원)',
    example: 9900,
    minimum: 100,
    maximum: 10_000_000,
  })
  @Type(() => Number)
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
    description: '가격/할인 스냅샷(저장 전용, 계산/검증 안함)',
    type: () => PricingSnapshotDto,
    example: {
      originalAmount: 9900,
      discountAmount: 1000,
      couponId: 'DISCOUNT10',
    },
  })
  @IsOptional()
  @ValidateNested()
  @Type(() => PricingSnapshotDto)
  pricing?: PricingSnapshotDto;

  @ApiPropertyOptional({
    description: '불투명 메타데이터(저장 전용) - 구독 정보 등 포함',
    example: {
      subscriptionType: 'monthly',
      billingCycle: 30,
      correlationId: 'sub-run-2025-01-15T12:00:00Z-123',
      source: 'membership-scheduler',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/* -------------------------- Response DTOs -------------------------- */

/**
 * 구독 결제 응답 DTO
 */
export class RecurringPaymentResponseDto {
  @ApiProperty({ description: '결제 성공 여부', example: true })
  success!: boolean;

  @ApiProperty({
    description: '트랜잭션 ID',
    example: 'txn_01HQZX8QJKMNPQRST9VWXY012',
  })
  transactionId!: string;

  @ApiProperty({
    description: '결제 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  paymentEventId!: string;

  @ApiProperty({
    description: '결제 상태',
    example: PaymentStatus.CAPTURED,
    enum: PaymentStatus,
  })
  status!: PaymentStatus;

  @ApiProperty({ description: '결제 금액', example: 9900 })
  amount!: number;

  @ApiProperty({
    description: '처리 완료 시간',
    example: '2024-01-15T10:30:00.000Z',
    type: String,
  })
  processedAt!: Date;

  @ApiPropertyOptional({
    description: '게이트웨이 응답 데이터',
    example: { approvalNumber: 'APPR123456', paymentDate: '20240115' },
  })
  gatewayResponse?: Record<string, any>;

  @ApiPropertyOptional({
    description: '에러 메시지(실패 시)',
    example: '잔액이 부족합니다',
  })
  error?: string;
}

/* ---------------- Payment Method Validation DTOs ---------------- */

export class PaymentMethodValidationRequestDto {
  @ApiProperty({
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  paymentMethodId!: string;

  @ApiProperty({ description: '사용자 ID', example: 'user_123456789' })
  @IsString()
  userId!: string;

  @ApiPropertyOptional({
    description: '결제수단 타입',
    example: MethodType.CARD,
    enum: MethodType,
  })
  @IsOptional()
  @IsEnum(MethodType)
  methodType?: MethodType;

  @ApiPropertyOptional({
    description: '예상 결제 금액(원) - BNPL 한도 검증용',
    example: 9900,
    minimum: 100,
  })
  @IsOptional()
  @Type(() => Number)
  @IsNumber({ allowNaN: false, maxDecimalPlaces: 0 })
  @Min(100)
  expectedAmount?: number;

  @ApiPropertyOptional({
    description: '상세 검증 수행 여부(HMS 상태, BNPL 한도 등)',
    example: true,
    default: true,
  })
  @IsOptional()
  @IsBoolean()
  performDetailedValidation?: boolean;
}

export class PaymentMethodValidationResponseDto {
  @ApiProperty({ description: '검증 결과', example: true })
  isValid!: boolean;

  @ApiProperty({
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  paymentMethodId!: string;

  @ApiProperty({
    description: '결제수단 타입',
    example: MethodType.CARD,
    enum: MethodType,
  })
  methodType!: MethodType;

  @ApiProperty({
    description: '결제수단 상태',
    example: 'ACTIVE',
    enum: ['ACTIVE', 'INACTIVE', 'SUSPENDED', 'UNKNOWN'],
  })
  status!: 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'UNKNOWN';

  @ApiProperty({
    description: '결제 용도',
    example: PaymentPurpose.SUBSCRIPTION,
    enum: PaymentPurpose,
  })
  paymentPurpose!: PaymentPurpose;

  @ApiPropertyOptional({
    description: 'HMS 회원 ID(카드 결제수단인 경우)',
    example: 'HMS_123456789',
  })
  hmsMemberId?: string;

  @ApiPropertyOptional({
    description: '에러 메시지(검증 실패 시)',
    example: '구독 결제가 허용되지 않은 결제수단입니다',
  })
  error?: string;

  @ApiPropertyOptional({
    description: '에러 타입(검증 실패 시)',
    enum: RecurringPaymentErrorType,
    example: RecurringPaymentErrorType.PAYMENT_METHOD_INVALID_PURPOSE,
  })
  errorType?: RecurringPaymentErrorType;

  @ApiPropertyOptional({
    description: '재시도 가능 여부(검증 실패 시)',
    example: false,
  })
  retryable?: boolean;

  @ApiPropertyOptional({
    description: '검증 상세 정보',
    example: {
      hmsStatus: '신청완료',
      lastValidated: '2024-01-15T10:30:00.000Z',
    },
  })
  validationDetails?: Record<string, any>;
}

/* ----------------------- Payment Status DTO ---------------------- */

export class PaymentStatusResponseDto {
  @ApiProperty({
    description: '트랜잭션 ID',
    example: 'txn_01HQZX8QJKMNPQRST9VWXY012',
  })
  transactionId!: string;

  @ApiProperty({
    description: '결제 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  paymentEventId!: string;

  @ApiProperty({
    description: '결제 상태',
    example: PaymentStatus.CAPTURED,
    enum: PaymentStatus,
  })
  status!: PaymentStatus;

  @ApiProperty({ description: '결제 금액', example: 9900 })
  amount!: number;

  @ApiProperty({ description: '통화 코드', example: 'KRW' })
  currency!: string;

  @ApiProperty({
    description: '처리 완료 시간',
    example: '2024-01-15T10:30:00.000Z',
    type: String,
  })
  processedAt!: Date;

  @ApiProperty({ description: '구독 결제 여부', example: true })
  isSubscriptionPayment!: boolean;

  @ApiPropertyOptional({
    description: '구독 타입',
    example: SubscriptionType.MONTHLY,
  })
  @IsOptional()
  @IsEnum(SubscriptionType)
  subscriptionType?: SubscriptionType;

  @ApiProperty({
    description: '결제 용도',
    example: PaymentPurpose.SUBSCRIPTION,
    enum: PaymentPurpose,
  })
  paymentPurpose!: PaymentPurpose;

  @ApiPropertyOptional({
    description: '게이트웨이 응답 데이터',
    example: { approvalNumber: 'APPR123456', paymentDate: '20240115' },
  })
  gatewayResponse?: Record<string, any>;
}
