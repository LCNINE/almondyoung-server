/**
 * 넘겨받은 셀메이트 쿠팡 주문의 재고 되돌리기(#1245 스펙 §4.9) — DB 없는 판정만 고정한다.
 * DB 쓰기(applyStockDelta)는 sync-stock 과 같은 코드라 sync-stock 의 경로가 그대로 지킨다.
 */
import {
  blockers,
  buildAddBackPlan,
  classifyCoupangOrders,
  summarizeHandover,
  computeAddBack,
  parseCliArgs,
  parseCollectedAt,
} from './handover-stock-addback';
import { parseStockRows } from './sync-stock';

describe('computeAddBack — 다시 계산한 목표와 마지막 sync 목표의 차', () => {
  it('미발송에 잡힌 넘겨받은 수량만큼 되돌린다', () =>
    expect(computeAddBack({ current: 10, unshipped: 4, handedOver: 3 })).toBe(3));
  it('0 으로 잘렸던 품목은 실물만큼만 되돌린다', () =>
    expect(computeAddBack({ current: 3, unshipped: 5, handedOver: 5 })).toBe(3));
  it('넘겨받은 주문이 없으면 0', () => expect(computeAddBack({ current: 7, unshipped: 2, handedOver: 0 })).toBe(0));
  it('여전히 모자라면 0', () => expect(computeAddBack({ current: 2, unshipped: 6, handedOver: 1 })).toBe(0));
});

describe('parseStockRows — 현재재고·미발송주문수 원값', () => {
  it('목표(잘린 값)와 함께 원값을 돌려준다', () => {
    const rows = [
      ['옵션정보일련번호', '현재재고', '미발송주문수'],
      ['I1', '2', '5'],
      ['I2', '10', '4'],
    ];
    const { targets, counts } = parseStockRows(rows, 'f.xls', true);
    expect(targets).toEqual([
      { itemCode: 'I1', target: 0 },
      { itemCode: 'I2', target: 6 },
    ]);
    expect(counts).toEqual([
      { itemCode: 'I1', current: 2, unshipped: 5 },
      { itemCode: 'I2', current: 10, unshipped: 4 },
    ]);
  });
});

describe('parseCollectedAt', () => {
  it('offset 이 있으면 그대로 읽는다', () =>
    expect(parseCollectedAt('2026-11-20T09:30:00+09:00').toISOString()).toBe('2026-11-20T00:30:00.000Z'));
  it('Z 도 읽는다', () =>
    expect(parseCollectedAt('2026-11-20T00:30:00Z').toISOString()).toBe('2026-11-20T00:30:00.000Z'));
  it('offset 이 없으면 KST 로 읽는다', () =>
    expect(parseCollectedAt('2026-11-20T09:30').toISOString()).toBe('2026-11-20T00:30:00.000Z'));
  it('날짜만·이상한 값은 거절한다', () => {
    expect(() => parseCollectedAt('2026-11-20')).toThrow();
    expect(() => parseCollectedAt('어제 아침')).toThrow();
    expect(() => parseCollectedAt('2026-13-40T99:00:00Z')).toThrow();
  });
});

describe('classifyCoupangOrders — 15분 창', () => {
  const collectedAt = new Date('2026-11-20T00:30:00.000Z');
  const min = 60_000;
  const at = (offsetMs: number) => new Date(collectedAt.getTime() + offsetMs);
  const order = (id: string, orderDate: Date, createdAt = at(10 * 60 * min)) => ({ id, orderDate, createdAt });

  it('15분 넘게 이르면 넘겨받은 주문, 앞뒤 15분 안이면 사람이 확인, 15분 넘게 늦으면 제외', () => {
    const r = classifyCoupangOrders(
      [
        order('old', at(-3 * 60 * min)),
        order('just-over', at(-15 * min - 1)),
        order('edge-before', at(-15 * min)),
        order('near', at(2 * min)),
        order('edge-after', at(15 * min)),
        order('later', at(15 * min + 1)),
      ],
      collectedAt,
    );
    expect(r.handedOver.map((o) => o.id)).toEqual(['old', 'just-over']);
    expect(r.ambiguous.map((o) => o.id)).toEqual(['edge-before', 'near', 'edge-after']);
    expect(r.later.map((o) => o.id)).toEqual(['later']);
    expect(r.preexisting).toEqual([]);
  });

  it('셀메이트 마지막 수집보다 먼저 core 에 있던 주문은 우리 첫 수집이 아니다', () => {
    const r = classifyCoupangOrders([order('legacy', at(-3 * 60 * min), at(-60 * min))], collectedAt);
    expect(r.handedOver).toEqual([]);
    expect(r.preexisting.map((o) => o.id)).toEqual(['legacy']);
  });
});

