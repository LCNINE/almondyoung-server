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

export class PreparationIncomingDto {
  // 이 창고로 오는 이동 지시 잔량과 가장 이른 도착 예정일(YYYY-MM-DD)
  inTransit: number;
  inTransitEta: string | null;
  // 이 창고로 바로 들어오는 발주 잔량과 가장 이른 입고 예정일
  ordered: number;
  orderedEta: string | null;
  // 이 창고로 오는 선적 잔량과 가장 이른 도착 예정일
  inboundShipment: number;
  inboundShipmentEta: string | null;
}

export class PreparationElsewhereDto {
  // 판매하지 않는 창고에 있고 아직 옮기지 않은 수량
  onHand: number;
  // 그쪽으로 들어올 발주 잔량과 가장 이른 예정일
  ordered: number;
  orderedEta: string | null;
}

export class PreparationLineStockDto {
  // 이 줄의 SKU. 보충 제안의 그 상품으로 잇는다
  skuId: string;
  // 이 창고 재고(ON_HAND)와 그중 다른 상자가 잡은 수량
  onHand: number;
  reservedByOthers: number;
  // 아직 어느 상자도 잡지 않은 수량. 곧 자동 예약된다
  available: number;
  // 이 창고에서 이 상품 재고를 아직 못 잡은 수량의 합(이 상자 포함). 들어오는 재고는 이 수량에 오래 기다린 순서로 나뉜다
  waiting: number;
  // 판매 창고가 이 창고 하나일 때만 안다. 모르면 null
  incoming: PreparationIncomingDto | null;
  elsewhere: PreparationElsewhereDto | null;
}

export class PreparationLineDto {
  name: string;
  qty: number;
  // 이 줄에 잡힌 예약 수량(주문 수량을 넘지 않는다). 주문 수량과의 차이가 «있는 것만 먼저 보내기»에서 기다릴 몫이다.
  reservedQty: number;
  // 출고불가·부분출고 상자의 모자란 줄만: 재고가 어디에 얼마나 있고 언제 들어오는지
  stock?: PreparationLineStockDto;
}

export class NeedsInfoSkuDto {
  name: string;
  code: string;
  // 배송 프로필이 상품마다 다를 때만
  profileName?: string;
}

export class NeedsInfoIssueDto {
  kind: 'shipping_profile_missing' | 'shipping_profile_mixed' | 'recipient_incomplete' | 'channel_item_unknown';
  // 배송 프로필·쇼핑몰 품목 번호 문제의 상품
  skus?: NeedsInfoSkuDto[];
  // 수령인 정보에서 비어 있는 칸(recipientName·phone·postalCode·roadAddress)
  fields?: string[];
}

export class PreparationDeliveryProfileDto {
  id: string;
  name: string;
}

export class PreparationProfileSplitLineDto {
  id: string;
  lineVersion: number;
  qty: number;
  skuId: string;
  skuName: string;
  skuCode: string;
  // SKU 에 지정된 배송 프로필
  deliveryProfile: PreparationDeliveryProfileDto | null;
}

export class PreparationProfileSplitDto {
  manifestVersion: number;
  lines: PreparationProfileSplitLineDto[];
}

export class PreparationShortPickLineDto {
  name: string;
  locationCode: string;
  shortQty: number;
}

export class PreparationBatchReturnDto {
  batchNumber: string;
  exitedAt: string;
  // 뺀 곳을 고정 사유로 알 수 있을 때만(물류앱 출고 검수·관리자 출고 배치 등). 사람이 적은 사유면 null
  place: string | null;
  reason: string;
  // 살아 있는 송장이 없어 다시 준비하면 새 송장을 받는다
  needsNewWaybill: boolean;
}

// 받는 분. 접속기록이 이 칸을 받은 상자만 대상으로 남기게 상자 id 를 함께 싣는다
export class PreparationRecipientDto {
  shipmentId: string;
  name: string;
}

export class PreparationShipmentDto {
  shipmentId: string;
  orderNos: string[];
  // 상자에 든 판매 주문 수. 둘 이상이면 합포장이라 «있는 것만 먼저 보내기»를 거절한다
  orderCount: number;
  // 상자에 든 주문 중 가장 이른 주문일. 판매 주문이 없는 상자(위탁 출고 등)는 null
  orderedAt: string | null;
  // 완전출고 상자만
  recipient?: PreparationRecipientDto;
  itemSummary: string;
  totalQty: number;
  single: boolean;
  reason: string | null;
  lines: PreparationLineDto[];
  split: ShipmentSplitShareDto | null;
  // 결품으로 배치에서 빠져 돌아온 상자면 모자랐던 상품·자리·수량. 분류 안에서 맨 앞에 온다.
  shortPick: PreparationShortPickLineDto[] | null;
  // 출고 배치에서 빠져 돌아온 상자면 언제·어느 배치에서·왜 뺐는지. 결품 상자 다음에 온다.
  batchReturn: PreparationBatchReturnDto | null;
  // 위탁 업체(3pl) 상자면 그 화주. 자사 상자는 null
  owner: PreparationOwnerDto | null;
  // 우선할당한 상자 — 재고를 먼저 받는다. 합포장이면 담긴 주문이 모두 우선할당일 때만 true
  stockPriority: boolean;
  // 정보 부족 상자만: 고쳐야 할 것 전부(첫 항목이 사유)
  needsInfo?: NeedsInfoIssueDto[];
  // 배송 프로필이 섞인 정보 부족 상자만: 그 자리에서 프로필별로 나누는 데 쓰는 줄(받는 분 정보 없음)
  profileSplit?: PreparationProfileSplitDto;
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
  // 결품 상자를 뺀, 배치에서 빠져 돌아온 상자 수
  batchReturnCount: number;
  shipments: PreparationShipmentDto[];
}

export class OutboundPreparationCountsQueryDto {
  @IsUUID()
  warehouseId: string;
}

export class PreparationBucketCountDto {
  bucket: PreparationBucket;
  count: number;
}

// 메뉴 배지처럼 숫자만 쓰는 곳에 준다. 분류는 내역과 같다
export class OutboundPreparationCountsDto {
  warehouseId: string;
  buckets: PreparationBucketCountDto[];
}

export class OutboundPreparationSummaryDto {
  warehouseId: string;
  buckets: PreparationBucketDto[];
  awaitingMatchingCount: number;
  // 분류에 든 상자의 화주별 개수(필터와 무관하게 전부). 화주 필터의 선택지다
  holders: PreparationHolderDto[];
}
