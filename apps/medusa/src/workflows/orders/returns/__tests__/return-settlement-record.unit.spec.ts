import {
  assertNoReturnAwaitingCharge,
  assertReadableSettlementRecord,
  hashReturnSettlement,
  readReturnSettlementRecord,
  RETURN_SETTLEMENT_METADATA_KEY,
  type ReturnSettlementRecord,
} from '../return-settlement-record';

const valid = (): ReturnSettlementRecord => ({
  requestId: 'r1',
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
  chargeShippingOptionId: 'so_1',
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
  it('차감이 없으면 chargeShippingOptionId 는 null 로 읽는다', () => {
    const r = { ...valid(), chargeShippingOptionId: null };
    expect(readReturnSettlementRecord(meta(r))).toEqual(r);
  });
  it.each([
    ['chargeShippingOptionId 누락', { chargeShippingOptionId: undefined }],
    ['chargeShippingOptionId 숫자', { chargeShippingOptionId: 1 }],
    ['requestId 누락', { requestId: undefined }],
    ['requestId 빈 문자열', { requestId: '' }],
    ['stage 모름', { stage: 'x' }],
    ['owed 문자열', { owed: '1' }],
    ['deduction 한 칸 누락', { deduction: { returnShipping: 1, freeShippingBreak: 1 } }],
    ['items 한 줄 깨짐', { items: [{ itemId: 'i1', received: 1 }] }],
    ['groupFees 값 깨짐', { groupFees: { sp: 'a' } }],
    ['refundedAt 숫자', { refundedAt: 1 }],
  ])('모양이 어긋나면 null — %s', (_n, patch) => {
    expect(readReturnSettlementRecord(meta({ ...valid(), ...patch }))).toBeNull();
  });
  it('새 칸 없는 PR 6 기록이 그대로 읽힌다 — 새 칸이 생기지 않는다', () => {
    const pr6 = { ...valid(), stage: 'refunded', refundedAt: '2026-10-28T00:00:00.000Z', refundMode: 'auto' };
    const read = readReturnSettlementRecord(JSON.parse(JSON.stringify(meta(pr6))));
    expect(read).toEqual(pr6);
    for (const k of ['hold', 'prepaidApplied', 'externalRefundApplied', 'closesMissing']) expect(read).not.toHaveProperty(k);
    expect(read?.deduction).not.toHaveProperty('hold');
  });
  it('PR 6b 칸(보류 차감·상계·미도착 닫기)이 왕복한다', () => {
    const r: ReturnSettlementRecord = {
      ...valid(),
      deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0, hold: 2000 },
      hold: { requested: 5000, memo: '파손 확인' },
      prepaidApplied: 24000,
      externalRefundApplied: 1000,
      closesMissing: true,
    };
    expect(readReturnSettlementRecord(JSON.parse(JSON.stringify(meta(r))))).toEqual(r);
  });
  it.each([
    ['deduction.hold 문자열', { deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0, hold: '1' } }],
    ['hold 메모 누락', { hold: { requested: 1000 } }],
    ['hold 요청액 문자열', { hold: { requested: '1000', memo: 'x' } }],
    ['hold 가 객체 아님', { hold: 1000 }],
    ['prepaidApplied 문자열', { prepaidApplied: '1' }],
    ['externalRefundApplied NaN', { externalRefundApplied: Number.NaN }],
    ['closesMissing 문자열', { closesMissing: 'true' }],
  ])('새 칸이 있는데 모양이 어긋나면 null — %s', (_n, patch) => {
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
  it('환불액·차감이 소수면 던진다 — 정산 관측이 정수만 읽는다', () => {
    expect(() => assertReadableSettlementRecord({ ...valid(), refundAmount: 100.5 })).toThrow('정수');
    expect(() =>
      assertReadableSettlementRecord({ ...valid(), deduction: { returnShipping: 1.5, freeShippingBreak: 0, roundTrip: 0 } }),
    ).toThrow('정수');
  });
  it('보류 차감·상계 적용액이 소수면 던진다 — 정산 관측이 정수만 읽는다', () => {
    expect(() =>
      assertReadableSettlementRecord({ ...valid(), deduction: { returnShipping: 0, freeShippingBreak: 0, roundTrip: 0, hold: 0.5 } }),
    ).toThrow('정수');
    expect(() => assertReadableSettlementRecord({ ...valid(), prepaidApplied: 0.5 })).toThrow('정수');
    expect(() => assertReadableSettlementRecord({ ...valid(), externalRefundApplied: 0.5 })).toThrow('정수');
  });
  it('PR 6b 칸이 든 기록도 통과한다', () => {
    expect(() =>
      assertReadableSettlementRecord({
        ...valid(),
        deduction: { returnShipping: 3000, freeShippingBreak: 0, roundTrip: 0, hold: 2000 },
        hold: { requested: 2000, memo: 'm' },
        prepaidApplied: 0,
        externalRefundApplied: 0,
        closesMissing: false,
      }),
    ).not.toThrow();
  });
});
