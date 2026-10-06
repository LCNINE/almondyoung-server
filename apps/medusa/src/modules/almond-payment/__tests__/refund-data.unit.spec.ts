import {
  readWalletRefundIds, withWalletRefundIds, readExternalRefund, withExternalRefund, withoutExternalRefund,
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
  });
  it('모양이 틀린 표식은 없는 것으로 본다', () => {
    expect(readExternalRefund({ externalRefund: { walletRefundId: 1 } })).toBeNull();
  });
});
