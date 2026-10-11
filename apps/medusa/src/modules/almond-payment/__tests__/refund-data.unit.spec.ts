import {
  judgeWalletRefund, readWalletRefundIds, withWalletRefundIds, readExternalRefund, withExternalRefund, withoutExternalRefund, readManualRefund, withManualRefund, withoutManualRefund,
} from '../refund-data';

describe('refund-data', () => {
  it('wallet 환불 id 는 중복 없이 쌓인다', () => {
    const d = withWalletRefundIds(withWalletRefundIds({ intentId: 'i' }, ['r1']), ['r1', 'r2']);
    expect(readWalletRefundIds(d)).toEqual(['r1', 'r2']);
    expect(d.intentId).toBe('i');
  });
  it('기록이 없거나 모양이 틀리면 빈 배열', () => {
    expect(readWalletRefundIds(undefined)).toEqual([]);
    expect(readWalletRefundIds({ walletRefundIds: 'x' })).toEqual([]);
  });
  it('외부 환불 표식을 쓰고 읽고 지운다', () => {
    const d = withExternalRefund({ intentId: 'i' }, { walletRefundId: 'r9', amount: 1000 });
    expect(readExternalRefund(d)).toEqual({ walletRefundId: 'r9', amount: 1000 });
    expect(readExternalRefund(withoutExternalRefund(d))).toBeNull();
    // 병합 갱신에서도 지워지도록 키는 남기고 값을 null 로 둔다
    expect(withoutExternalRefund(d)).toEqual({ intentId: 'i', externalRefund: null });
  });
  it('모양이 틀린 표식은 없는 것으로 본다', () => {
    expect(readExternalRefund({ externalRefund: { walletRefundId: 1 } })).toBeNull();
  });
});

describe('judgeWalletRefund — FAILED 행의 분류 (#1016 36번 재설계 §6.4)', () => {
  const failed = (retryable: boolean | null, extra: Record<string, unknown> = {}) => ({
    id: 'wr1',
    amount: 3000,
    status: 'FAILED',
    reasonCode: 'MEDUSA_REFUND',
    reasonMessage: '취소 할 수 없는 금액 입니다.',
    failureCode: 'NOT_CANCELABLE_AMOUNT',
    retryable,
    ...extra,
  });

  it('retryable false 인 FAILED 행이 있으면 그 코드·문장을 refusal 로 싣는다', () => {
    const v = judgeWalletRefund([failed(false)], 3000);
    expect(v.ok).toBe(false);
    expect(v.ok === false && v.refusal).toEqual({ code: 'NOT_CANCELABLE_AMOUNT', message: '취소 할 수 없는 금액 입니다.' });
  });

  it.each([null, true, undefined])('retryable 이 %p 면 refusal 이 없다(일시)', (retryable) => {
    const v = judgeWalletRefund([failed(retryable as boolean | null)], 3000);
    expect(v.ok === false && v.refusal).toBeUndefined();
  });

  it('여러 결제분 중 앞은 나가고 뒤가 영구 거절이면 refusal 과 moved 를 둘 다 싣는다', () => {
    const v = judgeWalletRefund([{ id: 'wr0', amount: 1000, status: 'SUCCEEDED' }, failed(false, { id: 'wr1', amount: 2000 })], 3000);
    expect(v.ok === false && v.moved).toEqual([{ id: 'wr0', amount: 1000, status: 'SUCCEEDED' }]);
    expect(v.ok === false && v.refusal?.code).toBe('NOT_CANCELABLE_AMOUNT');
  });

  it('failureCode·reasonMessage 가 비면 대체 문구로 채운다', () => {
    const v = judgeWalletRefund([failed(false, { failureCode: null, reasonMessage: null })], 3000);
    expect(v.ok === false && v.refusal).toEqual({ code: 'REFUND_FAILED', message: 'wallet 이 환불을 거절했습니다' });
  });
});

describe('수동 환불 표식 (#1016 36번 재설계 §6.3)', () => {
  it('쓰고 읽고, 지울 땐 키를 빼지 않고 null 로 쓴다 — Medusa 는 JSON 칸을 병합 갱신한다', () => {
    const data = withManualRefund({ intentId: 'i1' }, { requestId: 'channel-cancel:o1', amount: 5000 });
    expect(readManualRefund(data)).toEqual({ requestId: 'channel-cancel:o1', amount: 5000 });
    expect(withoutManualRefund(data)).toEqual({ intentId: 'i1', manualRefund: null });
    expect(readManualRefund(withoutManualRefund(data))).toBeNull();
  });

  it.each([undefined, null, 'x', {}, { requestId: 'r' }, { amount: 1 }, { requestId: 1, amount: 1 }])('모양이 다르면 없는 것으로 본다(%p)', (v) => {
    expect(readManualRefund({ manualRefund: v })).toBeNull();
  });
});
