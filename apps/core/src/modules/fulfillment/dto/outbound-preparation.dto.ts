import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { PREPARATION_BUCKETS, PreparationBucket } from '../outbound-preparation/outbound-preparation-classify';
import { ShipmentSplitShareDto } from './consolidation.dto';

export class OutboundPreparationQueryDto {
  @IsUUID()
  warehouseId: string;

  @IsOptional()
  @IsIn(PREPARATION_BUCKETS)
  bucket?: PreparationBucket;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class BulkShipmentIdsDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @IsUUID('4', { each: true })
  shipmentIds: string[];
}

export class PreparationLineDto {
  name: string;
  qty: number;
  // 이 줄에 잡힌 예약 수량(주문 수량을 넘지 않는다). 주문 수량과의 차이가 «있는 것만 먼저 보내기»에서 기다릴 몫이다.
  reservedQty: number;
}

export class PreparationShipmentDto {
  shipmentId: string;
  orderNos: string[];
  itemSummary: string;
  totalQty: number;
  single: boolean;
  reason: string | null;
  lines: PreparationLineDto[];
  split: ShipmentSplitShareDto | null;
}

export class PreparationBucketDto {
  bucket: PreparationBucket;
  count: number;
  singleCount: number;
  multiCount: number;
  shipments: PreparationShipmentDto[];
}

export class OutboundPreparationSummaryDto {
  warehouseId: string;
  buckets: PreparationBucketDto[];
  awaitingMatchingCount: number;
}
