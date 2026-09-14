import {
  acceptsChanges,
  deriveHeaderStatus,
  isDerivationFrozen,
  lineReceivingProgress,
  outstandingQty,
  purchaseOrderExpectedArrival,
  LineSettlement,
} from './purchase-order-status.rules';

const ordered = (over: Partial<LineSettlement> = {}): LineSettlement => ({
  status: 'ordered',
  orderedQty: 10,
  receivedQty: 0,
  closedAt: null,
  ...over,
});
const requested: LineSettlement = { status: 'requested', orderedQty: null, receivedQty: 0, closedAt: null };
const unavailable: LineSettlement = { status: 'unavailable', orderedQty: null, receivedQty: 0, closedAt: null };

describe('관문 술어 (스펙 §5.3 4×2 표)', () => {
  it.each([
    ['created', true, false],
    ['confirmed', true, false],
    ['received', false, false],
    ['cancelled', false, true],
  ] as const)('%s → acceptsChanges=%s · isDerivationFrozen=%s', (status, accepts, frozen) => {
    expect(acceptsChanges(status)).toBe(accepts);
    expect(isDerivationFrozen(status)).toBe(frozen);
  });
});

describe('outstandingQty / lineReceivingProgress (§5.1)', () => {
  it('requested·unavailable 은 남은 수량 0, 입고 진행 없음', () => {
    expect(outstandingQty(requested)).toBe(0);
    expect(outstandingQty(unavailable)).toBe(0);
    expect(lineReceivingProgress(requested)).toBeNull();
    expect(lineReceivingProgress(unavailable)).toBeNull();
  });
  it('ordered 는 실발주 − 받은 누계', () => {
    expect(outstandingQty(ordered({ receivedQty: 3 }))).toBe(7);
    expect(lineReceivingProgress(ordered({ receivedQty: 3 }))).toBe('awaiting');
  });
  it('전량 입고 = 남은 수량 0', () => {
    expect(outstandingQty(ordered({ receivedQty: 10 }))).toBe(0);
    expect(lineReceivingProgress(ordered({ receivedQty: 10 }))).toBe('received');
  });
  it('잔량 포기는 받은 수와 무관하게 short_closed 이고 남은 수량 0', () => {
    const line = ordered({ receivedQty: 3, closedAt: new Date() });
    expect(outstandingQty(line)).toBe(0);
    expect(lineReceivingProgress(line)).toBe('short_closed');
  });
  it('orderedQty 가 null 인 ordered(CHECK 가 막지만)는 0 으로 — NULL 산술이 새지 않게', () => {
    expect(outstandingQty(ordered({ orderedQty: null }))).toBe(0);
  });
});

describe('deriveHeaderStatus (§5.2)', () => {
  it('requested 가 하나라도 있으면 created', () => {
    expect(deriveHeaderStatus([requested, ordered({ receivedQty: 10 })])).toBe('created');
  });
  it('받을 게 남았으면 confirmed', () => {
    expect(deriveHeaderStatus([ordered({ receivedQty: 3 }), unavailable])).toBe('confirmed');
  });
  it('전 라인이 unavailable 이면 confirmed (ordered 0)', () => {
    expect(deriveHeaderStatus([unavailable])).toBe('confirmed');
  });
  it('라인이 없으면 confirmed', () => {
    expect(deriveHeaderStatus([])).toBe('confirmed');
  });
  it('ordered ≥ 1 이고 남은 수량 있는 라인이 0 이면 received', () => {
    expect(deriveHeaderStatus([ordered({ receivedQty: 10 }), unavailable])).toBe('received');
  });
  it('전부 잔량 포기(받은 것 0 포함)여도 received — 「더 받을 것이 없다」', () => {
    expect(deriveHeaderStatus([ordered({ closedAt: new Date() })])).toBe('received');
  });
  it('received 에서 수령 취소로 남은 수량이 생기면 confirmed 로 돌아간다 (D10 역행)', () => {
    expect(deriveHeaderStatus([ordered({ receivedQty: 10 })])).toBe('received');
    expect(deriveHeaderStatus([ordered({ receivedQty: 0 })])).toBe('confirmed');
  });
});

describe('purchaseOrderExpectedArrival (§5.2 — 남은 수량이 있는 라인만)', () => {
  it('남은 수량이 있는 ordered 라인 중 가장 이른 날짜', () => {
    expect(
      purchaseOrderExpectedArrival([
        { ...ordered({ receivedQty: 10 }), expectedArrival: '2026-09-01' },
        { ...ordered(), expectedArrival: '2026-09-20' },
        { ...ordered(), expectedArrival: '2026-09-15' },
      ]),
    ).toEqual(new Date('2026-09-15T00:00:00.000Z'));
  });
  it('requested·unavailable·전량 입고·잔량 포기 라인의 날짜는 무시한다', () => {
    expect(
      purchaseOrderExpectedArrival([
        { ...requested, expectedArrival: '2026-09-01' },
        { ...unavailable, expectedArrival: '2026-09-02' },
        { ...ordered({ closedAt: new Date() }), expectedArrival: '2026-09-03' },
      ]),
    ).toBeNull();
  });
});
