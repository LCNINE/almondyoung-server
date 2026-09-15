import { ApiProperty } from '@nestjs/swagger';

export const RECEIPT_ACTION_BLOCK_REASONS = [
  'CANCELED',
  'ALREADY_PUTAWAY',
  'RETURN_EXISTS',
  'NOT_TODAY',
  'NOT_STAGING_ORIGIN',
  'ORIGIN_STOCK_INCONSISTENT',
  'MISSING_ORIGIN_OR_EVENT',
  'NOTHING_PENDING',
] as const;
export type ReceiptActionBlockReason = (typeof RECEIPT_ACTION_BLOCK_REASONS)[number];

export class ReceiptLineState {
  @ApiProperty() lineId: string;
  @ApiProperty() receiptId: string;
  @ApiProperty() warehouseId: string;
  @ApiProperty({ enum: ['direct', 'purchase_order'] }) source: 'direct' | 'purchase_order';
  @ApiProperty({ enum: ['posted', 'voided'] }) receiptStatus: 'posted' | 'voided';
  @ApiProperty() skuId: string;
  @ApiProperty() skuCode: string;
  @ApiProperty() skuName: string;
  @ApiProperty({ type: String, nullable: true }) originLocationId: string | null;
  @ApiProperty({ type: String, nullable: true }) originLocationCode: string | null;
  @ApiProperty() quantity: number;
  @ApiProperty() putawayFromOriginQty: number;
  @ApiProperty() canceledQty: number;
  @ApiProperty() returnedQty: number;
  @ApiProperty() pendingQty: number;
  @ApiProperty() canPutaway: boolean;
  @ApiProperty({ enum: RECEIPT_ACTION_BLOCK_REASONS, nullable: true })
  putawayBlockReason: ReceiptActionBlockReason | null;
  @ApiProperty() canCancel: boolean;
  @ApiProperty({ enum: RECEIPT_ACTION_BLOCK_REASONS, nullable: true })
  cancelBlockReason: ReceiptActionBlockReason | null;
}
