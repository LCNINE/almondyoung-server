import { assembleSuggestions } from './suggestion.assembler';
import { SkuStockInput } from './suggestion.types';

const SELL = 'wh-sell';
const CHINA = 'wh-china';
const LOC_A = 'loc-a';
const LOC_B = 'loc-b';

function sku(overrides: Partial<SkuStockInput> = {}): SkuStockInput {
  return {
    skuId: 'sku-1',
    skuCode: 'S1',
    skuName: 'sku one',
    supplier: { id: 'sup-1', name: 'supplier' },
    safetyStock: 100,
    lot: { moq: null, packingUnit: null },
    excluded: false,
    onHandTotal: 0,
    inTransferTotal: 0,
    reservedTotal: 0,
    onHandSellable: 0,
    reservedSellable: 0,
    nonSellableOnHand: [],
    onOrderTotal: 0,
    onOrderNonSellable: 0,
    inTransitToSellable: 0,
    draftTransferPlanned: 0,
    ...overrides,
  };
}

const ctx = { sellableWarehouseId: SELL };

describe('assembleSuggestions — 두 축 독립', () => {
  it('부천 부족 · 중국 有 → 이동만', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 20, onHandTotal: 220, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 200 }] })],
      ctx,
    );
    expect(row.actions).toEqual([
      { type: 'transfer', qty: 80, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 80 }] },
    ]);
    expect(row.company.position).toBe(220);
    expect(row.sellable.position).toBe(20);
  });

  it('부천 부족 · 중국 부족 → 이동(있는 만큼) + 발주(전사 부족분)', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 20, onHandTotal: 50, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 30 }] })],
      ctx,
    );
    expect(row.actions).toEqual([
      { type: 'purchase', qty: 50, supplierId: 'sup-1', sourceWarehouseId: null },
      { type: 'transfer', qty: 30, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 30 }] },
    ]);
  });

  it('부천 충분 · 전사 부족(예약이 크다) → 발주만', () => {
    // 전사 IP = 120 − 예약 50 = 70 < 100. 판매 IP = 120 − 50 = 70 < 100 이지만 중국이 0 → 이동 없음.
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 120, onHandTotal: 120, reservedSellable: 50, reservedTotal: 50 })],
      ctx,
    );
    expect(row.actions).toEqual([{ type: 'purchase', qty: 30, supplierId: 'sup-1', sourceWarehouseId: null }]);
  });

  it('둘 다 충분 → 행은 있되 actions 빈 배열', () => {
    const [row] = assembleSuggestions([sku({ onHandSellable: 150, onHandTotal: 150 })], ctx);
    expect(row.actions).toEqual([]);
  });
});

describe('assembleSuggestions — 재고 위치 재료', () => {
  it('전사 IP 는 ON_HAND + IN_TRANSFER + 발주잔량(전 창고) − 확정예약', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandTotal: 10, inTransferTotal: 20, onOrderTotal: 30, reservedTotal: 5 })],
      ctx,
    );
    expect(row.company).toMatchObject({ onHand: 10, inTransfer: 20, onOrder: 30, reserved: 5, position: 55 });
  });

  it('판매 IP 는 판매창고 ON_HAND − 예약 + 이동중 + 판매창고행 발주잔량', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 10, reservedSellable: 4, inTransitToSellable: 20, onOrderTotal: 30, onOrderNonSellable: 25 })],
      ctx,
    );
    expect(row.sellable).toMatchObject({ onHand: 10, reserved: 4, inTransit: 20, onOrderDirect: 5, position: 31 });
  });

  it('발주잔량이 전사 부족을 덮으면 발주 제안 없음', () => {
    const [row] = assembleSuggestions([sku({ onHandTotal: 10, onOrderTotal: 100 })], ctx);
    expect(row.actions.some((a) => a.type === 'purchase')).toBe(false);
  });
});

