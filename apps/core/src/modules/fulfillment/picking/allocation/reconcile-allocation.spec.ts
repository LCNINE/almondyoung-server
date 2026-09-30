import { reconcileAllocation, atSourceKey, ReconcileAllocationRow, ReconcileInput, ReconcilePlan } from './reconcile-allocation';
import { SourceCapacity } from './allocation.types';

const cap = (skuId: string, sourceLocationId: string, locationCode: string, remainingQty: number): SourceCapacity => ({
  skuId,
  sourceLocationId,
  locationCode,
  remainingQty,
  stockVersion: 1,
});
const row = (
  allocationId: string,
  sourceLocationId: string,
  locationCode: string,
  qty: number,
  attributedQty = 0,
  shipmentLineId = 'line-1',
  skuId = 'sku',
): ReconcileAllocationRow => ({ allocationId, shipmentLineId, skuId, sourceLocationId, locationCode, qty, attributedQty });
const base = (overrides: Partial<ReconcileInput>): ReconcileInput => ({
  workItemId: 'wi',
  targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: 0 }],
  allocations: [],
  atSource: new Map(),
  capacities: [],
  ...overrides,
});

describe('reconcileAllocation — 사건별', () => {
  it('합류(0 → 줄 수량)는 일반 가용에서 E8 로 배정한다 — 한 로케이션 전량 우선', () => {
    const plan = reconcileAllocation(
      base({
        targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: 2 }],
        capacities: [cap('sku', 'loc-a', 'A-01', 1), cap('sku', 'loc-b', 'B-01', 5)],
      }),
    );
    expect(plan).toEqual({
      handIns: [{ workItemId: 'wi', shipmentLineId: 'line-1', sourceLocationId: 'loc-b', qty: 2, sourceStockVersion: 1 }],
      handBacks: [],
      cartSurplus: [],
      excess: [],
      shortages: [],
    });
  });

  it('합류가 모자라면 배정 없이 모자란 줄과 사유를 돌려준다', () => {
    const plan = reconcileAllocation(
      base({
        targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: 3 }],
        capacities: [cap('sku', 'loc-a', 'A-01', 1)],
        inboundPendingBySku: new Map([['sku', 5]]),
      }),
    );
    expect(plan.handIns).toEqual([]);
    expect(plan.shortages).toEqual([
      { workItemId: 'wi', shipmentLineId: 'line-1', skuId: 'sku', requiredQty: 3, shortQty: 2, reason: 'INBOUND_PENDING' },
    ]);
  });

  it('이탈(→ 0)은 집지 않은 몫을 코드 역순으로 반납한다', () => {
    const plan = reconcileAllocation(
      base({
        allocations: [row('a1', 'loc-a', 'A-01', 1), row('a2', 'loc-b', 'B-01', 2)],
        atSource: new Map([
          [atSourceKey('sku', 'loc-a'), 5],
          [atSourceKey('sku', 'loc-b'), 5],
        ]),
      }),
    );
    expect(plan.handBacks).toEqual([
      { allocationId: 'a2', shipmentLineId: 'line-1', skuId: 'sku', sourceLocationId: 'loc-b', qty: 2 },
      { allocationId: 'a1', shipmentLineId: 'line-1', skuId: 'sku', sourceLocationId: 'loc-a', qty: 1 },
    ]);
    expect([plan.cartSurplus, plan.excess, plan.shortages, plan.handIns]).toEqual([[], [], [], []]);
  });

  it('집은 몫은 반납하지 않고 «뺄 물건»으로 남긴다', () => {
    const plan = reconcileAllocation(
      base({ allocations: [row('a1', 'loc-a', 'A-01', 3, 2)], atSource: new Map([[atSourceKey('sku', 'loc-a'), 1]]) }),
    );
    expect(plan.handBacks.map((d) => d.qty)).toEqual([1]);
    expect(plan.excess.map((d) => d.qty)).toEqual([2]);
  });

  it('미귀속 몫이 AT_SOURCE 에 없으면(토탈피킹 카트에 실림) 카트 여분이다', () => {
    const plan = reconcileAllocation(
      base({ allocations: [row('a1', 'loc-a', 'A-01', 3)], atSource: new Map([[atSourceKey('sku', 'loc-a'), 1]]) }),
    );
    expect(plan.handBacks.map((d) => d.qty)).toEqual([1]);
    expect(plan.cartSurplus.map((d) => d.qty)).toEqual([2]);
    expect(plan.excess).toEqual([]);
  });

  it('같은 (SKU, 로케이션) 의 두 줄은 AT_SOURCE 를 나눠 쓴다 — 합쳐서 넘지 않는다', () => {
    const plan = reconcileAllocation(
      base({
        targets: [
          { shipmentLineId: 'line-1', skuId: 'sku', targetQty: 0 },
          { shipmentLineId: 'line-2', skuId: 'sku', targetQty: 0 },
        ],
        allocations: [row('a1', 'loc-a', 'A-01', 2, 0, 'line-1'), row('a2', 'loc-a', 'A-01', 2, 0, 'line-2')],
        atSource: new Map([[atSourceKey('sku', 'loc-a'), 3]]),
      }),
    );
    expect(plan.handBacks.reduce((t, d) => t + d.qty, 0)).toBe(3);
    expect(plan.cartSurplus.reduce((t, d) => t + d.qty, 0)).toBe(1);
  });

  it('입력을 바꾸지 않고, 입력 순서가 달라도 같은 결과다', () => {
    const allocations = [row('a1', 'loc-a', 'A-01', 1), row('a2', 'loc-b', 'B-01', 2)];
    const atSource = new Map([
      [atSourceKey('sku', 'loc-a'), 1],
      [atSourceKey('sku', 'loc-b'), 1],
    ]);
    const frozen = JSON.stringify({ allocations, atSource: [...atSource] });
    const a = reconcileAllocation(base({ allocations, atSource }));
    const b = reconcileAllocation(base({ allocations: [...allocations].reverse(), atSource }));
    expect(a).toEqual(b);
    expect(JSON.stringify({ allocations, atSource: [...atSource] })).toBe(frozen);
  });
});

