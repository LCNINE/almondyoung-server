// shared/dtos/payments/process-payment.dto.ts
import { ApiProperty } from '@nestjs/swagger';
import {
  IsString,
  IsNumber,
  IsOptional,
  IsArray,
  ValidateNested,
  Min,
} from 'class-validator';
import { Type } from 'class-transformer';

export class PaymentMethodRequestDto {
  @ApiProperty({
    example: 'pm_card_abc123',
    description: '결제수단 ID',
  })
  @IsString()
  paymentMethodId!: string;

  @ApiProperty({
    example: 50000,
    description: '해당 결제수단으로 결제할 금액',
  })
  @IsNumber()
  @Min(1)
  amount!: number;

  @ApiProperty({
    example: 'CARD',
    enum: ['CARD', 'EASY_PAY', 'BNPL', 'REWARD_POINT'],
    required: false,
  })
  @IsString()
  @IsOptional()
  type?: string;
}

export class ProcessPaymentDto {
  @ApiProperty({
    example: 'ps_session_xyz789',
    description: '결제 세션 ID',
  })
  @IsString()
  sessionId!: string;

  @ApiProperty({
    type: [PaymentMethodRequestDto],
    description: '결제수단 목록',
    example: [
      { paymentMethodId: 'pm_card_abc123', amount: 50000 },
      { paymentMethodId: 'pm_bnpl_def456', amount: 30000 },
    ],
  })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PaymentMethodRequestDto)
  paymentMethods!: PaymentMethodRequestDto[];

  @ApiProperty({
    example: 20000,
    description: '사용할 포인트 금액 (선택사항)',
    required: false,
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  usePoints?: number;

  @ApiProperty({ required: false, example: 'user_123' })
  @IsString()
  @IsOptional()
  userId?: string;

  @ApiProperty({ required: false, example: 'idem_key_123' })
  @IsString()
  @IsOptional()
  idemKey?: string;

  @ApiProperty({
    example: { orderName: '아몬드영 상품 결제', orderId: 'order_123' },
    description: '추가 메타데이터 (선택사항)',
    required: false,
  })
  @IsOptional()
  metadata?: Record<string, any>;
}

export class PaymentResultDto {
  @ApiProperty({
    example: 'CARD',
    description: '결제수단 타입 (CARD | BNPL | POINT)',
  })
  methodType: string;

  @ApiProperty({ example: 50000, description: '해당 결제수단으로 처리된 금액' })
  amount: number;

  @ApiProperty({
    example: 'AUTHORIZED',
    description: '결제 상태 (AUTHORIZED | CAPTURED | FAILED)',
  })
  status: string;

  @ApiProperty({
    example: ['auth_123'],
    description: '승인 ID 리스트 (BNPL 등)',
    required: false,
  })
  authorizationIds?: string[];

  @ApiProperty({
    example: ['cap_456'],
    description: '출금/캡쳐 ID 리스트',
    required: false,
  })
  captureIds?: string[];

  @ApiProperty({
    example: 'txn_789',
    description: '포인트 트랜잭션 ID',
    required: false,
  })
  transactionId?: string;
}
export class ProcessPaymentResponseDto {
  @ApiProperty({ example: true })
  success: boolean;

  @ApiProperty({ example: 'pay_abc123' })
  paymentId: string;

  @ApiProperty({ example: 'sess_abc123' })
  sessionId: string;

  @ApiProperty({ example: 120000 })
  totalAmount: number;

  @ApiProperty({ type: [PaymentResultDto] })
  results: PaymentResultDto[];
}
