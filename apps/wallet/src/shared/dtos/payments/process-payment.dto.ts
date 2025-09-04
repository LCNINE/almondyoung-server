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
  @ApiProperty({ example: 'pm_card_abc123' })
  methodId!: string;

  @ApiProperty({ example: 'toss_charge_1234567890_abc123' })
  transactionId?: string;

  @ApiProperty({ example: 'auth_1234567890_def456' })
  authorizationId?: string;

  @ApiProperty({ example: 50000 })
  amount!: number;
}

export class ProcessPaymentResponseDto {
  @ApiProperty({ example: true })
  success!: boolean;

  @ApiProperty({ example: 'payment_xyz789' })
  paymentId!: string;

  @ApiProperty({ example: 'ps_session_xyz789' })
  sessionId!: string;

  @ApiProperty({ example: 100000 })
  totalAmount!: number;

  @ApiProperty({
    description: '결제 결과 상세',
    example: {
      immediate: [
        {
          methodId: 'pm_card_abc123',
          transactionId: 'toss_charge_1234567890_abc123',
          amount: 50000,
        },
      ],
      deferred: [
        {
          methodId: 'pm_bnpl_def456',
          authorizationId: 'auth_1234567890_def456',
          amount: 30000,
        },
      ],
      points: { amount: 20000, newBalance: 15000 },
    },
  })
  results!: {
    status?: string;
    authorizationIds?: string[];
    capturedIds?: string[];
    pointsTxId?: string;
    immediate?: PaymentResultDto[];
    deferred?: PaymentResultDto[];
    points?: { amount: number; newBalance: number };
  };

  @ApiProperty({ required: false })
  error?: string;
}
