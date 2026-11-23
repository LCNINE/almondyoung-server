import { bankName, manualRefundState } from './manual-refund';

type RefundDetail = Parameters<typeof manualRefundState>[0];

const pending: NonNullable<RefundDetail> = {
  refundRequested: true,
  refundCompleted: false,
  eligibleRefundAmount: 12000,
  hasPaymentIntent: true,
  manualRefundAccount: {
    bank: '92',
    accountNumber: '123456789',
    holderName: '테스트',
  },
  refundSettlement: null,
};

it('수동 송금 확인에는 계좌와 금액, 기록만 남긴다는 안내가 들어간다', () => {
  const state = manualRefundState(pending);

  expect(state.canComplete).toBe(true);
  expect(state.label).toBe('송금 완료 처리');
  expect(state.question).toContain(`${bankName('92')} 123456789 (테스트)`);
  expect(state.question).toContain('12,000원');
  expect(state.question).toContain('돈을 보내지 않고');
  expect(bankName('unknown')).toBe('unknown');
});

it.each([
  { refundCompleted: true },
  { refundRequested: false },
  { hasPaymentIntent: false },
  { refundSettlement: { alreadyRefundedAmount: 0, pendingRefundAmount: 1000 } },
])('완료하면 안 되는 상태에서는 버튼을 열지 않는다: %j', (change) => {
  expect(manualRefundState({ ...pending, ...change }).canComplete).toBe(false);
});

it('PG에서 이미 환불한 금액이 요청 금액 이상이면 추가 송금 없이 정리한다', () => {
  const state = manualRefundState({
    ...pending,
    refundSettlement: { alreadyRefundedAmount: 15000, pendingRefundAmount: 0 },
  });

  expect(state.canComplete).toBe(true);
  expect(state.label).toBe('완료로 정리');
  expect(state.question).toContain('15,000원');
  expect(state.question).toContain('추가 송금 없이');
});

it('일부만 환불됐으면 전액 환불로 단정하지 않는다', () => {
  expect(
    manualRefundState({
      ...pending,
      refundSettlement: { alreadyRefundedAmount: 1000, pendingRefundAmount: 0 },
    }).pgAlreadyRefunded
  ).toBe(false);
});

it('상세가 없으면 완료하지 않고, 이전 서버의 선택 필드 누락은 유지한다', () => {
  expect(manualRefundState(undefined).canComplete).toBe(false);
  expect(
    manualRefundState({ ...pending, hasPaymentIntent: undefined }).canComplete
  ).toBe(true);
});
