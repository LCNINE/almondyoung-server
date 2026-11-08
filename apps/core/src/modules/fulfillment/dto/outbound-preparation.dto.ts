import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Min } from 'class-validator';
import { PREPARATION_BUCKETS, PreparationBucket } from '../outbound-preparation/outbound-preparation-classify';

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

export class PreparationShipmentDto {
  shipmentId: string;
  orderNos: string[];
  itemSummary: string;
  totalQty: number;
  single: boolean;
  reason: string | null;
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
