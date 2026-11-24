import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsOptional, IsString, MaxLength } from 'class-validator';
import { StockAllocation } from '../../inventory/schema/inventory.schema';
import { ShipmentCommandReasonDto } from './shipment-planning.dto';

/** 우선할당할 수 없는 이유 */
export const STOCK_PRIORITY_BLOCKS = [
  'NOT_DRAFT',
  'SUPPLIER_BOX',
  'SELLMATE_BOX',
  'IN_RECOVERY',
  'IN_BATCH',
  'NOTHING_MISSING',
] as const;
export type StockPriorityBlock = (typeof STOCK_PRIORITY_BLOCKS)[number];

export class StockPriorityLineDto {
  @ApiProperty() skuId: string;
  @ApiProperty() skuName: string;
  @ApiProperty() qty: number;
  @ApiProperty() reservedQty: number;
  @ApiProperty({ description: '아직 예약받지 못한 수량' }) missingQty: number;
}

export class StockPriorityTakeDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty({ type: [String] }) orderNos: string[];
  @ApiProperty() skuName: string;
  @ApiProperty() qty: number;
  @ApiProperty({ description: '가져오기 전에 나갈 수 있던 상자인가' }) ready: boolean;
  @ApiProperty({ description: '가져온 뒤 이 상자에 예약이 하나도 남지 않는가' }) emptied: boolean;
}

export class StockPriorityPlanDto {
  @ApiProperty({ description: '남는 재고에서 받는 수량' }) freeQty: number;
  @ApiProperty({ type: [StockPriorityTakeDto] }) takes: StockPriorityTakeDto[];
  @ApiProperty({ description: '이대로 해도 모자란 수량' }) missingQty: number;
  @ApiProperty({ description: '이 계획 그대로 실행할 때 보내는 값' }) token: string;
}

export class StockPriorityPreviewDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty({ type: [String] }) orderNos: string[];
  @ApiProperty({ enum: ['normal', 'priority'] }) stockAllocation: StockAllocation;
  @ApiProperty({ enum: STOCK_PRIORITY_BLOCKS, nullable: true }) blocked: StockPriorityBlock | null;
  @ApiProperty({ type: [StockPriorityLineDto] }) lines: StockPriorityLineDto[];
  @ApiProperty({ type: StockPriorityPlanDto, nullable: true }) plan: StockPriorityPlanDto | null;
  @ApiProperty({
    type: StockPriorityPlanDto,
    nullable: true,
    description: '나갈 수 있던 상자까지 쓰는 계획. 그렇게 해야 이 상자가 다 채워질 때만 있다',
  })
  planWithReady: StockPriorityPlanDto | null;
}

export class SetStockPriorityDto extends ShipmentCommandReasonDto {
  @ApiProperty({ description: '미리보기의 token' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  planToken: string;

  @ApiProperty({ required: false, description: '나갈 수 있던 상자에서도 가져온다' })
  @IsBoolean()
  @IsOptional()
  includeReady?: boolean;
}

export class StockPriorityResultDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty() movedQty: number;
  @ApiProperty() freeQty: number;
  @ApiProperty() missingQty: number;
  @ApiProperty() operationId: string;
}

export class StockPriorityCancelResultDto {
  @ApiProperty() shipmentId: string;
  @ApiProperty() operationId: string;
}
