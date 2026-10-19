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
  /** 허용 자리가 하나도 없다(tote: 활성 배정 0). */
  readonly empty: boolean;
}

export function spotsOf(entries: ReadonlyArray<{ custodyType: string; refs: ReadonlySet<string> }>): HeldSpots {
  return {
    empty: entries.every((entry) => entry.refs.size === 0),
    allows(balance) {
      const ref = balance.custodyRef;
      if (ref === null) return false;
      return entries.some((entry) => entry.custodyType === balance.custodyType && entry.refs.has(ref));
    },
  };
}

/**
 * 검수 대기 PACKING custodyRef 의 정본 — 세 전략과 커널이 모두 `packingRefOf` 로 만든다. DB 에 이미 쓰인 잔량 행의
 * custodyRef 와 같아야 하므로 값을 바꾸지 않는다.
 */
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
  // discrete 의 길이 검사를 그대로 옮겼다. aggregate 의 옛 `balances.length === 0` 과 동치인 근거:
  // - uq_batch_inventory_session_balance_grain 이 (session, sku, source, custodyType, custodyRef, line) 유일이고
  //   ① 이 sku 를 배정 SKU 로 고정했으므로, 전부 같은 PACKING ref 이면 grain(line, source) 당 잔량은 최대 1행이다.
  // - uq_picking_source_allocations_work_item_grain 이 (workItem, line, source) 유일이라 배정도 grain 당 1행이다.
  // - loadWorkItemAllocations 는 qty > 0 인 배정만 돌려주고(하나도 없으면 PICKING_WORK_ITEM_NOT_ALLOCATED 로 던진다)
  //   잔량도 qty > 0 만 오므로, 「grain 마다 귀속량 == 배정량」이면 배정 grain 마다 잔량이 정확히 1행 있다.
  // 그래서 길이 == 배정 수 는 나머지 두 조건이 참일 때 아무것도 더 거르지 않는다.
  const incomplete =
    balances.length !== allocations.length ||
    balances.some((balance) => balance.custodyType !== 'PACKING' || balance.custodyRef !== packingRef) ||
    allocations.some(
      (allocation) =>
        attributedByGrain.get(`${allocation.shipmentLineId}|${allocation.sourceLocationId}`) !== allocation.qty,
    );
  return incomplete ? { ok: false, code: 'PICKING_PACKING_CUSTODY_INCOMPLETE' } : { ok: true };
}
