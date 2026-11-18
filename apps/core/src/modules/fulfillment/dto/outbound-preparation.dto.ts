import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Matches, Min } from 'class-validator';
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

  // 화주로 거른다. 쉼표로 여럿: own(자사) 또는 위탁 화주 id. 비우면 전부
  @IsOptional()
  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' ? value.split(',').filter((part) => part.length > 0) : value,
  )
  @IsArray()
  @ArrayMaxSize(50)
  @Matches(/^(own|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})$/, { each: true })
  holders?: string[];
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

export class PreparationShortPickLineDto {
  name: string;
  locationCode: string;
  shortQty: number;
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
  // 결품으로 배치에서 빠져 돌아온 상자면 모자랐던 상품·자리·수량. 분류 안에서 맨 앞에 온다.
  shortPick: PreparationShortPickLineDto[] | null;
  // 위탁 업체(3pl) 상자면 그 화주. 자사 상자는 null
  owner: PreparationOwnerDto | null;
}

export class PreparationOwnerDto {
  id: string;
  name: string;
}

export class PreparationHolderDto {
  // own(자사) 또는 위탁 화주 id — 필터 값 그대로
  key: string;
  name: string;
  count: number;
}

export class PreparationBucketDto {
  bucket: PreparationBucket;
  count: number;
  singleCount: number;
  multiCount: number;
  shortPickCount: number;
  shipments: PreparationShipmentDto[];
}

export class OutboundPreparationSummaryDto {
  warehouseId: string;
  buckets: PreparationBucketDto[];
  awaitingMatchingCount: number;
  // 분류에 든 상자의 화주별 개수(필터와 무관하게 전부). 화주 필터의 선택지다
  holders: PreparationHolderDto[];
}
