import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Min } from 'class-validator';

/** SKU 원가 판정 결과. 판정 불가 사유별로 분리 집계한다 — 0으로 뭉개지 않는다. */
export type SkuCostStatus = 'valued' | 'costMissing' | 'costConflict' | 'multiMaster' | 'unmatched';

export class StockValuationStateDto {
  @ApiProperty({ description: '재고 상태', enum: ['ON_HAND', 'DEFECTIVE', 'IN_TRANSFER'] })
  state: 'ON_HAND' | 'DEFECTIVE' | 'IN_TRANSFER';

  @ApiProperty({ description: '수량 합 (SKU 단위, 원가 판정 여부 무관 전체)' })
  quantity: number;

  @ApiProperty({ description: '재고 금액 합 (원, 원가 판정 가능한 SKU 만)' })
  value: number;

  @ApiProperty({ description: '원가 판정 불가로 금액에서 제외된 수량' })
  uncostedQuantity: number;
}

export class StockValuationWarehouseDto {
  @ApiProperty({ description: '창고 ID' })
  warehouseId: string;

  @ApiProperty({ description: '창고 이름' })
  warehouseName: string;

  @ApiProperty({ description: '판매 대상 창고 여부' })
  isSellable: boolean;

  @ApiProperty({ description: 'ON_HAND 수량 합' })
  onHandQuantity: number;

  @ApiProperty({ description: 'ON_HAND 재고 금액 합 (원, 원가 판정 가능한 SKU 만)' })
  onHandValue: number;

  @ApiProperty({ description: '원가 판정 불가로 금액에서 제외된 ON_HAND 수량' })
  uncostedQuantity: number;
}

export class StockValuationBucketDto {
  @ApiProperty({ description: '해당 사유의 SKU 수' })
  skuCount: number;

  @ApiProperty({ description: '해당 SKU 들의 ON_HAND 수량 합' })
  onHandQuantity: number;
}

export class StockValuationSummaryDto {
  @ApiProperty({ description: 'ON_HAND 재고 금액 합 (원, 원가 판정 가능한 SKU 만)' })
  onHandValue: number;

  @ApiProperty({ description: 'ON_HAND 수량 합 (전체)' })
  onHandQuantity: number;

  @ApiProperty({ description: '재고를 보유한 SKU 수 (상태 무관)' })
  stockedSkuCount: number;

  @ApiProperty({ description: '상태별 수량·금액', type: [StockValuationStateDto] })
  states: StockValuationStateDto[];

  @ApiProperty({ description: '창고별 ON_HAND 수량·금액', type: [StockValuationWarehouseDto] })
  warehouses: StockValuationWarehouseDto[];

  @ApiProperty({ description: '원가 미입력 (카탈로그 연결은 되나 공급가 없음)', type: StockValuationBucketDto })
  costMissing: StockValuationBucketDto;

  @ApiProperty({ description: '원가 상충 (같은 상품의 링크 간 단위 원가가 다름)', type: StockValuationBucketDto })
  costConflict: StockValuationBucketDto;

  @ApiProperty({ description: '다중 상품 연결 (SKU 가 여러 상품에 속해 귀속 불가)', type: StockValuationBucketDto })
  multiMaster: StockValuationBucketDto;

  @ApiProperty({ description: '카탈로그 미연결 (매칭 없음)', type: StockValuationBucketDto })
  unmatched: StockValuationBucketDto;

  @ApiProperty({ description: '품절 품목을 보유한 상품(master) 수 — 수동품절·재고부족 사유만' })
  soldOutMasterCount: number;

  @ApiProperty({ description: '집계 시각 (ISO)' })
  generatedAt: string;
}

export class StockValuationProductDto {
  @ApiProperty({ description: '상품 master ID' })
  masterId: string;

  @ApiProperty({ description: '상품명 (active 버전)', nullable: true })
  name: string | null;

  @ApiProperty({ description: '귀속된 SKU 수' })
  skuCount: number;

  @ApiProperty({ description: 'ON_HAND 수량 합 (SKU 단위)' })
  onHandQuantity: number;

  @ApiProperty({ description: 'ON_HAND 재고 금액 합 (원, 원가 판정 가능한 SKU 만)' })
  onHandValue: number;

  @ApiProperty({ description: '원가 판정 불가 SKU 포함 여부 (금액이 과소일 수 있음)' })
  hasUncostedSku: boolean;
}

export class GetStockValuationProductsQueryDto {
  @ApiProperty({ description: '페이지 (1-base)', required: false, default: 1 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  page?: number;

  @ApiProperty({ description: '페이지 크기', required: false, default: 50 })
  @Type(() => Number)
  @IsInt()
  @IsOptional()
  @Min(1)
  limit?: number;

  @ApiProperty({ description: '정렬 축', required: false, enum: ['value', 'quantity'], default: 'value' })
  @IsOptional()
  @IsIn(['value', 'quantity'])
  sort?: 'value' | 'quantity';

  @ApiProperty({ description: '정렬 방향', required: false, enum: ['asc', 'desc'], default: 'desc' })
  @IsOptional()
  @IsIn(['asc', 'desc'])
  order?: 'asc' | 'desc';

  @ApiProperty({
    description: 'master ID 필터 (쉼표 구분). 지정 시 해당 상품만 반환 — 악성재고 화면 병합용',
    required: false,
  })
  @IsOptional()
  @IsString()
  masterIds?: string;
}
