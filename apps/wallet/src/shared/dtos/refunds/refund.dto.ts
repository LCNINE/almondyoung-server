// shared/dtos/refunds/refund-v2.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsObject, Min } from 'class-validator';

/**
 * 환불 요청 DTO (외부 MSA에서 호출)
 */
export class RefundRequestDto {
  @ApiProperty({
    example: 'ps_session_xyz789',
    description: '환불할 결제 세션 ID',
  })
  @IsString()
  paymentSessionId!: string;

  @ApiProperty({
    example: 50000,
    description: '환불 요청 금액',
  })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({
    example: '고객 요청',
    description: '환불 사유 (선택적)',
    required: false,
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiProperty({
    example: { orderId: 'order_123', returnId: 'return_456' },
    description: '추가 메타데이터 (선택적)',
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;

  @ApiProperty({
    example: {
      orderId: 'order_123',
      orderLineIds: ['line_1', 'line_2'],
      approvedBy: 'admin_user',
      approvedAt: '2024-01-15T10:30:00.000Z',
    },
    description: '외부 승인 정보 (선택적)',
    required: false,
  })
  @IsOptional()
  @IsObject()
  approvalInfo?: {
    orderId: string;
    orderLineIds: string[];
    approvedBy: string;
    approvedAt: string;
  };
}

/**
 * 환불 승인 DTO (외부 MSA에서 호출)
 */
export class RefundApprovalDto {
  @ApiProperty({
    example: {
      orderId: 'order_123',
      orderLineIds: ['line_1', 'line_2'],
      approvedBy: 'admin_user',
      approvedAt: '2024-01-15T10:30:00.000Z',
      finalAmount: 45000,
    },
    description: '외부 승인 정보',
  })
  @IsObject()
  approvalInfo!: {
    orderId: string;
    orderLineIds: string[];
    approvedBy: string;
    approvedAt: string;
    finalAmount: number;
  };
}

/**
 * 환불 취소 DTO
 */
export class RefundCancellationDto {
  @ApiProperty({
    example: '재고 부족으로 인한 환불 불가',
    description: '취소 사유',
  })
  @IsString()
  reason!: string;

  @ApiProperty({
    example: 'admin_user',
    description: '취소 처리자',
  })
  @IsString()
  cancelledBy!: string;
}

/**
 * 환불 응답 DTO
 */
export class RefundResponseDto {
  @ApiProperty({ example: 'refund_xyz789' })
  refundId!: string;

  @ApiProperty({ example: 'ps_session_xyz789' })
  paymentSessionId!: string;

  @ApiProperty({
    example: 'APPROVED',
    enum: ['REQUESTED', 'APPROVED', 'COMPLETED', 'CANCELLED', 'FAILED'],
  })
  status!: string;

  @ApiProperty({ example: 50000 })
  amount!: number;

  @ApiProperty({
    example: 75000,
    description: '누적 환불 금액 (이번 포함)',
  })
  totalRefundedAmount!: number;

  @ApiProperty({
    example: 25000,
    description: '남은 환불 가능 금액',
  })
  remainingRefundableAmount!: number;

  @ApiProperty({ example: '2024-01-15T10:00:00.000Z' })
  createdAt!: string;

  @ApiProperty({
    example: '2024-01-15T10:30:00.000Z',
    description: '처리 완료 시간 (선택적)',
    required: false,
  })
  processedAt?: string;

  @ApiProperty({
    example: { approvalInfo: {}, pointsRestored: 5000 },
    description: '추가 메타데이터 (선택적)',
    required: false,
  })
  metadata?: Record<string, any>;
}
