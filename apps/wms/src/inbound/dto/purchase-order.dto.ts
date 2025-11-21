import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsUUID, IsEnum, IsOptional, IsDateString, IsNumber, IsPositive, IsArray, ValidateNested } from 'class-validator';
import { SupplierResponseDto } from '../../suppliers/dto/supplier-response.dto';

export enum PurchaseOrderType {
  DOMESTIC = 'domestic',
  FOREIGN = 'foreign'
}

export enum PurchaseOrderStatus {
  CREATED = 'created',
  CONFIRMED = 'confirmed',
  RECEIVED = 'received'
}

export class CreatePurchaseOrderLineDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '발주 수량' })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({ description: '단가' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;
}

export class CreatePurchaseOrderDto {
  @ApiProperty({ enum: PurchaseOrderType, description: '발주 유형 (국내/해외)' })
  @IsEnum(PurchaseOrderType)
  type: PurchaseOrderType;

  @ApiProperty({ description: '공급업체 ID' })
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({ description: '입고 예정일' })
  @IsOptional()
  @IsDateString()
  expectedArrival?: string;

  @ApiProperty({ description: '목적지 창고 ID', format: 'uuid' })
  @IsUUID()
  destinationWarehouseId: string;

  @ApiProperty({ type: [CreatePurchaseOrderLineDto], description: '발주 상품 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CreatePurchaseOrderLineDto)
  lines: CreatePurchaseOrderLineDto[];
}

export class UpdatePurchaseOrderStatusDto {
  @ApiProperty({ enum: PurchaseOrderStatus, description: '발주 상태' })
  @IsEnum(PurchaseOrderStatus)
  status: PurchaseOrderStatus;

  @ApiPropertyOptional({ description: '입고 예정일' })
  @IsOptional()
  @IsDateString()
  expectedArrival?: string;
}

export class UpdatePurchaseOrderLineDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '발주 수량' })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({ description: '단가' })
  @IsOptional()
  @IsNumber()
  unitPrice?: number;
}

export class UpdatePurchaseOrderLinesDto {
  @ApiProperty({ type: [UpdatePurchaseOrderLineDto], description: '발주 라인 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => UpdatePurchaseOrderLineDto)
  lines: UpdatePurchaseOrderLineDto[];
}

export class AddToCartDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  skuId: string;

  @ApiProperty({ description: '수량' })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiProperty({ enum: PurchaseOrderType, description: '발주 유형' })
  @IsEnum(PurchaseOrderType)
  type: PurchaseOrderType;

  @ApiPropertyOptional({ description: '공급업체 ID' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

export class UpdateCartItemDto {
  @ApiProperty({ description: '수량' })
  @IsNumber()
  @IsPositive()
  quantity: number;

  @ApiPropertyOptional({ description: '공급업체 ID' })
  @IsOptional()
  @IsUUID()
  supplierId?: string;
}

export class CreatePurchaseOrderFromCartDto {
  @ApiProperty({ description: '장바구니 아이템 ID 목록' })
  @IsArray()
  @IsUUID(4, { each: true })
  cartItemIds: string[];

  @ApiProperty({ description: '공급업체 ID' })
  @IsUUID()
  supplierId: string;

  @ApiPropertyOptional({ description: '입고 예정일' })
  @IsOptional()
  @IsDateString()
  expectedArrival?: string;

  @ApiProperty({ description: '목적지 창고 ID', format: 'uuid' })
  @IsUUID()
  destinationWarehouseId: string;
}

export interface PurchaseOrderResponse {
  id: string;
  type: PurchaseOrderType;
  supplierId: string | null;
  expectedArrival: Date | null;
  status: PurchaseOrderStatus;
  createdAt: Date;
  updatedAt: Date;
  lines: {
    skuId: string;
    quantity: number;
    unitPrice: number | null;
    sku?: {
      name: string;
      barcode: string | null;
    };
  }[];
  supplier?: SupplierResponseDto;
}

export interface CartItemResponse {
  id: string;
  skuId: string;
  quantity: number;
  type: PurchaseOrderType;
  supplier: {
    id: string;
    name: string;
  } | null;
  createdAt: Date;
  updatedAt: Date;
  sku: {
    name: string;
    barcode: string | null;
  };
}

export interface StockReorderSuggestion {
  skuId: string;
  skuName: string;
  currentStock: number;
  safetyStock: number;
  shortfall: number;
  suggestedOrder: number;
  onOrderQty: number;
  inTransferQty: number;
}