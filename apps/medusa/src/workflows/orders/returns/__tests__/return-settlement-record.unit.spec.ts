import {
  assertNoReturnAwaitingCharge,
  assertReadableSettlementRecord,
  hashReturnSettlement,
  readReturnSettlementRecord,
  RETURN_SETTLEMENT_METADATA_KEY,
  type ReturnSettlementRecord,
} from '../return-settlement-record';

const valid = (): ReturnSettlementRecord => ({
  requestHash: 'h',
  stage: 'received',
  items: [{ itemId: 'i1', received: 1, dismissed: 0 }],
  owed: 30000,
  deduction: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
  feeNotAdjusted: false,
  refundAmount: 24000,
  groupFees: { sp: 3000 },
  orderVersion: 3,
  receivedAt: '2026-10-27T00:00:00.000Z',
});
const meta = (r: unknown) => ({ [RETURN_SETTLEMENT_METADATA_KEY]: r });

describe('readReturnSettlementRecord', () => {
  it('정상 기록을 읽는다', () => {
    expect(readReturnSettlementRecord(meta(valid()))).toEqual(valid());
  });
  it('refundedAt·refundMode 는 있으면 그대로 읽는다', () => {
    const r = { ...valid(), stage: 'refunded', refundedAt: '2026-10-28T00:00:00.000Z', refundMode: 'auto' };
    expect(readReturnSettlementRecord(meta(r))).toEqual(r);
  });
  it.each([
    ['stage 모름', { stage: 'x' }],
    ['owed 문자열', { owed: '1' }],
    ['deduction 한 칸 누락', { deduction: { returnShipping: 1, freeShippingBreak: 1 } }],
    ['items 한 줄 깨짐', { items: [{ itemId: 'i1', received: 1 }] }],
    ['groupFees 값 깨짐', { groupFees: { sp: 'a' } }],
    ['refundedAt 숫자', { refundedAt: 1 }],
  ])('모양이 어긋나면 null — %s', (_n, patch) => {
    expect(readReturnSettlementRecord(meta({ ...valid(), ...patch }))).toBeNull();
  });
  it('기록이 없거나 객체가 아니면 null', () => {
    expect(readReturnSettlementRecord(null)).toBeNull();
    expect(readReturnSettlementRecord({})).toBeNull();
    expect(readReturnSettlementRecord(meta('x'))).toBeNull();
  });
});

describe('hashReturnSettlement', () => {
  const items = [
    { itemId: 'b', received: 1, dismissed: 0 },
    { itemId: 'a', received: 0, dismissed: 2 },
  ];
  it('품목 순서와 무관하다', () => {
    expect(hashReturnSettlement('r1', items)).toBe(hashReturnSettlement('r1', [...items].reverse()));
  });
  it('수령·폐기 나눔이 다르면 다르다', () => {
    expect(hashReturnSettlement('r1', items)).not.toBe(
      hashReturnSettlement('r1', [{ itemId: 'b', received: 0, dismissed: 1 }, items[1]]),
    );
  });
  it('requestId 가 다르면 다르다 — 반품 하나에 정산 요청 하나', () => {
    expect(hashReturnSettlement('r1', items)).not.toBe(hashReturnSettlement('r2', items));
  });
});

describe('assertNoReturnAwaitingCharge', () => {
  const rec = (stage: ReturnSettlementRecord['stage']): ReturnSettlementRecord => ({ ...valid(), stage });
  it('received 기록이 하나라도 있으면 일반 Error(500 → 재시도)로 막는다', () => {
    let err: unknown;
    try {
      assertNoReturnAwaitingCharge([rec('refunded'), rec('received')]);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect(Object.getPrototypeOf(err)).toBe(Error.prototype);
  });
  it('charged·refunded 만 있거나 없으면 통과', () => {
    expect(() => assertNoReturnAwaitingCharge([])).not.toThrow();
    expect(() => assertNoReturnAwaitingCharge([rec('charged'), rec('refunded')])).not.toThrow();
  });
});

describe('assertReadableSettlementRecord', () => {
  it('읽기가 받아 주는 기록은 통과, 아니면 던진다 — 쓰고 나서 겹치기가 조용히 버리지 않게', () => {
    expect(() => assertReadableSettlementRecord(valid())).not.toThrow();
    expect(() => assertReadableSettlementRecord({ ...valid(), owed: Number.NaN })).toThrow();
  });
});
