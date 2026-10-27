import { readReturnSettlementRecord, RETURN_SETTLEMENT_METADATA_KEY } from '../return-settlement-record';

const valid = () => ({
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
