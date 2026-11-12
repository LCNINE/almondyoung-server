const PAST_STATUSES = new Set(['voided', 'failed', 'abandoned']);
// 배치에서 빠졌거나 출고가 끝난 작업은 지금 배치에 든 것이 아니다
const OUT_OF_BATCH = new Set(['excluded', 'completed']);

/** 서버의 활성 송장 규칙과 같다 — 무효·실패·중단이 아닌 송장이 상자마다 하나다 */
export function splitWaybills<W extends { status: string }>(
  waybills: readonly W[]
): { current: W | null; past: W[] } {
  const live = waybills.filter((w) => !PAST_STATUSES.has(w.status));
  const past = waybills.filter((w) => PAST_STATUSES.has(w.status));

  return { current: live[live.length - 1] ?? null, past: past.reverse() };
}

export type WaybillNextStep =
  | { kind: 'prepare' }
  | { kind: 'print'; batchId: string }
  | { kind: 'shipped' }
  | { kind: 'issuing' }
  | { kind: 'issue' }
  | { kind: 'issue-in-batch'; batchId: string }
  | { kind: 'plan-first' }
  | { kind: 'none' };

export function activeBatchId(
  workItems: ReadonlyArray<{ status: string; batchId?: string }>
): string | null {
  const item = workItems.find(
    (entry) => !OUT_OF_BATCH.has(entry.status) && entry.batchId
  );

  return item?.batchId ?? null;
}

export function waybillNextStep(shipment: {
  status: string;
  waybills: ReadonlyArray<{ status: string }>;
  workItems: ReadonlyArray<{ status: string; batchId?: string }>;
}): WaybillNextStep {
  const { current } = splitWaybills(shipment.waybills);
  const batchId = activeBatchId(shipment.workItems);

  if (!current) {
    // 배치에 든 상자는 출고 준비 목록에 나오지 않는다 — 여기서 발급하고 그 배치에서 이어 간다
    if (shipment.status === 'planned' && batchId) {
      return { kind: 'issue-in-batch', batchId };
    }
    if (shipment.status === 'planned') return { kind: 'issue' };
    if (shipment.status === 'draft') return { kind: 'plan-first' };
    return { kind: 'none' };
  }
  if (current.status === 'used') return { kind: 'shipped' };
  if (current.status !== 'registered') return { kind: 'issuing' };

  return batchId ? { kind: 'print', batchId } : { kind: 'prepare' };
}

export type WaybillAction = 'issue' | 'manual' | 'reissue' | 'void';

const AFTER_DISPATCH = new Set(['shipped', 'in_transit', 'delivered']);

/**
 * 서버가 받는 작업만 보인다. 발급·수동 등록은 계획 확정 상자에 활성 송장이 없을 때,
 * 재발급은 계획 확정 상자의 사용 가능한 송장이 있을 때(먼저 무효로 한 뒤 새로 발급하므로
 * 다른 상태에서 누르면 송장만 무효가 된다), 무효화는 출고 전 상자의 사용 가능한 송장만 받는다.
 * 발급 대기(pending)는 같은 발급으로 다시 태울 수 있어 발급을 남기고, 그 밖에 멈춘 송장은
 * 멈춘 발급 안내에서 푼다.
 */
export function shownWaybillActions(
  shipmentStatus: string,
  current: { status: string } | null
): WaybillAction[] {
  const planned = shipmentStatus === 'planned';

  if (!current) return planned ? ['issue', 'manual'] : [];
  if (current.status === 'pending') return planned ? ['issue'] : [];
  if (current.status !== 'registered') return [];
  if (planned) return ['reissue', 'void'];
  return AFTER_DISPATCH.has(shipmentStatus) ? [] : ['void'];
}