describe('assembleSuggestions — 이동 제안 세부', () => {
  it('draft 지시서에 실린 수량은 이동가능에서 뺀다', () => {
    const [row] = assembleSuggestions(
      [sku({ onHandSellable: 0, onHandTotal: 200, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 200 }], draftTransferPlanned: 150 })],
      ctx,
    );
    expect(row.actions).toEqual([
      { type: 'transfer', qty: 50, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 50 }] },
    ]);
  });

  it('로케이션이 여럿이면 큰 곳부터 채운다', () => {
    const [row] = assembleSuggestions(
      [
        sku({
          onHandSellable: 0,
          onHandTotal: 90,
          nonSellableOnHand: [
            { warehouseId: CHINA, locationId: LOC_B, qty: 30 },
            { warehouseId: CHINA, locationId: LOC_A, qty: 60 },
          ],
        }),
      ],
      ctx,
    );
    expect(row.actions).toEqual([
      {
        type: 'transfer',
        qty: 90,
        fromWarehouseId: CHINA,
        toWarehouseId: SELL,
        lines: [
          { fromLocationId: LOC_A, quantity: 60 },
          { fromLocationId: LOC_B, quantity: 30 },
        ],
      },
    ]);
  });

  it('이동량은 올리지 않는다 — 있는 만큼만', () => {
    const [row] = assembleSuggestions(
      [sku({ lot: { moq: 50, packingUnit: 12 }, onHandSellable: 0, onHandTotal: 7, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 7 }] })],
      ctx,
    );
    const transfer = row.actions.find((a) => a.type === 'transfer');
    expect(transfer).toMatchObject({ qty: 7 });
  });
});

describe('assembleSuggestions — 발주량 · 예외 · 플래그 · 정렬', () => {
  it('발주량은 MOQ · 상자 단위로 올린다', () => {
    const [row] = assembleSuggestions([sku({ lot: { moq: 50, packingUnit: 12 }, onHandTotal: 90 })], ctx);
    // 부족 10 → MOQ 50 → 상자 12 배수 → 60
    expect(row.actions).toEqual([{ type: 'purchase', qty: 60, supplierId: 'sup-1', sourceWarehouseId: null }]);
  });

  it('excluded 인 SKU 는 결과에서 빠진다', () => {
    expect(assembleSuggestions([sku({ excluded: true })], ctx)).toEqual([]);
  });

  it('공급사 미정이면 supplier_unknown 플래그, supplierId null', () => {
    const [row] = assembleSuggestions([sku({ supplier: null })], ctx);
    expect(row.flags).toEqual(expect.arrayContaining(['supplier_unknown', 'legacy_only']));
    expect(row.actions).toEqual([{ type: 'purchase', qty: 100, supplierId: null, sourceWarehouseId: null }]);
  });

  it('C 단계 자리표시: legacy_only · demand 0 · daysOfCover null · 세 수준이 같다', () => {
    const [row] = assembleSuggestions([sku()], ctx);
    expect(row.flags).toContain('legacy_only');
    expect(row.demand).toEqual({ dailyMean: 0, dailyStd: 0 });
    expect(row.sellable.daysOfCover).toBeNull();
    expect(row.company).toMatchObject({ safetyStock: 100, reorderPoint: 100, targetLevel: 100, leadTimeDays: 0 });
    expect(row.sellable).toMatchObject({ safetyStock: 100, reorderPoint: 100, targetLevel: 100, leadTimeDays: 0 });
    expect(row.legacyReorderPoint).toBe(100);
    expect(row.pattern).toBe('insufficient');
    expect(row.grade).toBe('C');
    expect(row.confidence).toBe('low');
  });

  it('판매창고 (위치 − 재주문점) 오름차순 — 가장 급한 것이 먼저', () => {
    const rows = assembleSuggestions(
      [
        sku({ skuId: 'a', onHandSellable: 80, onHandTotal: 80 }),
        sku({ skuId: 'b', onHandSellable: 10, onHandTotal: 10 }),
        sku({ skuId: 'c', onHandSellable: 40, onHandTotal: 40 }),
      ],
      ctx,
    );
    expect(rows.map((r) => r.skuId)).toEqual(['b', 'c', 'a']);
  });
});
