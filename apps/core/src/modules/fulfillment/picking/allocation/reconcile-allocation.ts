import { AllocatableLine, AllocationDraft, allocateLines } from './allocate-lines';
import { LineShortage, SourceCapacity } from './allocation.types';

/** 목표 한 줄 — 이 작업 항목이 이 줄에 가져야 할 수량. 이탈이면 0. */
export interface ReconcileTarget {
  shipmentLineId: string;
  skuId: string;
  targetQty: number;
}

/** 이 작업 항목의 현재 배정 행 하나와 거기 귀속된 보관(집은 몫). */
export interface ReconcileAllocationRow {
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  locationCode: string;
  qty: number;
  /** 이 줄·로케이션에 귀속된 보관(WORKER·TOTE·SORTING·PACKING·PACKED·SETTLED) 합. 0 ≤ 이것 ≤ qty(I3). */
  attributedQty: number;
}

export interface AllocationDecrement {
  allocationId: string;
  shipmentLineId: string;
  skuId: string;
  sourceLocationId: string;
  qty: number;
}

export interface ReconcilePlan {
  /** 늘릴 몫 — 일반 가용에서 새로 배정하고 인계(HAND_IN). */
  handIns: AllocationDraft[];
  /** 집지 않은 몫 — AT_SOURCE 에서 빼고 배정도 뺀다(HAND_BACK). */
  handBacks: AllocationDecrement[];
  /** 미귀속인데 AT_SOURCE 에 없다 = 토탈피킹 카트에 이미 실렸다. 배정은 그대로 두고, 분류대에서 여분을 바구니에 넣을 때 준다(PR 3 계획이 정함 — S1 §5.4 의 «즉시 뺀다» 대체). */
  cartSurplus: AllocationDecrement[];
  /** 집은 몫이 목표를 넘는다 = «뺄 물건 남음»(I2). 배정은 그대로 두고 되돌림(PR 3)이 줄인다. */
  excess: AllocationDecrement[];
  /** 늘릴 몫을 못 채운 줄. 하나라도 있으면 handIns 는 비고, 호출자는 아무것도 적용하지 않는다. */
  shortages: LineShortage[];
}

export interface ReconcileInput {
  workItemId: string;
  targets: readonly ReconcileTarget[];
  allocations: readonly ReconcileAllocationRow[];
  /** 세션 공유 AT_SOURCE 잔량(키 `atSourceKey`). 배치의 모든 박스의 미집품 몫이 섞여 있다. */
  atSource: ReadonlyMap<string, number>;
  /** 늘릴 때만 쓴다 — 세션 통제분·적치 대기분을 뺀 로케이션별 일반 가용(`lockSkuCapacities`). */
  capacities: readonly SourceCapacity[];
  inboundPendingBySku?: ReadonlyMap<string, number>;
}

export const atSourceKey = (skuId: string, sourceLocationId: string): string => `${skuId}|${sourceLocationId}`;

const compare = (left: string, right: string) => (left < right ? -1 : left > right ? 1 : 0);
/** 채울 때는 코드 순(E8) — 줄일 때는 그 반대로, 마지막에 채운 곳부터 비운다. */
const byCodeDescending = (left: ReconcileAllocationRow, right: ReconcileAllocationRow) =>
  compare(right.locationCode, left.locationCode) || compare(right.allocationId, left.allocationId);

function assertInput(input: ReconcileInput): void {
  const lineIds = new Set(input.targets.map((target) => target.shipmentLineId));
  for (const target of input.targets) {
    if (!Number.isSafeInteger(target.targetQty) || target.targetQty < 0) {
      throw new Error(`reconcileAllocation: invalid target for line ${target.shipmentLineId}`);
    }
  }
  for (const row of input.allocations) {
    if (!lineIds.has(row.shipmentLineId)) throw new Error(`reconcileAllocation: allocation ${row.allocationId} has no target`);
    if (!(row.qty >= 0 && row.attributedQty >= 0 && row.attributedQty <= row.qty)) {
      throw new Error(`reconcileAllocation: allocation ${row.allocationId} violates 0 ≤ attributed ≤ qty`);
    }
  }
}