/**
 * 전수 열거(스펙 §14): 목표 0~3 × 로케이션 둘(A·B)의 배정 0~2·귀속 0~배정 × 공유 AT_SOURCE 0~2 × 늘릴 가용 0~3.
 * 피킹 방식은 입력이 아니다 — 방식의 차이는 «AT_SOURCE 가 미귀속 몫을 덮는가»로만 드러난다(개별·바구니 피킹은
 * 늘 덮고, 토탈피킹은 카트에 실린 만큼 모자란다). AT_SOURCE 를 0~2 로 돌리면 세 방식이 모두 들어온다.
 */
describe('reconcileAllocation — 전수 열거로 불변식', () => {
  type Case = { input: ReconcileInput; plan: ReconcilePlan };
  const cases: Case[] = [];
  for (let target = 0; target <= 3; target += 1)
    for (let qa = 0; qa <= 2; qa += 1)
      for (let pa = 0; pa <= qa; pa += 1)
        for (let qb = 0; qb <= 2; qb += 1)
          for (let pb = 0; pb <= qb; pb += 1)
            for (let sa = 0; sa <= 2; sa += 1)
              for (let sb = 0; sb <= 2; sb += 1)
                for (let capC = 0; capC <= 3; capC += 1) {
                  const input = base({
                    targets: [{ shipmentLineId: 'line-1', skuId: 'sku', targetQty: target }],
                    allocations: [row('a', 'loc-a', 'A-01', qa, pa), row('b', 'loc-b', 'B-01', qb, pb)],
                    atSource: new Map([
                      [atSourceKey('sku', 'loc-a'), sa],
                      [atSourceKey('sku', 'loc-b'), sb],
                    ]),
                    capacities: capC ? [cap('sku', 'loc-c', 'C-01', capC)] : [],
                  });
                  cases.push({ input, plan: reconcileAllocation(input) });
                }
  const sumOf = (rows: ReadonlyArray<{ qty: number }>) => rows.reduce((t, r) => t + r.qty, 0);
  const forRow = (rows: ReadonlyArray<{ allocationId: string; qty: number }>, id: string) =>
    sumOf(rows.filter((r) => r.allocationId === id));

  it('만든 사례가 충분하다', () => expect(cases.length).toBeGreaterThan(3000));

  it.each([
    ['출력 수량은 모두 양수', ({ plan }: Case) =>
      [...plan.handIns, ...plan.handBacks, ...plan.cartSurplus, ...plan.excess].every((e) => e.qty > 0)],
    ['반납 + 카트 여분 ≤ 그 행의 미귀속 몫', ({ input, plan }: Case) =>
      input.allocations.every(
        (r) => forRow(plan.handBacks, r.allocationId) + forRow(plan.cartSurplus, r.allocationId) <= r.qty - r.attributedQty,
      )],
    ['로케이션별 반납 합 ≤ 공유 AT_SOURCE', ({ input, plan }: Case) =>
      [...input.atSource].every(
        ([key, qty]) => sumOf(plan.handBacks.filter((d) => atSourceKey(d.skuId, d.sourceLocationId) === key)) <= qty,
      )],
    ['뺄 물건 ≤ 그 행의 귀속 보관', ({ input, plan }: Case) =>
      input.allocations.every((r) => forRow(plan.excess, r.allocationId) <= r.attributedQty)],
    ['적용 뒤 행마다 보관 ≤ 배정(I3)', ({ input, plan }: Case) =>
      input.allocations.every(
        (r) => r.qty - forRow(plan.handBacks, r.allocationId) - forRow(plan.cartSurplus, r.allocationId) >= r.attributedQty,
      )],
    ['모자람이 없으면 적용 뒤 배정 − 목표 = 뺄 물건(I2)', ({ input, plan }: Case) => {
      if (plan.shortages.length) return true;
      const after =
        sumOf(input.allocations) - sumOf(plan.handBacks) - sumOf(plan.cartSurplus) + sumOf(plan.handIns);
      return after - input.targets[0].targetQty === sumOf(plan.excess) && after >= input.targets[0].targetQty;
    }],
    ['모자라면 배정이 없고 0 < 모자란 양 ≤ 목표 − 현재 배정', ({ input, plan }: Case) => {
      if (!plan.shortages.length) return true;
      const short = sumOf(plan.shortages.map((s) => ({ qty: s.shortQty })));
      return plan.handIns.length === 0 && short > 0 && short <= input.targets[0].targetQty - sumOf(input.allocations);
    }],
    ['카트 여분은 그 로케이션 AT_SOURCE 를 다 쓴 뒤에만', ({ input, plan }: Case) =>
      plan.cartSurplus.every((d) => {
        const key = atSourceKey(d.skuId, d.sourceLocationId);
        return (input.atSource.get(key) ?? 0) - sumOf(plan.handBacks.filter((h) => atSourceKey(h.skuId, h.sourceLocationId) === key)) === 0;
      })],
    ['뺄 물건은 미귀속 몫을 다 줄인 뒤에만', ({ input, plan }: Case) =>
      !plan.excess.length ||
      input.allocations.every(
        (r) => forRow(plan.handBacks, r.allocationId) + forRow(plan.cartSurplus, r.allocationId) === r.qty - r.attributedQty,
      )],
    ['늘릴 때는 줄이지 않는다', ({ input, plan }: Case) =>
      input.targets[0].targetQty <= sumOf(input.allocations) ||
      (plan.handBacks.length === 0 && plan.cartSurplus.length === 0 && plan.excess.length === 0)],
  ])('%s', (_name, holds) => {
    const broken = cases.find((c) => !holds(c));
    expect(broken && { input: { ...broken.input, atSource: [...broken.input.atSource] }, plan: broken.plan }).toBeUndefined();
  });
});
