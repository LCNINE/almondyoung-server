// shared/dtos/refund-request.dto.ts
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, IsNumber, IsOptional, IsObject, Min } from 'class-validator';

/**
 * 환불 요청 DTO (문서 가이드라인 준수)
 * - 모든 환불 타입을 처리하는 단일 DTO
 */
export class RefundRequestDto {
  @ApiProperty({
    description: '환불할 결제 이벤트 ID 또는 세션 ID',
    example: 'pe_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  paymentEventId!: string;

  @ApiProperty({
    description: '환불 요청 금액',
    example: 50000,
    minimum: 1,
  })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiPropertyOptional({
    description: '환불 사유',
    example: '고객 요청',
  })
  @IsOptional()
  @IsString()
  reason?: string;

  @ApiPropertyOptional({
    description: '환불 계좌 ID (계좌 환불용)',
    example: 'ra_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsOptional()
  @IsString()
  refundAccountId?: string;

  @ApiPropertyOptional({
    description: '추가 메타데이터',
    example: {
      orderId: 'order_123',
      returnId: 'return_456',
      approvedBy: 'admin_user',
      approvedAt: '2024-01-15T10:30:00.000Z',
    },
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}
