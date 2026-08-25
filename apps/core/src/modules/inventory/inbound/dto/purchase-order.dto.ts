import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsUUID,
  IsEnum,
  IsOptional,
  IsNumber,
  IsPositive,
  IsArray,
  ArrayMinSize,
  Validate,
  ValidateNested,
} from 'class-validator';
import { IsCalendarDateConstraint } from './calendar-date.validator';

export enum PurchaseOrderType {
  DOMESTIC = 'domestic',
  FOREIGN = 'foreign',
}

export enum PurchaseOrderStatus {
  CREATED = 'created',
  CONFIRMED = 'confirmed',
  RECEIVED = 'received',
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

  /**
   * 확정 경로가 이 값을 `date` 컬럼(계획 아이템·라인 ETA)에 넣으므로, 모양뿐 아니라
   * **달력에 실재하는 날짜**여야 한다. `@IsDateString()`('2026' 통과)도 모양 정규식
   * ('2026-13-45' 통과)도 혼자서는 부족하다 — calendar-date.validator.ts 참고.
   */
  @ApiPropertyOptional({ description: '입고 예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
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

  /**
   * 확정 경로가 이 값을 `date` 컬럼(계획 아이템·라인 ETA)에 넣으므로, 모양뿐 아니라
   * **달력에 실재하는 날짜**여야 한다. `@IsDateString()`('2026' 통과)도 모양 정규식
   * ('2026-13-45' 통과)도 혼자서는 부족하다 — calendar-date.validator.ts 참고.
   */
  @ApiPropertyOptional({ description: '입고 예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
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
  // 빈 배열을 허용하면 라인 전체가 지워지고, requested 라인이 하나도 안 남아
  // refreshHeaderStatus 가 이를 confirmed 로 읽는다 — PUT 한 번으로 조용히
  // "확정"되는 셈이다. admin-web 은 화면에서 이미 최소 1개를 강제하지만 그건
  // 클라이언트 쪽 방어일 뿐이라 API 에도 최소 크기를 건다.
  @ApiProperty({ type: [UpdatePurchaseOrderLineDto], description: '발주 라인 목록' })
  @IsArray()
  @ArrayMinSize(1)
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

  /**
   * 확정 경로가 이 값을 `date` 컬럼(계획 아이템·라인 ETA)에 넣으므로, 모양뿐 아니라
   * **달력에 실재하는 날짜**여야 한다. `@IsDateString()`('2026' 통과)도 모양 정규식
   * ('2026-13-45' 통과)도 혼자서는 부족하다 — calendar-date.validator.ts 참고.
   */
  @ApiPropertyOptional({ description: '입고 예정일 (YYYY-MM-DD)' })
  @IsOptional()
  @Validate(IsCalendarDateConstraint)
  expectedArrival?: string;

  @ApiProperty({ description: '목적지 창고 ID', format: 'uuid' })
  @IsUUID()
  destinationWarehouseId: string;
}

// 응답 DTO 클래스는 purchase-order/purchase-order-response.dto.ts 에 있다. bare
// interface 라 Swagger 스키마가 없어 컨트롤러가 type:'object' 로 때웠던 걸 여기서
// 없앤다 — `PurchaseOrderResponse` 이름은 별칭으로 남겨 기존 import 를 안 깬다.
export {
  PurchaseOrderResponseDto,
  PurchaseOrderLineDto,
  PurchaseOrderLineSkuDto,
} from './purchase-order/purchase-order-response.dto';
export type { PurchaseOrderResponseDto as PurchaseOrderResponse } from './purchase-order/purchase-order-response.dto';

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

/**
 * 재주문 제안. `type: [Object]` 로 때우던 자리를 클래스로 바꾼다 — CLAUDE.md 가
 * 금지한 형태(Swagger 스키마 없음)를 이 태스크에서 이 컨트롤러 전체에 대해 없앤다.
 */
export class StockReorderSuggestion {
  @ApiProperty() skuId: string;
  @ApiProperty() skuName: string;
  @ApiProperty() currentStock: number;
  @ApiProperty() safetyStock: number;
  @ApiProperty() shortfall: number;
  @ApiProperty() suggestedOrder: number;
  @ApiProperty() onOrderQty: number;
  @ApiProperty() inTransferQty: number;
}
