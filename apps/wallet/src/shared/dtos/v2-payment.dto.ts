// v2-payment.dto.ts - v4 아키텍처 통합 DTO (응집도 높은 구조)
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsPositive,
  IsOptional,
  IsArray,
  IsEnum,
  IsDateString,
  IsObject,
  Min,
  Max,
  ValidateIf,
} from 'class-validator';
import {
  PaymentIntentType,
  PaymentProvider,
  PAYMENT_INTENT_TYPE,
  PAYMENT_PROVIDER,
} from '../database/schema';

// ================================================================
// Intent 관련 DTO들
// ================================================================

export class IntentCreateDto {
  @ApiProperty({
    description: '사용자 ID',
    example: 'user_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  userId!: string;

  @ApiProperty({
    description: '결제 금액 (최종 과금액, 원)',
    example: 50000,
    minimum: 100,
    maximum: 10000000,
  })
  @IsNumber({ allowNaN: false, maxDecimalPlaces: 0 })
  @IsPositive()
  @Min(100)
  @Max(10000000)
  amount!: number;

  @ApiProperty({
    description: '결제 타입 (맥락)',
    enum: PAYMENT_INTENT_TYPE,
    example: 'ORDER',
  })
  @IsEnum(PAYMENT_INTENT_TYPE)
  type!: PaymentIntentType;

  @ApiPropertyOptional({
    description: '허용된 Provider 목록 (없으면 타입별 기본값 적용)',
    enum: PAYMENT_PROVIDER,
    isArray: true,
    example: ['TOSS', 'KAKAOPAY', 'BNPL', 'POINTS'],
  })
  @IsOptional()
  @IsArray()
  @IsEnum(PAYMENT_PROVIDER, { each: true })
  allowedProviders?: PaymentProvider[];

  @ApiPropertyOptional({
    description: '만료 시각 (ISO 8601 형식)',
    example: '2025-01-08T15:30:00Z',
  })
  @IsOptional()
  @IsDateString()
  expiresAt?: string;

  @ApiPropertyOptional({
    description: '불투명 메타데이터 (저장 전용)',
    example: {
      orderId: 'order_123',
      productName: '프리미엄 멤버십',
      source: 'web',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class IntentResponseDto {
  @ApiProperty({
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Intent 상태',
    example: 'PENDING',
  })
  status!: string;

  @ApiProperty({
    description: '결제 금액 (KRW)',
    example: 50000,
  })
  amount!: number;

  @ApiProperty({
    description: '결제 타입',
    example: 'ORDER',
  })
  type!: string;

  @ApiProperty({
    description: '생성 시각',
    example: '2025-01-08T10:30:00Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '만료 시각',
    example: '2025-01-08T11:00:00Z',
  })
  expiresAt!: string;

  @ApiPropertyOptional({
    description: '허용된 Provider 목록',
    example: ['TOSS', 'KAKAOPAY', 'BNPL', 'POINTS'],
  })
  allowedProviders?: string[];

  @ApiPropertyOptional({
    description: '환불된 금액',
    example: 0,
  })
  refundedAmount?: number;
}

// ================================================================
// Attempt 관련 DTO들
// ================================================================

export class AttemptCreateDto {
  @ApiProperty({
    description: '결제 Provider',
    enum: PAYMENT_PROVIDER,
    example: 'TOSS',
  })
  @IsEnum(PAYMENT_PROVIDER)
  provider!: PaymentProvider;

  @ApiPropertyOptional({
    description: '저장형 결제수단 ID (저장형일 때만)',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.instrumentRef === undefined)
  profileId?: string;

  @ApiPropertyOptional({
    description: 'Ephemeral 승인키/토큰 (일시형일 때만)',
    example: 'kakao_approval_key_xyz789',
  })
  @IsOptional()
  @IsString()
  @ValidateIf((o) => o.profileId === undefined)
  instrumentRef?: string;

  @ApiPropertyOptional({
    description: '멱등성 키',
    example: 'idem_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;

  @ApiPropertyOptional({
    description: '요청 소스',
    enum: ['api', 'scheduler', 'admin'],
    example: 'api',
    default: 'api',
  })
  @IsOptional()
  @IsEnum(['api', 'scheduler', 'admin'])
  source?: 'api' | 'scheduler' | 'admin' = 'api';

  @ApiPropertyOptional({
    description: '실행 주체',
    enum: ['USER', 'SYSTEM', 'SCHEDULER', 'ADMIN'],
    example: 'USER',
    default: 'USER',
  })
  @IsOptional()
  @IsEnum(['USER', 'SYSTEM', 'SCHEDULER', 'ADMIN'])
  actor?: 'USER' | 'SYSTEM' | 'SCHEDULER' | 'ADMIN' = 'USER';
}

export class AttemptFinalizeDto {
  @ApiPropertyOptional({
    description: '승인키 (카카오페이 등)',
    example: 'kakao_approval_key_xyz789',
  })
  @IsOptional()
  @IsString()
  approvalKey?: string;

  @ApiPropertyOptional({
    description: 'PG 토큰',
    example: 'pg_token_abc123',
  })
  @IsOptional()
  @IsString()
  pgToken?: string;

  @ApiPropertyOptional({
    description: '멱등성 키',
    example: 'idem_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsOptional()
  @IsString()
  idempotencyKey?: string;
}

export class AttemptResponseDto {
  @ApiProperty({
    description: 'Attempt ID',
    example: 'pa_01HQZX8QJKMNPQRST9VWXY012',
  })
  attemptId!: string;

  @ApiProperty({
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  intentId!: string;

  @ApiProperty({
    description: 'Provider',
    example: 'TOSS',
  })
  provider!: string;

  @ApiProperty({
    description: 'Attempt 상태',
    example: 'CAPTURED',
  })
  status!: string;

  @ApiProperty({
    description: '결제 금액',
    example: 50000,
  })
  amount!: number;

  @ApiProperty({
    description: '생성 시각',
    example: '2025-01-08T10:35:00Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '실행 주체',
    example: 'USER',
  })
  actor!: string;

  @ApiPropertyOptional({
    description: '에러 메시지 (실패 시)',
    example: '잔액 부족',
  })
  errorMessage?: string;

  @ApiPropertyOptional({
    description: '수단 종류',
    example: 'stored',
  })
  instrumentKind?: string;

  @ApiPropertyOptional({
    description: 'PG 트랜잭션 ID',
    example: 'toss_txn_abc123',
  })
  transactionId?: string;

  @ApiPropertyOptional({
    description: '승인 번호',
    example: '12345678',
  })
  approvalNumber?: string;
}

// ================================================================
// Refund 관련 DTO들
// ================================================================

export class RefundCreateDto {
  @ApiProperty({
    description: '원본 결제 Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  intentId!: string;

  @ApiPropertyOptional({
    description: '특정 Attempt ID (지정 시 정확한 환불 매핑)',
    example: 'pa_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsOptional()
  @IsString()
  attemptId?: string;

  @ApiPropertyOptional({
    description: '환불 금액 (없으면 전액 환불)',
    example: 25000,
    minimum: 100,
  })
  @IsOptional()
  @IsNumber({ allowNaN: false, maxDecimalPlaces: 0 })
  @IsPositive()
  @Min(100)
  amount?: number;

  @ApiPropertyOptional({
    description: '환불 사유',
    example: 'customer_request',
    enum: [
      'customer_request',
      'order_cancelled',
      'product_defect',
      'system_error',
    ],
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: '환불 관련 메타데이터',
    example: {
      requestedBy: 'admin_user',
      originalOrderId: 'order_123',
      refundReason: '고객 요청에 의한 환불',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

export class RefundResponseDto {
  @ApiProperty({
    description: 'Refund ID',
    example: 'rf_01HQZX8QJKMNPQRST9VWXY012',
  })
  refundId!: string;

  @ApiProperty({
    description: '원본 Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  intentId!: string;

  @ApiProperty({
    description: '환불 금액',
    example: 25000,
  })
  amount!: number;

  @ApiProperty({
    description: '환불 상태 (COMPLETED는 환불 도메인 전용)',
    example: 'REQUESTED',
  })
  status!: string;

  @ApiProperty({
    description: '생성 시각',
    example: '2025-01-08T10:40:00Z',
  })
  createdAt!: string;

  @ApiPropertyOptional({
    description: '환불 사유',
    example: 'customer_request',
  })
  reason?: string;

  @ApiPropertyOptional({
    description: '연결된 Attempt ID',
    example: 'pa_01HQZX8QJKMNPQRST9VWXY012',
  })
  attemptId?: string;

  @ApiPropertyOptional({
    description: '완료 시각 (환불 완료 시)',
    example: '2025-01-08T10:45:00Z',
  })
  completedAt?: string;
}

// ================================================================
// Checkout Session 관련 DTO들 (웹 결제용)
// ================================================================

export class CheckoutSessionCreateDto {
  @ApiProperty({
    description: 'Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  intentId!: string;

  @ApiProperty({
    description: 'Provider (웹 리다이렉트 지원하는 것만)',
    enum: ['KAKAOPAY', 'TOSS'],
    example: 'KAKAOPAY',
  })
  @IsEnum(['KAKAOPAY', 'TOSS'])
  provider!: 'KAKAOPAY' | 'TOSS';

  @ApiProperty({
    description: '성공 시 리다이렉트 URL',
    example: 'https://example.com/payment/success',
  })
  @IsString()
  successUrl!: string;

  @ApiProperty({
    description: '실패 시 리다이렉트 URL',
    example: 'https://example.com/payment/fail',
  })
  @IsString()
  failUrl!: string;

  @ApiPropertyOptional({
    description: '취소 시 리다이렉트 URL',
    example: 'https://example.com/payment/cancel',
  })
  @IsOptional()
  @IsString()
  cancelUrl?: string;
}

export class CheckoutSessionResponseDto {
  @ApiProperty({
    description: 'Checkout Session ID',
    example: 'cs_01HQZX8QJKMNPQRST9VWXY012',
  })
  sessionId!: string;

  @ApiProperty({
    description: '리다이렉트할 결제 URL',
    example: 'https://online-pay.kakao.com/mockup/v1/...',
  })
  redirectUrl!: string;

  @ApiProperty({
    description: '만료 시각',
    example: '2025-01-08T11:00:00Z',
  })
  expiresAt!: string;
}
