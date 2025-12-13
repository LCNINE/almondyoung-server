import { ApiProperty } from '@nestjs/swagger';
import { IsUUID, IsNotEmpty, IsArray, ValidateNested, IsNumber, Min, IsOptional, IsDateString, IsString, MaxLength } from 'class-validator';
import { Type } from 'class-transformer';
import { SupplierResponseDto } from '../../suppliers/dto/supplier-response.dto';

export class SimpleInboundItemDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '입고 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '입고 메모', required: false })
  @IsOptional()
  memo?: string;
}

export class SimpleInboundDto {
  @ApiProperty({ description: '타겟 창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ type: [SimpleInboundItemDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SimpleInboundItemDto)
  items: SimpleInboundItemDto[];
}

export class IndividualInboundDto {
  @ApiProperty({ description: '타겟 창고 ID' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '입고 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '타겟 로케이션 ID', required: false })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({ description: '입고 메모', required: false })
  @IsOptional()
  memo?: string;
}

export class PutawayRequestDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '목적지 로케이션 ID' })
  @IsUUID()
  @IsNotEmpty()
  toLocationId: string;

  @ApiProperty({ description: '이동 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class ReturnInboundDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '회송 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '회송 사유', required: false })
  @IsOptional()
  reason?: string;
}

export class CancelInboundDto {
  @ApiProperty({ description: '입고 라인 ID' })
  @IsUUID()
  @IsNotEmpty()
  lineId: string;

  @ApiProperty({ description: '취소 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;
}

export class CreateInboundPlanDto {
  @ApiProperty({ description: '예정일 (YYYY-MM-DD)' })
  @IsDateString()
  expectedDate: string;

  @ApiProperty({ description: '입고될 창고 ID (source warehouse)' })
  @IsUUID()
  @IsNotEmpty()
  warehouseId: string;

  @ApiProperty({ description: '최종 목적지 창고 ID (destination warehouse)', required: false })
  @IsUUID()
  @IsOptional()
  destinationWarehouseId?: string;

  @ApiProperty({ description: '연결된 발주 ID' })
  @IsUUID()
  @IsNotEmpty()
  linkedPurchaseOrderId: string;

  @ApiProperty({
    description: '계획 타입 (source: 중국창고, destination: 최종창고)',
    enum: ['source', 'destination'],
    required: false,
    default: 'destination'
  })
  @IsOptional()
  @IsString()
  planType?: 'source' | 'destination';

  @ApiProperty({ description: '창고간 이동 필요 여부', required: false, default: false })
  @IsOptional()
  requiresTransfer?: boolean;

  @ApiProperty({ description: '부모 계획 ID (destination 계획인 경우 source 계획 참조)', required: false })
  @IsUUID()
  @IsOptional()
  parentPlanId?: string;
}

export class InboundPlanItemInputDto {
  @ApiProperty({ description: 'SKU ID' })
  @IsUUID()
  @IsNotEmpty()
  skuId: string;

  @ApiProperty({ description: '예정 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  expectedQty: number;
}

export class AddInboundPlanItemsDto {
  @ApiProperty({ description: '입고예정 ID' })
  @IsUUID()
  @IsNotEmpty()
  planId: string;

  @ApiProperty({ type: [InboundPlanItemInputDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => InboundPlanItemInputDto)
  items: InboundPlanItemInputDto[];
}

export class ReceiveFromPlanDto {
  @ApiProperty({ description: '입고예정 아이템 ID' })
  @IsUUID()
  @IsNotEmpty()
  planItemId: string;

  @ApiProperty({ description: '실입고 수량', minimum: 1 })
  @IsNumber()
  @Min(1)
  quantity: number;

  @ApiProperty({ description: '입고 로케이션 ID(옵션)', required: false })
  @IsUUID()
  @IsOptional()
  locationId?: string;

  @ApiProperty({ description: '입고 메모', required: false })
  @IsOptional()
  memo?: string;
}

export class UpdateInboundLineMemoDto {
  @ApiProperty({ description: '메모 내용', maxLength: 255 })
  @IsString()
  @MaxLength(255)
  memo: string;
}

export class ListPlanItemsQueryDto {
  @ApiProperty({ description: '시작일 (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  startDate?: string;

  @ApiProperty({ description: '종료일 (YYYY-MM-DD)', required: false })
  @IsOptional()
  @IsDateString()
  endDate?: string;

  @ApiProperty({ description: '창고 ID', required: false })
  @IsOptional()
  @IsUUID()
  warehouseId?: string;

  @ApiProperty({ description: 'SKU ID', required: false })
  @IsOptional()
  @IsUUID()
  skuId?: string;
}

// 이중 입고 계획을 위한 새 응답 DTO
export interface InboundPendingResponse {
  planId: string;
  planType: 'source' | 'destination';
  warehouseId: string;
  expectedDate: Date | null;

  // 연관 정보
  isLinkedPlan: boolean;           // destination plan 여부
  sourcePlanStatus?: string;       // 중국 plan 상태 (destination plan인 경우)

  // 발주 정보
  purchaseOrder: {
    id: string;
    type: 'domestic' | 'foreign';
    supplier?: SupplierResponseDto;
  };

  // 아이템 목록
  items: Array<{
    skuId: string;
    skuName: string;
    skuCode: string;
    expectedQty: number;
    receivedQty: number;
    pendingQty: number;
  }>;

  // 집계 정보
  totalQuantity: number;
  totalPendingQuantity: number;
}

export interface InboundPendingListResponse {
  warehouseId?: string;
  totalPendingPlans: number;
  totalPendingQuantity: number;
  pendingPlans: InboundPendingResponse[];
}


