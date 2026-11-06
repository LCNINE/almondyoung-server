import { IsUUID } from 'class-validator';
import { PreparationBucket } from '../outbound-preparation/outbound-preparation-classify';

export class OutboundPreparationQueryDto {
  @IsUUID()
  warehouseId: string;
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
