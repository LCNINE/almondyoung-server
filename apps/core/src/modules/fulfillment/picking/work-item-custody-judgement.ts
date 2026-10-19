import type { ShipmentAllocation, ShipmentCustodyBalance } from './allocation/allocation.types';

/**
 * 피킹 작업 항목의 custody 판정 — 순수 함수. DB·예외·메시지를 모른다.
 * 코드를 받은 커널이 전략 정책의 메시지로 `conflict(code, message)` 를 만든다.
 */

type SpotProbe = Pick<ShipmentCustodyBalance, 'custodyType' | 'custodyRef'>;
type QtyBalance = Pick<ShipmentCustodyBalance, 'custodyType' | 'custodyRef' | 'qty'>;

/** 들고 있어도 되는 자리. custodyRef 가 null 이면 그 자리는 무효. */
export interface HeldSpots {
  allows(balance: SpotProbe): boolean;
}

export function spotsOf(entries: ReadonlyArray<{ custodyType: string; refs: ReadonlySet<string> }>): HeldSpots {
  return {
    allows(balance) {
      const ref = balance.custodyRef;
      if (ref === null) return false;
      return entries.some((entry) => entry.custodyType === balance.custodyType && entry.refs.has(ref));
    },
  };
}

/** 세 전략의 현재 상수(`work-item:`)와 같아야 한다. */
export const PACKING_REF_PREFIX = 'work-item:';

export function packingRefOf(workItemId: string): string {
  return `${PACKING_REF_PREFIX}${workItemId}`;
}

export type Judgement = { ok: true } | { ok: false; code: string; balanceId?: string; grain?: string };

/** completePick 한 배정 행: 합 = 배정량 이고 모든 잔량이 허용 자리에 있다. */
export function judgeCompleteAllocation(
  allocationQty: number,
  balances: readonly QtyBalance[],
  held: HeldSpots,
): boolean {
  const total = balances.reduce((sum, balance) => sum + balance.qty, 0);
  return total === allocationQty && judgeHeldCustody(balances, held);
}

/** 박스의 모든 잔량이 허용 자리에 있다(handoff 전·후, unpick picking). */
export function judgeHeldCustody(balances: readonly SpotProbe[], held: HeldSpots): boolean {
  return balances.every((balance) => held.allows(balance));
}

/**
 * unpick 판정. D3 순서: ① 모든 잔량 grain 검사 ② picking → held, ready_to_pack → PACKING ref 정확 일치.
 */
export function judgeUnpickCustody(input: {
  status: 'picking' | 'ready_to_pack';
  workItemId: string;
  balances: readonly ShipmentCustodyBalance[];
  allocations: readonly ShipmentAllocation[];
  held: HeldSpots | null; // picking 일 때만 non-null
}): Judgement {
  const { balances, allocations } = input;
  const allocationByGrain = new Map(
    allocations.map((allocation) => [`${allocation.shipmentLineId}|${allocation.sourceLocationId}`, allocation]),
  );
  const attributedByGrain = new Map<string, number>();
  // ① 모든 잔량의 grain 검사 (discrete 와 동일).
  for (const balance of balances) {
    const grain = `${balance.shipmentLineId ?? ''}|${balance.sourceLocationId ?? ''}`;
    const allocation = allocationByGrain.get(grain);
    if (!allocation || allocation.skuId !== balance.skuId) {
      return { ok: false, code: 'PICKING_CUSTODY_GRAIN_MISMATCH', balanceId: balance.id, grain };
    }
    const attributed = (attributedByGrain.get(grain) ?? 0) + balance.qty;
    attributedByGrain.set(grain, attributed);
    if (attributed > allocation.qty) {
      return { ok: false, code: 'PICKING_CUSTODY_OVERATTRIBUTED', balanceId: balance.id, grain };
    }
  }
  // ② 소유 자리 검사.
  if (input.status === 'picking') {
    const held = input.held;
    const offending = balances.find((balance) => !held || !held.allows(balance));
    return offending ? { ok: false, code: 'PICKING_CUSTODY_OWNER_MISMATCH', balanceId: offending.id } : { ok: true };
  }
  const packingRef = packingRefOf(input.workItemId);
  // discrete 의 길이 검사를 그대로 옮겼다. uq_batch_inventory_session_balance_grain 이
  // (session, sku, source, custodyType, custodyRef, line) 유일이라, 전부 같은 PACKING ref 이고
  // grain 검사를 통과했다면 grain 당 잔량은 최대 1행이다. 그래서 길이 == 배정 수 는
  // 「모든 배정에 잔량이 있다」와 같다.
  const incomplete =
    balances.length !== allocations.length ||
    balances.some((balance) => balance.custodyType !== 'PACKING' || balance.custodyRef !== packingRef) ||
    allocations.some(
      (allocation) =>
        attributedByGrain.get(`${allocation.shipmentLineId}|${allocation.sourceLocationId}`) !== allocation.qty,
    );
  return incomplete ? { ok: false, code: 'PICKING_PACKING_CUSTODY_INCOMPLETE' } : { ok: true };
}
