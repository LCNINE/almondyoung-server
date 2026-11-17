import type {
  OutboundPreparationSummary,
  PlannedShipment,
  PreparationBucket,
  PreparationShipmentDto,
} from '@/lib/types/dto/fulfillment';

// 한 번에 출고 준비하는 상자 수 상한. 서버 BulkShipmentIdsDto 의 ArrayMaxSize(100) 과 같아야 한다.
export const PREPARATION_BATCH_LIMIT = 100;

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
