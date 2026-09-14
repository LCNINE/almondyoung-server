import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { PurchaseOrderStatus, PurchaseOrderType } from '../purchase-order.dto';
import { SupplierResponseDto } from '../../../suppliers/dto/supplier-response.dto';
import { ReceivingProgress } from '../../services/purchase-order-status.rules';

export type PurchaseOrderLineStatus = 'requested' | 'ordered' | 'unavailable';

export class PurchaseOrderLineSkuDto {
  @ApiProperty() name: string;
  @ApiPropertyOptional({ nullable: true }) barcode: string | null;
}

export class PurchaseOrderLineDto {
  @ApiProperty() skuId: string;

  @ApiProperty({ description: '요청 수량 — 실행이 덮어쓰지 않는다' })
  quantity: number;

  @ApiProperty({ enum: ['requested', 'ordered', 'unavailable'] })
  status: PurchaseOrderLineStatus;

  @ApiPropertyOptional({ description: '실제로 발주한 수량', nullable: true })
  orderedQty: number | null;

  @ApiPropertyOptional({ nullable: true }) unitPrice: number | null;

  @ApiPropertyOptional({ description: '이 품목의 도착예정일 (YYYY-MM-DD)', nullable: true })
  expectedArrival: string | null;

  @ApiPropertyOptional({ nullable: true }) orderedAt: Date | null;
  @ApiPropertyOptional({ nullable: true }) orderedBy: string | null;
  @ApiPropertyOptional({ nullable: true }) unavailableReason: string | null;

  /** 받은 누계 (실발주 라인만 0 보다 클 수 있다) */
  @ApiProperty()
  receivedQty: number;

  /** 남은 수량 = ordered ∧ 잔량 포기 아님 일 때 orderedQty − receivedQty, 아니면 0 */
  @ApiProperty()
  outstandingQty: number;

  /** 입고 진행 — 카운터 파생(D9). requested/unavailable 은 null */
  @ApiProperty({ enum: ['awaiting', 'received', 'short_closed'], nullable: true })
  receivingProgress: ReceivingProgress | null;

  @ApiProperty({ nullable: true })
  closedReason: string | null;

  @ApiProperty({ nullable: true })
  closedAt: Date | null;

  @ApiPropertyOptional({ type: PurchaseOrderLineSkuDto })
  sku?: PurchaseOrderLineSkuDto;
}

export class PurchaseOrderResponseDto {
  @ApiProperty() id: string;
  @ApiProperty({ enum: ['domestic', 'foreign'] }) type: PurchaseOrderType;
  @ApiPropertyOptional({ nullable: true }) supplierId: string | null;
  @ApiPropertyOptional({ nullable: true }) expectedArrival: Date | null;
  @ApiProperty({ enum: ['created', 'confirmed', 'received', 'cancelled'] }) status: PurchaseOrderStatus;

  @ApiProperty() createdAt: Date;
  @ApiProperty() updatedAt: Date;

  @ApiProperty({ type: [PurchaseOrderLineDto] })
  lines: PurchaseOrderLineDto[];

  @ApiPropertyOptional({ type: SupplierResponseDto })
  supplier?: SupplierResponseDto;
}
