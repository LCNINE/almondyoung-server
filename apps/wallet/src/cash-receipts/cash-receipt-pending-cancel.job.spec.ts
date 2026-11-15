import { CashReceiptPendingCancelJob } from './cash-receipt-pending-cancel.job';

describe('CashReceiptPendingCancelJob', () => {
  it('서비스가 던져도 크론은 삼킨다 — 다음 주기가 다시 본다', async () => {
    const service = { resolvePendingCancels: jest.fn().mockRejectedValue(new Error('db down')) };
    await expect(new CashReceiptPendingCancelJob(service as never).run()).resolves.toBeUndefined();
  });
});
