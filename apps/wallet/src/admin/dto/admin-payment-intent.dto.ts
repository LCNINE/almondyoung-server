import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { Transform } from 'class-transformer';
import { PaginationQueryDto } from '@app/shared';
import { PaymentIntentStatus } from '../../schema';
import { PaymentIntentItemResponseDto, OrderDiscountResponseDto } from '../../payment-intents/dto';
import { RefundResponseDto } from '../../refunds/dto';

// ─── List Query ──────────────────────────────────────────────────────────────

export class AdminPaymentIntentListQueryDto extends PaginationQueryDto {
  @ApiPropertyOptional({
    description: 'Filter by status (multi-value)',
    isArray: true,
    type: String,
  })
  @IsOptional()
  @IsString({ each: true })
  @Transform(({ value }) => (Array.isArray(value) ? value : [value]))
  status?: string[];

  @ApiPropertyOptional({ description: 'Filter by user ID' })
  @IsOptional()
  @IsString()
  userId?: string;

  @ApiPropertyOptional({
    description: 'Filter by payment method type (e.g. TOSS, POINTS, BANK_TRANSFER)',
  })
  @IsOptional()
  @IsString()
  paymentMethodType?: string;

  @ApiPropertyOptional({ description: 'Date range start (ISO date)' })
  @IsOptional()
  @IsString()
  dateFrom?: string;

  @ApiPropertyOptional({ description: 'Date range end (ISO date)' })
  @IsOptional()
  @IsString()
  dateTo?: string;

  @ApiPropertyOptional({
    description: 'Sort field',
    enum: ['createdAt', 'payableAmount'],
    default: 'createdAt',
  })
  @IsOptional()
  @IsEnum(['createdAt', 'payableAmount'])
  sort?: 'createdAt' | 'payableAmount';

  @ApiPropertyOptional({
    description: 'Sort order',
    enum: ['asc', 'desc'],
    default: 'desc',
  })
  @IsOptional()
  @IsEnum(['asc', 'desc'])
  order?: 'asc' | 'desc';
}

// ─── List Item ───────────────────────────────────────────────────────────────

export class AdminPaymentIntentListItemDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  payableAmount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  status: PaymentIntentStatus;

  @ApiPropertyOptional({
    description: '운영 UI용 파생 상태. 환불이 있으면 REFUNDED/PARTIALLY_REFUNDED/REFUND_PENDING/REFUND_FAILED 등으로 표시한다.',
  })
  displayStatus?: string;

  @ApiPropertyOptional()
  refundedAmount?: number;

  @ApiPropertyOptional()
  userId: string | null;

  @ApiPropertyOptional({ description: 'Payment method type from the AUTHORIZE charge' })
  paymentMethodType: string | null;

  @ApiProperty()
  createdAt: Date;
}

// ─── Detail ──────────────────────────────────────────────────────────────────

export class AdminChargeResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  intentId: string;

  @ApiProperty()
  paymentMethodId: string;

  @ApiProperty()
  amount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty({ description: 'AUTHORIZE, CAPTURE, CANCEL, REFUND' })
  operation: string;

  @ApiProperty()
  status: string;

  @ApiPropertyOptional()
  providerTransactionId: string | null;

  @ApiPropertyOptional()
  errorCode: string | null;

  @ApiPropertyOptional()
  errorMessage: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class AdminPaymentMethodSummaryDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  userId: string;

  @ApiProperty()
  type: string;

  @ApiPropertyOptional()
  displayName: string | null;

  @ApiProperty()
  createdAt: Date;
}

export class AdminPaymentIntentDetailResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  payableAmount: number;

  @ApiProperty()
  currency: string;

  @ApiProperty()
  status: PaymentIntentStatus;

  @ApiPropertyOptional({
    description: '운영 UI용 파생 상태. 환불이 있으면 REFUNDED/PARTIALLY_REFUNDED/REFUND_PENDING/REFUND_FAILED 등으로 표시한다.',
  })
  displayStatus?: string;

  @ApiPropertyOptional()
  refundedAmount?: number;

  @ApiPropertyOptional()
  userId: string | null;

  @ApiPropertyOptional()
  paymentMethodId: string | null;

  @ApiProperty()
  clientSecret: string;

  @ApiPropertyOptional()
  returnUrl: string | null;

  @ApiProperty()
  metadata: Record<string, unknown>;

  @ApiProperty()
  expiresAt: Date;

  @ApiProperty()
  createdAt: Date;

  @ApiProperty()
  updatedAt: Date;

  @ApiProperty({ type: [PaymentIntentItemResponseDto] })
  items: PaymentIntentItemResponseDto[];

  @ApiProperty({ type: [OrderDiscountResponseDto] })
  orderDiscounts: OrderDiscountResponseDto[];

  @ApiProperty({ type: [AdminChargeResponseDto] })
  charges: AdminChargeResponseDto[];

  @ApiProperty({ type: [RefundResponseDto] })
  refunds: RefundResponseDto[];

  @ApiPropertyOptional({ type: AdminPaymentMethodSummaryDto })
  paymentMethod: AdminPaymentMethodSummaryDto | null;
}
