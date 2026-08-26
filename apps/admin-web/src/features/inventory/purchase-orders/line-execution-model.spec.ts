import type { PurchaseOrderDto, PurchaseOrderLineDto } from '@/lib/types/dto/inventory';
import {
  buildOrderLinePayload,
  canExecuteLines,
  formatLineProgress,
  isLineExecutable,
  orderDialogDefaults,
  partitionLinesForEdit,
  sortLinesForExecution,
  summarizeLines,
  toCalendarDate,
} from './line-execution-model';

function line(overrides: Partial<PurchaseOrderLineDto> = {}): PurchaseOrderLineDto {
  return {
    skuId: 'sku-1',
    quantity: 10,
    status: 'requested',
    orderedQty: null,
    unitPrice: null,
    expectedArrival: null,
    orderedAt: null,
    orderedBy: null,
    unavailableReason: null,
    ...overrides,
  };
}

function po(overrides: Partial<PurchaseOrderDto> = {}): PurchaseOrderDto {
  return {
    id: 'po-1',
    type: 'domestic',
    supplierId: 'sup-1',
    expectedArrival: null,
    status: 'created',
    createdAt: '2026-08-26T00:00:00.000Z',
    updatedAt: '2026-08-26T00:00:00.000Z',
    lines: [],
    ...overrides,
  };
}

describe('summarizeLines / formatLineProgress', () => {
  it('상태별로 센다', () => {
    const progress = summarizeLines([
      line({ skuId: 'a', status: 'ordered' }),
      line({ skuId: 'b', status: 'unavailable' }),
      line({ skuId: 'c', status: 'requested' }),
    ]);

    expect(progress).toEqual({ total: 3, requested: 1, ordered: 1, unavailable: 1 });
  });

  it('불가가 있으면 진행 문구에 함께 적는다', () => {
    expect(formatLineProgress({ total: 5, requested: 1, ordered: 3, unavailable: 1 })).toBe(
      '3/5 실행 · 1 불가'
    );
  });

  it('불가가 없으면 실행분만 적는다', () => {
    expect(formatLineProgress({ total: 2, requested: 2, ordered: 0, unavailable: 0 })).toBe(
      '0/2 실행'
    );
  });

  it('라인이 없으면 그렇게 말한다', () => {
    expect(formatLineProgress({ total: 0, requested: 0, ordered: 0, unavailable: 0 })).toBe(
      '라인 없음'
    );
  });
});

describe('sortLinesForExecution', () => {
  it('아직 처리할 라인을 위로 올린다', () => {
    const sorted = sortLinesForExecution([
      line({ skuId: 'a', status: 'unavailable' }),
      line({ skuId: 'b', status: 'ordered' }),
      line({ skuId: 'c', status: 'requested' }),
    ]);

    expect(sorted.map((l) => l.skuId)).toEqual(['c', 'b', 'a']);
  });

  it('원본 배열을 건드리지 않는다', () => {
    const input = [line({ skuId: 'a', status: 'ordered' }), line({ skuId: 'b' })];
    sortLinesForExecution(input);
    expect(input.map((l) => l.skuId)).toEqual(['a', 'b']);
  });
});

describe('canExecuteLines / isLineExecutable', () => {
  it('received 발주는 라인 실행이 막힌다', () => {
    // core lockPurchaseOrderForLineExecution 이 BadRequestError 를 던진다.
    expect(canExecuteLines('received')).toBe(false);
    expect(canExecuteLines('created')).toBe(true);
    expect(canExecuteLines('confirmed')).toBe(true);
  });

  it('requested 라인만 실행 대상이다', () => {
    expect(isLineExecutable('created', line({ status: 'requested' }))).toBe(true);
    expect(isLineExecutable('created', line({ status: 'ordered' }))).toBe(false);
    expect(isLineExecutable('created', line({ status: 'unavailable' }))).toBe(false);
    expect(isLineExecutable('received', line({ status: 'requested' }))).toBe(false);
  });
});

describe('toCalendarDate / orderDialogDefaults', () => {
  it('ISO 타임스탬프에서 달력 날짜만 잘라낸다', () => {
    // new Date() 왕복이면 TZ 에 따라 하루가 밀린다 — 자르기만 한다.
    expect(toCalendarDate('2026-08-30T00:00:00.000Z')).toBe('2026-08-30');
    expect(toCalendarDate('2026-08-30')).toBe('2026-08-30');
    expect(toCalendarDate(null)).toBe('');
  });

  it('라인 값이 있으면 라인을 쓰고, 없으면 헤더 날짜로 떨어진다', () => {
    expect(
      orderDialogDefaults(po({ expectedArrival: '2026-09-01T00:00:00.000Z' }), line({ expectedArrival: '2026-08-30' }))
    ).toEqual({ orderedQty: '10', unitPrice: '', expectedArrival: '2026-08-30' });

    expect(
      orderDialogDefaults(po({ expectedArrival: '2026-09-01T00:00:00.000Z' }), line({ unitPrice: 3000 }))
    ).toEqual({ orderedQty: '10', unitPrice: '3000', expectedArrival: '2026-09-01' });
  });
});

describe('buildOrderLinePayload', () => {
  it('선택 항목이 비면 본문에서 뺀다', () => {
    expect(buildOrderLinePayload({ orderedQty: '6', unitPrice: '', expectedArrival: '' })).toEqual({
      ok: true,
      payload: { orderedQty: 6 },
    });
  });

  it('채워진 선택 항목은 숫자·문자열로 싣는다', () => {
    expect(
      buildOrderLinePayload({ orderedQty: '6', unitPrice: '2800', expectedArrival: '2026-08-30' })
    ).toEqual({ ok: true, payload: { orderedQty: 6, unitPrice: 2800, expectedArrival: '2026-08-30' } });
  });

  it('실발주 수량 0 은 거부한다 — 그건 불가 처리로 해야 한다', () => {
    // core: BadRequestError('orderedQty must be at least 1; use the unavailable action instead')
    expect(buildOrderLinePayload({ orderedQty: '0', unitPrice: '', expectedArrival: '' })).toEqual({
      ok: false,
      reason: '실발주 수량은 1 이상의 정수여야 합니다.',
    });
  });

  it('정수가 아닌 수량·단가를 거부한다', () => {
    expect(buildOrderLinePayload({ orderedQty: '1.5', unitPrice: '', expectedArrival: '' }).ok).toBe(false);
    expect(buildOrderLinePayload({ orderedQty: '3', unitPrice: '9.9', expectedArrival: '' }).ok).toBe(false);
  });

  it('YYYY-MM-DD 가 아닌 날짜를 거부한다', () => {
    // core 는 오프셋이 붙은 문자열을 IsCalendarDateConstraint 로 막는다. 화면도 같은 문을 세운다.
    expect(
      buildOrderLinePayload({ orderedQty: '3', unitPrice: '', expectedArrival: '2026-08-30T00:00:00+09:00' }).ok
    ).toBe(false);
  });
});

describe('partitionLinesForEdit', () => {
  it('종결된 라인은 편집 대상에서 뺀다', () => {
    // core updatePurchaseOrderLines 가 closedSkuIds 로 걸러내므로,
    // 폼에 실어 보내면 편집이 조용히 버려진다.
    const { editable, closed } = partitionLinesForEdit([
      line({ skuId: 'a', status: 'requested' }),
      line({ skuId: 'b', status: 'ordered' }),
      line({ skuId: 'c', status: 'unavailable' }),
    ]);

    expect(editable.map((l) => l.skuId)).toEqual(['a']);
    expect(closed.map((l) => l.skuId)).toEqual(['b', 'c']);
  });
});
