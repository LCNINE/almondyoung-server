// shared/dtos/checkout-session.dto.ts

import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNotEmpty,
  IsUrl,
  IsOptional,
  IsObject,
  IsEnum,
} from 'class-validator';

/**
 * CheckoutSession 생성 요청 DTO
 */
export class CheckoutSessionCreateDto {
  @ApiProperty({
    description: '연결할 Payment Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  @IsString()
  @IsNotEmpty()
  intentId!: string;

  @ApiProperty({
    description: '결제 완료 후 리다이렉트할 URL (우리 호스트 결제 UI)',
    example: 'https://checkout.example.com/redirect',
  })
  @IsUrl()
  @IsNotEmpty()
  redirectUrl!: string;

  @ApiProperty({
    description: '결제 완료 후 복귀할 URL (최종 목적지)',
    example: 'https://example.com/payment/success',
  })
  @IsUrl()
  @IsNotEmpty()
  returnUrl!: string;

  @ApiProperty({
    description: '결제 취소 시 리다이렉트 URL',
    example: 'https://example.com/payment/cancel',
  })
  @IsUrl()
  @IsNotEmpty()
  cancelUrl!: string;

  @ApiProperty({
    description: '세션 메타데이터 (디바이스/언어 등)',
    example: {
      device: 'mobile',
      language: 'ko',
      userAgent: 'Mozilla/5.0...',
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  metadata?: Record<string, any>;
}

/**
 * CheckoutSession 응답 DTO
 */
export class CheckoutSessionResponseDto {
  @ApiProperty({
    description: 'CheckoutSession ID',
    example: 'cs_01HQZX8QJKMNPQRST9VWXY012',
  })
  sessionId!: string;

  @ApiProperty({
    description: '연결된 Payment Intent ID',
    example: 'pi_01HQZX8QJKMNPQRST9VWXY012',
  })
  intentId!: string;

  @ApiProperty({
    description: 'CheckoutSession 상태',
    enum: ['PENDING', 'COMPLETED', 'CANCELLED', 'EXPIRED'],
    example: 'PENDING',
  })
  status!: string;

  @ApiProperty({
    description: '결제창 URL (우리 호스트 결제 UI)',
    example: 'https://checkout.example.com/session/cs_xxx',
  })
  checkoutUrl!: string;

  @ApiProperty({
    description: '세션 생성 시간',
    example: '2024-01-15T10:00:00Z',
  })
  createdAt!: string;

  @ApiProperty({
    description: '세션 만료 시간',
    example: '2024-01-15T10:30:00Z',
  })
  expiresAt!: string;

  @ApiProperty({
    description: '세션 완료 시간 (완료된 경우)',
    example: '2024-01-15T10:05:00Z',
    required: false,
  })
  completedAt?: string;

  @ApiProperty({
    description: '세션 메타데이터',
    example: {
      device: 'mobile',
      language: 'ko',
    },
    required: false,
  })
  metadata?: Record<string, any>;
}

/**
 * PG사 콜백 처리 DTO
 */
export class CheckoutSessionCallbackDto {
  @ApiProperty({
    description: '결제 결과 상태',
    enum: ['SUCCESS', 'FAIL', 'CANCEL'],
    example: 'SUCCESS',
  })
  @IsEnum(['SUCCESS', 'FAIL', 'CANCEL'])
  status!: 'SUCCESS' | 'FAIL' | 'CANCEL';

  @ApiProperty({
    description: 'PG사 트랜잭션 ID',
    example: 'toss_txn_12345',
  })
  @IsString()
  @IsNotEmpty()
  pgTransactionId!: string;

  @ApiProperty({
    description: '결제 승인번호 (성공 시)',
    example: '12345678',
    required: false,
  })
  @IsOptional()
  @IsString()
  approvalNumber?: string;

  @ApiProperty({
    description: '실제 결제 금액 (성공 시)',
    example: 15000,
    required: false,
  })
  @IsOptional()
  actualAmount?: number;

  @ApiProperty({
    description: '실패 사유 (실패 시)',
    example: 'INSUFFICIENT_BALANCE',
    required: false,
  })
  @IsOptional()
  @IsString()
  failureReason?: string;

  @ApiProperty({
    description: 'PG사별 콜백 데이터',
    example: {
      paymentKey: 'payment_key_abcdef',
      orderId: 'order_12345',
      method: 'CARD',
    },
    required: false,
  })
  @IsOptional()
  @IsObject()
  pgData?: Record<string, any>;
}
