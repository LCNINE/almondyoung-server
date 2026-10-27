import {
  hashReturnPrepay,
  prepaidTotal,
  prepayNote,
  readReturnPrepayRecord,
  RETURN_PREPAY_METADATA_KEY,
  type ReturnPrepayRecord,
} from '../return-prepay-record';

const valid = (): ReturnPrepayRecord => ({
  requestId: 'cr_1',
  requestHash: 'h',
  stage: 'requested',
  amount: 54000,
  itemValue: 60000,
  feeEstimate: { returnShipping: 3000, freeShippingBreak: 3000, roundTrip: 0 },
  memo: '고객 요청 선환불',
  requestedAt: '2026-10-27T00:00:00.000Z',
});
const meta = (r: unknown) => ({ [RETURN_PREPAY_METADATA_KEY]: r });

describe('readReturnPrepayRecord', () => {
  it('requested 기록이 왕복한다', () => {
    expect(readReturnPrepayRecord(meta(valid()))).toEqual(valid());
  });
  it('refunded 기록(refundedAt·refundMode)이 왕복한다', () => {
    const r: ReturnPrepayRecord = { ...valid(), stage: 'refunded', refundedAt: '2026-10-27T01:00:00.000Z', refundMode: 'manual' };
    expect(readReturnPrepayRecord(meta(r))).toEqual(r);
  });
  it('JSON 저장을 거쳐도 같다 — metadata 는 JSON 으로 저장된다', () => {
    const r: ReturnPrepayRecord = { ...valid(), stage: 'refunded', refundedAt: '2026-10-27T01:00:00.000Z', refundMode: 'auto' };
    expect(readReturnPrepayRecord(JSON.parse(JSON.stringify(meta(r))))).toEqual(r);
  });
  it('다른 기록(요청·정산)이 같은 metadata 에 있어도 선환불 기록만 읽는다', () => {
    expect(readReturnPrepayRecord({ ...meta(valid()), almondReturn: { x: 1 }, almondReturnSettlement: { y: 2 } })).toEqual(valid());
  });
  it.each([
    ['requestId 누락', { requestId: undefined }],
    ['requestId 빈 문자열', { requestId: '' }],
    ['requestHash 숫자', { requestHash: 1 }],
    ['stage 모름', { stage: 'charged' }],
    ['amount 문자열', { amount: '54000' }],
    ['amount NaN', { amount: Number.NaN }],
    ['itemValue 누락', { itemValue: undefined }],
    ['feeEstimate 한 칸 누락', { feeEstimate: { returnShipping: 3000, freeShippingBreak: 0 } }],
    ['feeEstimate 배열', { feeEstimate: [] }],
    ['memo 숫자', { memo: 1 }],
    ['requestedAt 누락', { requestedAt: undefined }],
    ['refundedAt 숫자', { refundedAt: 1 }],
    ['refundMode 숫자', { refundMode: 1 }],
  ])('칸 하나 어긋나면 null — %s', (_n, patch) => {
    expect(readReturnPrepayRecord(meta({ ...valid(), ...patch }))).toBeNull();
  });
  it('기록이 없거나 객체가 아니면 null', () => {
    expect(readReturnPrepayRecord(null)).toBeNull();
    expect(readReturnPrepayRecord({})).toBeNull();
    expect(readReturnPrepayRecord(meta(null))).toBeNull();
    expect(readReturnPrepayRecord(meta('x'))).toBeNull();
  });
});

describe('prepayNote', () => {
  it('return-prepay:<requestId>', () => {
    expect(prepayNote('cr_1')).toBe('return-prepay:cr_1');
  });
});

describe('hashReturnPrepay', () => {
  it('같은 입력은 같다', () => {
    expect(hashReturnPrepay('cr_1', 10000, 'm')).toBe(hashReturnPrepay('cr_1', 10000, 'm'));
  });
  it('requestId·금액·메모 중 하나가 다르면 다르다', () => {
    const h = hashReturnPrepay('cr_1', 10000, 'm');
    expect(hashReturnPrepay('cr_2', 10000, 'm')).not.toBe(h);
    expect(hashReturnPrepay('cr_1', 10001, 'm')).not.toBe(h);
    expect(hashReturnPrepay('cr_1', 10000, 'n')).not.toBe(h);
  });
  it('금액 없음(기본값)과 금액 지정은 다른 요청이다', () => {
    expect(hashReturnPrepay('cr_1', null, 'm')).not.toBe(hashReturnPrepay('cr_1', 0, 'm'));
  });
});

describe('prepaidTotal', () => {
  it('이 요청의 선환불 메모 환불만 합친다 — 다른 메모·다른 requestId 는 뺀다', () => {
    const refunds = [
      { amount: 24000, note: 'return-prepay:cr_1' },
      { amount: '6000', note: 'return-prepay:cr_1' },
      { amount: 5000, note: 'return-prepay:cr_2' },
      { amount: 7000, note: 'return-prepay:cr_10' },
      { amount: 8000, note: 'return-settle:cr_1' },
      { amount: 9000, note: 'wallet:abc' },
      { amount: 1000, note: null },
      { amount: 1000 },
    ];
    expect(prepaidTotal(refunds, 'cr_1')).toBe(30000);
  });
  it('없으면 0', () => {
    expect(prepaidTotal([], 'cr_1')).toBe(0);
  });
  it('금액을 못 읽으면 던진다 — 모르는 금액을 0 으로 두면 이중 환불이다', () => {
    expect(() => prepaidTotal([{ amount: 'x', note: 'return-prepay:cr_1' }], 'cr_1')).toThrow();
  });
});
