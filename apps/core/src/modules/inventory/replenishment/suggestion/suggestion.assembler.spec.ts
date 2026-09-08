import { assembleSuggestions } from './suggestion.assembler';
import { SkuStockInput } from './suggestion.types';

const SELL = 'wh-sell';
const CHINA = 'wh-china';
const LOC_A = 'loc-a';
const LOC_B = 'loc-b';

const L = (v: number) => ({ safetyStock: v, reorderPoint: v, targetLevel: v, leadTimeDays: 0 });

function sku(overrides: Partial<SkuStockInput> = {}): SkuStockInput {
  return {
    skuId: 'sku-1',
    skuCode: 'S1',
    skuName: 'sku one',
    supplier: { id: 'sup-1', name: 'supplier' },
    sourceWarehouseId: null,
    pattern: 'insufficient',
    grade: 'C',
    confidence: 'low',
    demand: { dailyMean: 0, dailyStd: 0 },
    legacyReorderPoint: 100,
    levels: { company: L(100), sellable: L(100) },
    parameterFlags: [],
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
    draftTransferPlanned: [],
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
      [sku({ onHandSellable: 0, onHandTotal: 200, nonSellableOnHand: [{ warehouseId: CHINA, locationId: LOC_A, qty: 200 }], draftTransferPlanned: [{ fromWarehouseId: CHINA, qty: 150 }] })],
      ctx,
    );
    expect(row.actions).toEqual([
      { type: 'transfer', qty: 50, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 50 }] },
    ]);
  });

  it('다른 비판매 창고의 draft 는 고른 출발 창고의 이동가능을 줄이지 않는다', () => {
    const [row] = assembleSuggestions(
      [
        sku({
          onHandSellable: 0,
          onHandTotal: 260,
          nonSellableOnHand: [
            { warehouseId: CHINA, locationId: LOC_A, qty: 200 },
            { warehouseId: 'wh-other', locationId: 'loc-o', qty: 60 },
          ],
          draftTransferPlanned: [{ fromWarehouseId: 'wh-other', qty: 60 }],
        }),
      ],
      ctx,
    );
    // 출발 창고는 가장 큰 로케이션이 속한 CHINA. wh-other 의 draft 60 은 무관 → 필요 100 전부 CHINA 에서
    expect(row.actions).toEqual([
      { type: 'transfer', qty: 100, fromWarehouseId: CHINA, toWarehouseId: SELL, lines: [{ fromLocationId: LOC_A, quantity: 100 }] },
    ]);
  });

  // 이 픽스처가 TODO ①(전 창고 draft 합) 의 회귀를 잡는 유일한 것이다. 다른 창고의 재고(100)가
  // 없으면 옛 로직의 오차가 「고른 창고에서 실제 채운 합」이라는 상한에 가려져 같은 답이 나온다 —
  // 그래서 여기서는 다른 창고에 재고를 두고 draft 를 «고른» 창고에 건다.
  // 전 창고 합 방식: 이동가능 = (200 + 100) − 150 = 150 → qty 100. 창고별 방식: 200 − 150 = 50.
  it('고른 출발 창고의 draft 만 뺀다 — 다른 창고 재고가 그 차감을 가리지 않는다', () => {
    const [row] = assembleSuggestions(
      [
        sku({
          onHandSellable: 0,
          onHandTotal: 300,
          nonSellableOnHand: [
            { warehouseId: CHINA, locationId: LOC_A, qty: 200 },
            { warehouseId: 'wh-other', locationId: 'loc-o', qty: 100 },
          ],
          draftTransferPlanned: [{ fromWarehouseId: CHINA, qty: 150 }],
        }),
      ],
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
          onHandSellable: 20,
          onHandTotal: 110,
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
        qty: 80,
        fromWarehouseId: CHINA,
        toWarehouseId: SELL,
        lines: [
          { fromLocationId: LOC_A, quantity: 60 },
          { fromLocationId: LOC_B, quantity: 20 },
        ],
      },
    ]);
  });

  // R46: 최대 로케이션 수량이 같으면 수량만으로는 순서가 안 정해지고, stable sort 가 입력(= ORDER BY
  // 없는 집계 질의의 DB 행) 순서를 그대로 남긴다 — 같은 재고에 다른 출발 창고가 나올 수 있었다.
  // 로케이션 id 타이브레이크가 그 갈라짐을 닫는다.
  it('최대 로케이션 수량이 같으면 로케이션 id 로 갈라 출발 창고가 입력 순서에 흔들리지 않는다', () => {
    const OTHER = 'wh-other';
    const china = { warehouseId: CHINA, locationId: LOC_A, qty: 50 };
    const other = { warehouseId: OTHER, locationId: LOC_B, qty: 50 };
    const plan = (nonSellableOnHand: SkuStockInput['nonSellableOnHand']) =>
      assembleSuggestions([sku({ onHandSellable: 0, onHandTotal: 100, nonSellableOnHand })], ctx)[0].actions;

    const expected = {
      type: 'transfer',
      qty: 50,
      fromWarehouseId: CHINA,
      toWarehouseId: SELL,
      lines: [{ fromLocationId: LOC_A, quantity: 50 }],
    };
    expect(plan([china, other])).toContainEqual(expected);
    expect(plan([other, china])).toContainEqual(expected);
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
    expect(row.flags).toEqual(['supplier_unknown']);
    expect(row.actions).toEqual([{ type: 'purchase', qty: 100, supplierId: null, sourceWarehouseId: null }]);
  });

  it('수준은 levels 를 그대로 쓰고, 플래그는 parameterFlags + supplier_unknown', () => {
    const [row] = assembleSuggestions(
      [sku({ levels: { company: { safetyStock: 5, reorderPoint: 30, targetLevel: 80, leadTimeDays: 32 }, sellable: { safetyStock: 2, reorderPoint: 12, targetLevel: 40, leadTimeDays: 5 } }, parameterFlags: ['default_lead_time', 'low_confidence'], supplier: null, sourceWarehouseId: 'wh-china', pattern: 'smooth', grade: 'A', confidence: 'normal', legacyReorderPoint: 320 })],
      ctx,
    );
    expect(row.company).toMatchObject({ safetyStock: 5, reorderPoint: 30, targetLevel: 80, leadTimeDays: 32 });
    expect(row.sellable).toMatchObject({ safetyStock: 2, reorderPoint: 12, targetLevel: 40, leadTimeDays: 5 });
    expect(row.flags).toEqual(['default_lead_time', 'low_confidence', 'supplier_unknown']);
    expect(row.actions).toEqual([{ type: 'purchase', qty: 80, supplierId: null, sourceWarehouseId: 'wh-china' }]);
    expect(row).toMatchObject({ pattern: 'smooth', grade: 'A', confidence: 'normal', legacyReorderPoint: 320 });
  });

  it('daysOfCover = 판매 IP ÷ 일평균 (소수 1자리), 일평균 0 이면 null', () => {
    const [withDemand] = assembleSuggestions([sku({ demand: { dailyMean: 3, dailyStd: 1 }, onHandSellable: 10, onHandTotal: 10 })], ctx);
    expect(withDemand.sellable.daysOfCover).toBe(3.3);
    const [noDemand] = assembleSuggestions([sku({ onHandSellable: 10, onHandTotal: 10 })], ctx);
    expect(noDemand.sellable.daysOfCover).toBeNull();
  });

  it('예상 커버 일수 오름차순, null 은 뒤, 동률은 코드순', () => {
    const rows = assembleSuggestions(
      [
        sku({ skuId: 'a', skuCode: 'A', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 80, onHandTotal: 80 }),
        sku({ skuId: 'b', skuCode: 'B', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 10, onHandTotal: 10 }),
        sku({ skuId: 'c', skuCode: 'C', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 40, onHandTotal: 40 }),
        sku({ skuId: 'd', skuCode: 'D', onHandSellable: 0, onHandTotal: 0 }),
        sku({ skuId: 'e', skuCode: 'E', demand: { dailyMean: 10, dailyStd: 0 }, onHandSellable: 40, onHandTotal: 40 }),
      ],
      ctx,
    );
    expect(rows.map((r) => r.skuId)).toEqual(['b', 'c', 'e', 'a', 'd']);
  });
});
