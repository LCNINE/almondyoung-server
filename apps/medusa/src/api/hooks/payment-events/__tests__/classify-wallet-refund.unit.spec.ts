import { classifyWalletRefund } from '../classify-wallet-refund';

describe('classifyWalletRefund', () => {
  it('reasonCode 가 MEDUSA_REFUND 면 Medusa 가 낸 환불이다', () => {
    expect(classifyWalletRefund({ refundId: 'w1', reasonCode: 'MEDUSA_REFUND', knownWalletRefundIds: [] })).toBe('skip_medusa_originated');
  });
  it('reasonCode 가 없어도 provider 가 기록한 id 면 이미 장부에 있다(배포 겹침 창)', () => {
    expect(classifyWalletRefund({ refundId: 'w1', reasonCode: undefined, knownWalletRefundIds: ['w1'] })).toBe('skip_already_recorded');
  });
  it('둘 다 아니면 외부 환불로 기록한다', () => {
    expect(classifyWalletRefund({ refundId: 'w1', reasonCode: 'CUSTOMER_CANCEL', knownWalletRefundIds: [] })).toBe('record_external');
  });
  it('refundId 가 없는 옛 사실은 기록하지 않는다 — 같은 환불을 두 번 넣을 수 있다', () => {
    expect(classifyWalletRefund({ refundId: undefined, reasonCode: undefined, knownWalletRefundIds: [] })).toBe('skip_already_recorded');
  });
});
