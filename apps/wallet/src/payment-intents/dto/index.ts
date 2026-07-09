import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUrl,
  MaxLength,
  Min,
  ValidateNested,
  IsArray,
} from 'class-validator';
import { RefundResponseDto } from '../../refunds/dto';
import { Type } from 'class-transformer';
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PaymentIntentStatus } from '../../schema';

// ─── Create Intent ────────────────────────────────────────────────────────────

export class ItemDiscountDto {
  @ApiProperty({ enum: ['ITEM_PER_UNIT', 'ITEM_FLAT'] })
  @IsEnum(['ITEM_PER_UNIT', 'ITEM_FLAT'])
  kind: 'ITEM_PER_UNIT' | 'ITEM_FLAT';

  @ApiProperty({ description: 'Discount amount (positive integer)', minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  discountRefId?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class ItemDto {
  @ApiProperty({ maxLength: 128 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  lineId: string;

  @ApiProperty({ maxLength: 255 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(255)
  name: string;

  @ApiPropertyOptional({ enum: ['PRODUCT', 'SUBSCRIPTION', 'SHIPPING_FEE', 'OTHER'] })
  @IsOptional()
  @IsEnum(['PRODUCT', 'SUBSCRIPTION', 'SHIPPING_FEE', 'OTHER'])
  itemType?: 'PRODUCT' | 'SUBSCRIPTION' | 'SHIPPING_FEE' | 'OTHER';

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  itemRefId?: string;

  @ApiProperty({ description: 'Unit price in smallest currency unit (e.g. KRW)', minimum: 0 })
  @IsInt()
  @Min(0)
  unitPrice: number;

  @ApiProperty({ description: 'Quantity', minimum: 1 })
  @IsInt()
  @Min(1)
  quantity: number;

  @ApiPropertyOptional({ type: [ItemDiscountDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDiscountDto)
  discounts?: ItemDiscountDto[];
}

export class OrderDiscountDto {
  @ApiProperty({ enum: ['ORDER'] })
  @IsEnum(['ORDER'])
  kind: 'ORDER';

  @ApiProperty({ description: 'Discount amount (positive integer)', minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  discountRefId?: string;

  @ApiPropertyOptional({ maxLength: 255 })
  @IsOptional()
  @IsString()
  @MaxLength(255)
  name?: string;
}

export class CreatePaymentIntentDto {
  @ApiPropertyOptional({
    description: 'User ID (optional — first JWT-authenticated GET will claim the intent)',
    maxLength: 128,
  })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  userId?: string;

  @ApiProperty({ description: 'Currency code (e.g. KRW)', maxLength: 3 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(3)
  currency: string;

  @ApiPropertyOptional({ description: 'Total payable amount (required if items not provided)', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  amount?: number;

  @ApiPropertyOptional({ description: 'Return URL after payment', maxLength: 2048 })
  @IsOptional()
  @IsString()
  @MaxLength(2048)
  returnUrl?: string;

  @ApiPropertyOptional({ description: 'Line items (gateway calculates payable_amount if provided)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => ItemDto)
  items?: ItemDto[];

  @ApiPropertyOptional({ description: 'Order-level discounts (applied after item discounts)' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => OrderDiscountDto)
  orderDiscounts?: OrderDiscountDto[];

  @ApiPropertyOptional()
  @IsOptional()
  metadata?: Record<string, unknown>;
}

// ─── Confirm Intent ───────────────────────────────────────────────────────────

export class CashReceiptRequestDto {
  @ApiProperty({ description: '소득공제(개인) 또는 지출증빙(사업자)', enum: ['소득공제', '지출증빙'] })
  @IsEnum({ 소득공제: '소득공제', 지출증빙: '지출증빙' })
  type: '소득공제' | '지출증빙';

  @ApiProperty({ description: '소득공제: 휴대폰번호, 지출증빙: 사업자등록번호 (숫자만)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(30)
  customerIdentityNumber: string;
}

export class ConfirmPaymentIntentDto {
  @ApiPropertyOptional({
    description: 'Payment method ID to use for this payment (not required if pointsToApply covers the full amount)',
  })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  paymentMethodId?: string;

  @ApiPropertyOptional({ description: 'Amount of points to apply toward this payment', minimum: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  pointsToApply?: number;

  @ApiPropertyOptional({ description: '현금영수증 신청 정보 (무통장입금 시). 입금확인 완료 시 자동 발급.', type: CashReceiptRequestDto })
  @IsOptional()
  @ValidateNested()
  @Type(() => CashReceiptRequestDto)
  cashReceipt?: CashReceiptRequestDto;
}

// ─── Toss Approve ─────────────────────────────────────────────────────────────

export class TossApproveDto {
  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  paymentKey: string;

  @ApiProperty()
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;
}

// ─── NicePay Approve ──────────────────────────────────────────────────────────

export class NicepayApproveDto {
  @ApiProperty({ description: 'NicePay transaction ID (tid)' })
  @IsString()
  @IsNotEmpty()
  tid: string;

  @ApiProperty({ description: 'Merchant order ID (chargeId without dashes)' })
  @IsString()
  @IsNotEmpty()
  orderId: string;

  @ApiProperty({ minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiProperty({ description: 'Authentication token from NicePay' })
  @IsString()
  @IsNotEmpty()
  authToken: string;

  @ApiProperty({ description: 'NicePay client key (clientId)' })
  @IsString()
  @IsNotEmpty()
  clientId: string;

  @ApiProperty({ description: 'Tamper-check signature: hex(sha256(authToken+clientId+amount+secretKey))' })
  @IsString()
  @IsNotEmpty()
  signature: string;
}

// ─── Refund by Intent ─────────────────────────────────────────────────────────

export class RefundByIntentDto {
  @ApiProperty({ description: 'Amount to refund (positive integer)', minimum: 1 })
  @IsInt()
  @Min(1)
  amount: number;

  @ApiPropertyOptional({ maxLength: 128 })
  @IsOptional()
  @IsString()
  @MaxLength(128)
  reasonCode?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  reasonMessage?: string;

  @ApiPropertyOptional({
    description: '멤버십 결제 환불 차단을 우회 (admin 강제취소 예외 환불 전용). 일반/셀프 환불에서는 절대 설정 금지.',
  })
  @IsOptional()
  @IsBoolean()
  allowMembershipRefund?: boolean;
}

export class RefundByIntentResponseDto {
  @ApiProperty()
  intentId: string;

  @ApiProperty({ type: [RefundResponseDto] })
  refunds: RefundResponseDto[];
}

// ─── Response ─────────────────────────────────────────────────────────────────

export class ItemDiscountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  kind: string;

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional()
  name: string | null;

  @ApiPropertyOptional()
  discountRefId: string | null;
}

export class PaymentIntentItemResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  lineId: string;

  @ApiProperty()
  name: string;

  @ApiPropertyOptional()
  itemType: string | null;

  @ApiProperty()
  unitPrice: number;

  @ApiProperty()
  quantity: number;

  @ApiProperty()
  baseAmount: number;

  @ApiProperty()
  itemDiscountPerUnitTotal: number;

  @ApiProperty()
  itemDiscountFlatTotal: number;

  @ApiProperty()
  payableAmount: number;

  @ApiProperty({ type: [ItemDiscountResponseDto] })
  discounts: ItemDiscountResponseDto[];
}

export class OrderDiscountResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  kind: string;

  @ApiProperty()
  amount: number;

  @ApiPropertyOptional()
  name: string | null;

  @ApiPropertyOptional()
  discountRefId: string | null;
}

export class PaymentIntentResponseDto {
  @ApiProperty()
  id: string;

  @ApiProperty()
  clientSecret: string;

  @ApiProperty()
  status: PaymentIntentStatus;

  @ApiProperty()
  payableAmount: number;

  @ApiProperty()
  currency: string;

  @ApiPropertyOptional({ description: 'User ID (null until first JWT-authenticated GET claims the intent)' })
  userId: string | null;

  @ApiPropertyOptional()
  returnUrl: string | null;

  @ApiProperty()
  expiresAt: Date;

  @ApiPropertyOptional()
  metadata: Record<string, unknown>;

  @ApiProperty()
  createdAt: Date;

  @ApiPropertyOptional({ type: [PaymentIntentItemResponseDto] })
  items?: PaymentIntentItemResponseDto[];

  @ApiPropertyOptional({ type: [OrderDiscountResponseDto] })
  orderDiscounts?: OrderDiscountResponseDto[];

  @ApiPropertyOptional()
  nextAction?: Record<string, unknown>;
}
