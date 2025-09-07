// shared/dtos/payment-response.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * 통합 결제 응답 DTO (문서 가이드라인 준수)
 * - 모든 결제 타입의 공통 응답
 */
export class PaymentResponseDto {
  @ApiProperty({
    description: '결제 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  paymentEventId!: string;

  @ApiProperty({
    description: '결제 세션 ID',
    example: 'ps_session_xyz789',
  })
  sessionId!: string; // ✅ 추가

  @ApiProperty({
    description: 'PG사 트랜잭션 ID (event_context에 포함됨)',
    example: 'pg_tx_12345',
  })
  pgTransactionId!: string;

  @ApiProperty({
    description: '결제 상태',
    example: 'CAPTURED',
  })
  status!: string;

  @ApiProperty({
    description: '결제 금액',
    example: 50000,
  })
  amount!: number;

  @ApiProperty({
    description: '통화 코드',
    example: 'KRW',
  })
  currency!: string;

  @ApiProperty({
    description: '결제 생성 시간',
    example: '2025-09-07T09:00:00.000Z',
  })
  createdAt!: string;
}

/**
 * 환불 응답 DTO (문서 가이드라인 준수)
 */
export class RefundResponseDto {
  @ApiProperty({
    description: '환불 이벤트 ID',
    example: 're_01HQZX8QJKMNPQRST9VWXY012',
  })
  refundEventId!: string;

  @ApiProperty({
    description: '원본 결제 이벤트 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  paymentEventId!: string;

  @ApiProperty({
    description: '환불 상태',
    enum: ['REQUESTED', 'APPROVED', 'COMPLETED', 'CANCELLED', 'FAILED'],
    example: 'COMPLETED',
  })
  status!: 'REQUESTED' | 'APPROVED' | 'COMPLETED' | 'CANCELLED' | 'FAILED';

  @ApiProperty({
    description: '환불 금액',
    example: 50000,
  })
  amount!: number;

  @ApiProperty({
    description: '처리 시각',
    example: '2025-01-15T10:30:00.000Z',
  })
  createdAt!: string;

  @ApiPropertyOptional({
    description: '환불 사유',
    example: '고객 요청',
  })
  reason?: string;

  @ApiPropertyOptional({
    description: '완료 시각 (완료된 경우)',
    example: '2025-01-15T10:35:00.000Z',
  })
  completedAt?: string;
}

/**
 * 결제수단 응답 DTO (문서 가이드라인 준수)
 */
export class PaymentMethodResponseDto {
  @ApiProperty({
    description: '결제수단 ID',
    example: 'pm_01HQZX8QJKMNPQRST9VWXY012',
  })
  id!: string;

  @ApiProperty({
    description: '사용자 ID',
    example: 'user_123456789',
  })
  userId!: string;

  @ApiProperty({
    description: '결제수단 타입',
    enum: ['CARD', 'BANK_ACCOUNT', 'BNPL', 'REWARD_POINT'],
    example: 'CARD',
  })
  methodType!: 'CARD' | 'BANK_ACCOUNT' | 'BNPL' | 'REWARD_POINT';

  @ApiProperty({
    description: '결제수단 별칭',
    example: '주 사용 카드',
  })
  methodName!: string;

  @ApiProperty({
    description: '결제수단 상태',
    enum: ['PENDING', 'ACTIVE', 'INACTIVE'],
    example: 'ACTIVE',
  })
  status!: 'PENDING' | 'ACTIVE' | 'INACTIVE';

  @ApiProperty({
    description: '기본 결제수단 여부',
    example: false,
  })
  isDefault!: boolean;

  @ApiProperty({
    description: '등록일시',
    example: '2025-01-15T10:30:00.000Z',
  })
  createdAt!: string;

  @ApiPropertyOptional({
    description: '마스킹된 정보',
    example: '**** **** **** 1234',
  })
  maskedInfo?: string;
}