/**
 * 배정 증감의 단일 규칙(스펙 §5 원칙, S1 §5.1). 합류·이탈·결품·내용 변경이 모두 목표만 바꿔 이 함수를 부르고,
 * 실행부(`BoxAllocationManager`)는 결과를 잠금 아래에서 적용만 한다.
 *
 * 줄마다(줄 id 순):
 * - 목표 > 배정: 모자란 만큼을 모아 마지막에 `allocateLines` 한 번으로 채운다(E8). 모자라면 shortages.
 * - 목표 < 배정: 줄일 양을 세 단계로 나눈다. 행 순서는 로케이션 코드 역순.
 *   1) 집지 않은 몫(배정 − 귀속) 중 공유 AT_SOURCE 에 남은 만큼 → 반납(HAND_BACK)
 *   2) 그래도 남은 집지 않은 몫 → 카트 여분(누구 몫인지 모를 카트 물량이 이미 가져갔다)
 *   3) 그래도 남으면 집은 몫 → 뺄 물건(배정 유지)
 */
export function reconcileAllocation(input: ReconcileInput): ReconcilePlan {
  assertInput(input);
  const atSource = new Map(input.atSource);
  const handBacks: AllocationDecrement[] = [];
  const cartSurplus: AllocationDecrement[] = [];
  const excess: AllocationDecrement[] = [];
  const deficits: AllocatableLine[] = [];
  const decrement = (row: ReconcileAllocationRow, qty: number): AllocationDecrement => ({
    allocationId: row.allocationId,
    shipmentLineId: row.shipmentLineId,
    skuId: row.skuId,
    sourceLocationId: row.sourceLocationId,
    qty,
  });

  for (const target of [...input.targets].sort((left, right) => compare(left.shipmentLineId, right.shipmentLineId))) {
    const rows = input.allocations.filter((row) => row.shipmentLineId === target.shipmentLineId).sort(byCodeDescending);
    const allocated = rows.reduce((total, row) => total + row.qty, 0);
    if (target.targetQty > allocated) {
      deficits.push({
        id: target.shipmentLineId,
        skuId: target.skuId,
        qty: target.targetQty - allocated,
        workItemId: input.workItemId,
      });
      continue;
    }
    let reduce = allocated - target.targetQty;
    const unpicked = new Map(rows.map((row) => [row.allocationId, row.qty - row.attributedQty]));
    for (const row of rows) {
      if (reduce === 0) break;
      const key = atSourceKey(row.skuId, row.sourceLocationId);
      const qty = Math.min(reduce, unpicked.get(row.allocationId) ?? 0, atSource.get(key) ?? 0);
      if (qty <= 0) continue;
      handBacks.push(decrement(row, qty));
      atSource.set(key, (atSource.get(key) ?? 0) - qty);
      unpicked.set(row.allocationId, (unpicked.get(row.allocationId) ?? 0) - qty);
      reduce -= qty;
    }
    for (const row of rows) {
      if (reduce === 0) break;
      const qty = Math.min(reduce, unpicked.get(row.allocationId) ?? 0);
      if (qty <= 0) continue;
      cartSurplus.push(decrement(row, qty));
      unpicked.set(row.allocationId, (unpicked.get(row.allocationId) ?? 0) - qty);
      reduce -= qty;
    }
    for (const row of rows) {
      if (reduce === 0) break;
      const qty = Math.min(reduce, row.attributedQty);
      if (qty <= 0) continue;
      excess.push(decrement(row, qty));
      reduce -= qty;
    }
    // 세 단계의 합은 배정 합 = 줄일 양의 상한이라 여기 올 수 없다.
    if (reduce !== 0) throw new Error(`reconcileAllocation: could not account for line ${target.shipmentLineId}`);
  }

  const { drafts, shortages } = deficits.length
    ? allocateLines(deficits, input.capacities, input.inboundPendingBySku)
    : { drafts: [], shortages: [] };
  return { handIns: shortages.length ? [] : drafts, handBacks, cartSurplus, excess, shortages };
}
