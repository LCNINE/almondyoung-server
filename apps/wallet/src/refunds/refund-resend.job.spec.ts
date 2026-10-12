import { RefundResendJob } from './refund-resend.job';

describe('RefundResendJob', () => {
  it('서비스에 지금 시각을 넘긴다', async () => {
    const service = { resendStuckAutoPending: jest.fn().mockResolvedValue({ scanned: 0, resent: 0 }) };
    await new RefundResendJob(service as never).run();
    expect(service.resendStuckAutoPending).toHaveBeenCalledWith(expect.any(Date));
  });

  it('서비스가 던져도 크론은 삼킨다 — 다음 주기가 다시 본다', async () => {
    const service = { resendStuckAutoPending: jest.fn().mockRejectedValue(new Error('db down')) };
    await expect(new RefundResendJob(service as never).run()).resolves.toBeUndefined();
  });
});