describe('buildAddBackPlan', () => {
  const counts = [
    { itemCode: 'A', current: 10, unshipped: 4 },
    { itemCode: 'B', current: 3, unshipped: 5 },
    { itemCode: 'C', current: 7, unshipped: 1 },
  ];

  it('품목마다 되돌릴 양을 계산하고 0 인 품목도 표에 남긴다', () => {
    const plan = buildAddBackPlan(counts, [
      { skuId: 'sku-a', skuCode: 'A', quantity: 3 },
      { skuId: 'sku-b', skuCode: 'B', quantity: 5 },
    ]);
    expect(plan.rows).toEqual([
      { skuId: 'sku-a', skuCode: 'A', current: 10, unshipped: 4, handedOver: 3, addBack: 3 },
      { skuId: 'sku-b', skuCode: 'B', current: 3, unshipped: 5, handedOver: 5, addBack: 3 },
    ]);
    expect(plan.notInStockFile).toEqual([]);
    expect(plan.exceedsUnshipped).toEqual([]);
  });

  it('재고 파일에 없는 품목은 마지막 sync 가 안 건드렸으니 되돌리지 않고 따로 낸다', () => {
    const plan = buildAddBackPlan(counts, [{ skuId: 'sku-z', skuCode: 'Z', quantity: 2 }]);
    expect(plan.rows).toEqual([]);
    expect(plan.notInStockFile).toEqual([{ skuId: 'sku-z', skuCode: 'Z', quantity: 2 }]);
  });

  it('넘겨받은 수량이 미발송주문수보다 많으면 되돌리지 않고 사람이 확인할 목록에 낸다', () => {
    const plan = buildAddBackPlan(counts, [{ skuId: 'sku-c', skuCode: 'C', quantity: 2 }]);
    expect(plan.rows).toEqual([]);
    expect(plan.exceedsUnshipped).toEqual([
      { skuId: 'sku-c', skuCode: 'C', current: 7, unshipped: 1, handedOver: 2, addBack: 0 },
    ]);
  });
});

describe('parseCliArgs', () => {
  it('기본은 dry-run', () => {
    expect(parseCliArgs(['--stock=/x/stk.xls', '--sellmate-collected-at=2026-11-20T09:30:00+09:00'])).toEqual({
      stock: '/x/stk.xls',
      collectedAt: new Date('2026-11-20T00:30:00.000Z'),
      apply: false,
    });
  });
  it('--apply 일 때만 쓴다', () => {
    expect(parseCliArgs(['--stock=a.xls', '--sellmate-collected-at=2026-11-20T00:30:00Z', '--apply']).apply).toBe(true);
  });
  it('필수 인자가 없거나 모르는 인자면 거절한다', () => {
    expect(() => parseCliArgs(['--sellmate-collected-at=2026-11-20T00:30:00Z'])).toThrow(/--stock/);
    expect(() => parseCliArgs(['--stock=a.xls'])).toThrow(/--sellmate-collected-at/);
    expect(() => parseCliArgs(['--stock=a.xls', '--sellmate-collected-at=2026-11-20T00:30:00Z', '--aply'])).toThrow(
      /--aply/,
    );
  });
});

describe('summarizeHandover — FO 항목이 없는 라인', () => {
  const counts = [{ itemCode: 'A', current: 10, unshipped: 4 }];
  const foi = [{ skuId: 'sku-a', skuCode: 'A', quantity: 3 }];
  const line = (lineId: string, voidMatched: boolean, demand = 1) => ({
    channelOrderId: '9000000001',
    lineId,
    productName: 'fake',
    demand,
    voidMatched,
  });

  // core 는 void 매칭(재고 관리 안 하는 variant)을 {kind:'void'} 로 풀고 FO 항목을 만들지 않는다 — 이미 풀린 라인이다
  it('void 매칭 라인은 막지도 않고 수량을 더하지도 않는다 — 건너뛴 수만 센다', () => {
    const s = summarizeHandover(counts, foi, [line('void-1', true, 2)]);
    expect(s.unresolved).toEqual([]);
    expect(s.voidSkipped).toBe(1);
    expect(s.plan.rows).toEqual([
      { skuId: 'sku-a', skuCode: 'A', current: 10, unshipped: 4, handedOver: 3, addBack: 3 },
    ]);
    expect(blockers(s)).toEqual([]);
  });

  it('void 가 아닌데 FO 항목이 없는 라인은 SKU 를 모르니 막는다', () => {
    const s = summarizeHandover(counts, foi, [line('unmatched-1', false)]);
    expect(s.unresolved.map((l) => l.lineId)).toEqual(['unmatched-1']);
    expect(s.voidSkipped).toBe(0);
    expect(blockers(s)).toEqual(['FO 항목이 없는(SKU 를 모르는) 라인 1개']);
  });

  it('수요가 남지 않은 라인(출고 전 전량 취소)은 어느 쪽에도 세지 않는다', () => {
    const s = summarizeHandover(counts, foi, [line('canceled', false, 0), line('void-canceled', true, 0)]);
    expect(s.unresolved).toEqual([]);
    expect(s.voidSkipped).toBe(0);
  });
});
