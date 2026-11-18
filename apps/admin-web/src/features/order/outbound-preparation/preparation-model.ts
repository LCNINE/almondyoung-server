import type {
  OutboundPreparationSummary,
  PlannedShipment,
  PreparationBatchReturn,
  PreparationBucket,
  PreparationShipmentDto,
  PreparationShortPickLine,
} from '@/lib/types/dto/fulfillment';

// 한 번에 출고 준비하는 상자 수 상한. 서버 BulkShipmentIdsDto 의 ArrayMaxSize(100) 과 같아야 한다.
export const PREPARATION_BATCH_LIMIT = 100;

// 한꺼번에 고를 상자. 결품으로 돌아온 상자는 자리 수량을 확인한 뒤 하나씩 고른다.
export function bulkSelectableShipments(
  shipments: PreparationShipmentDto[]
): PreparationShipmentDto[] {
  return shipments
    .filter((shipment) => !shipment.shortPick)
    .slice(0, PREPARATION_BATCH_LIMIT);
}

export function shortPickText(lines: PreparationShortPickLine[]): string {
  return `결품 — ${lines
    .map(
      (line) => `${line.name} ${line.shortQty}개 모자람 (${line.locationCode})`
    )
    .join(', ')}`;
}

const KST_MINUTE = new Intl.DateTimeFormat('en-US', {
  timeZone: 'Asia/Seoul',
  month: 'numeric',
  day: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

function kstMinuteText(iso: string): string {
  const parts = Object.fromEntries(
    KST_MINUTE.formatToParts(new Date(iso)).map((part) => [
      part.type,
      part.value,
    ])
  );

  return `${parts.month}월 ${parts.day}일 ${parts.hour}:${parts.minute}`;
}

export type ShipmentGroup = 'short_pick' | 'batch_return' | 'other';

export function shipmentGroupOf(
  shipment: Pick<PreparationShipmentDto, 'shortPick' | 'batchReturn'>
): ShipmentGroup {
  if (shipment.shortPick) {
    return 'short_pick';
  }

  return shipment.batchReturn ? 'batch_return' : 'other';
}

// 언제·어느 배치에서·어디서 뺐는지. 사유는 따로 보인다.
export function batchReturnText(batchReturn: PreparationBatchReturn): string {
  return [
    kstMinuteText(batchReturn.exitedAt),
    `${batchReturn.batchNumber}에서 뺌`,
    batchReturn.place,
  ]
    .filter(Boolean)
    .join(' · ');
}

// 배치에서 빠져 돌아온 상자를 이 내역에서 다시 보내려면 무엇을 하면 되는지. 송장 오류처럼
// 서버가 이미 다음 할 일을 적어 준 상자와 결품 상자는 그 안내를 따른다.
export function batchReturnNextStep(
  bucket: PreparationBucket,
  shipment: Pick<PreparationShipmentDto, 'shortPick' | 'batchReturn' | 'reason'>
): string | null {
  if (!shipment.batchReturn || shipment.shortPick || shipment.reason) {
    return null;
  }

  switch (bucket) {
    case 'resume':
      return shipment.batchReturn.needsNewWaybill
        ? '«이어서 출고 준비»를 누르면 새 송장을 받아 다시 배치에 담아요'
        : '«이어서 출고 준비»를 누르면 지금 송장으로 다시 배치에 담아요';
    case 'ready':
      return '«출고 준비»를 누르면 다시 배치에 담아요';
    case 'mergeable':
      return '같이 보낼 주문과 합치거나 «따로 보내기»로 다시 준비해요';
    case 'partial':
      return '재고가 모자라요 — «있는 것만 먼저 보내기»로 나누거나 재고를 채운 뒤 다시 준비해요';
    case 'unavailable':
      return '재고가 모자라요 — 재고를 채운 뒤 다시 준비해요';
    default:
      return null;
  }
}

export function plannedOrderText(
  shipment: Pick<PlannedShipment, 'shipmentId' | 'orderNos'>
): string {
  if (shipment.orderNos.length === 0) {
    return `상자 ${shipment.shipmentId.slice(0, 8)}`;
  }

  return shipment.orderNos.map((no) => `#${no}`).join(', ');
}

type LineQuantity = { qty: number; reservedQty: number };

// «있는 것만 먼저 보내기»는 예약된 만큼을 지금 보낼 상자에 남기고 나머지를 기다릴 상자로 옮긴다.
export function splitQuantities(lines: LineQuantity[]): {
  now: number;
  wait: number;
} {
  return lines.reduce(
    (total, line) => ({
      now: total.now + line.reservedQty,
      wait: total.wait + Math.max(0, line.qty - line.reservedQty),
    }),
    { now: 0, wait: 0 }
  );
}

export function lineSplitText(line: LineQuantity): string {
  const { now, wait } = splitQuantities([line]);

  return `주문 ${line.qty} · 지금 보낼 ${now} · 기다릴 ${wait}`;
}

export type PreparationTarget =
  | {
      kind: 'prepare';
      bucket: 'ready' | 'resume' | 'mergeable';
      shipment: PreparationShipmentDto;
    }
  | {
      kind: 'review';
      bucket: PreparationBucket;
      shipment: PreparationShipmentDto;
    }
  | { kind: 'missing' };

const PREPARABLE: ReadonlySet<PreparationBucket> = new Set([
  'ready',
  'resume',
  'mergeable',
]);

function isPreparable(
  bucket: PreparationBucket
): bucket is 'ready' | 'resume' | 'mergeable' {
  return PREPARABLE.has(bucket);
}

// 다른 화면에서 «이 상자 출고 준비»로 넘어온 상자가 지금 어느 분류에 있는지 찾는다.
export function locatePreparationTarget(
  summary: OutboundPreparationSummary,
  shipmentId: string
): PreparationTarget {
  for (const entry of summary.buckets) {
    const shipment = entry.shipments.find(
      (candidate) => candidate.shipmentId === shipmentId
    );

    if (shipment) {
      return isPreparable(entry.bucket)
        ? { kind: 'prepare', bucket: entry.bucket, shipment }
        : { kind: 'review', bucket: entry.bucket, shipment };
    }
  }

  return { kind: 'missing' };
}

export function preparationTargetNotice(
  target: PreparationTarget,
  bucketLabel: string,
  canPrepare: boolean
): string | null {
  if (target.kind === 'missing') {
    return '출고 준비 목록에서 이 상자를 찾지 못했어요. 이미 출고 준비를 시작했거나 목록에 아직 불러오지 않은 상자일 수 있어요.';
  }

  if (target.kind === 'review') {
    return `이 상자는 «${bucketLabel}» 내역에 있어 바로 출고 준비할 수 없어요. 내역에서 이 상자만 골라 두었어요.`;
  }

  return canPrepare
    ? null
    : '이 상자만 골라 두었어요. 피킹 방식을 확인한 뒤 «출고 준비»를 눌러 주세요.';
}

// 넘어온 상자를 처리했거나 창고를 바꾸면 주소에서 상자를 지운다. 주소에 창고가 있으면 지금 창고로 맞춘다.
// 창고를 고른 경우에는 같아 보여도 다시 쓴다 — 읽은 주소가 직전 선택을 아직 반영하지 못했을 수 있다.
export function preparationAddress(
  pathname: string,
  search: string,
  warehouseId?: string
): string | null {
  const params = new URLSearchParams(search);
  const before = params.toString();

  params.delete('prepare');

  if (warehouseId && params.has('warehouseId')) {
    params.set('warehouseId', warehouseId);
  }

  const after = params.toString();
  const chosen = !!warehouseId && params.has('warehouseId');

  if (after === before && !chosen) {
    return null;
  }

  return after ? `${pathname}?${after}` : pathname;
}
