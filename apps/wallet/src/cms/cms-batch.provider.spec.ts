import { CmsBatchProvider } from './cms-batch.provider';

// W5: CMS cancel() 멱등/상태 가드 단위 테스트.
// providerData.transactionId 를 직접 넘겨 getTransactionId DB 조회를 우회한다.

function makeProvider(withdrawalStatus: string | null) {
  const limit = jest.fn().mockResolvedValue(withdrawalStatus ? [{ status: withdrawalStatus }] : []);
  const db = {
    select: jest.fn().mockReturnThis(),
    from: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    limit,
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
  };
  const cmsApi = { deleteWithdrawal: jest.fn() };
  const provider = new CmsBatchProvider(
    { db } as never,
    cmsApi as never,
    {} as never,
    {} as never,
  );
  return { provider, cmsApi, db };
}

const params = {
  chargeId: 'charge-1',
  intentId: 'intent-1',
  paymentMethodId: 'pm-1',
  userId: 'user-1',
  amount: 29900,
  currency: 'KRW',
  providerData: { transactionId: 'txn-1' },
} as never;

describe('CmsBatchProvider.cancel (W5 idempotency/state guard)', () => {
  it('returns SUCCEEDED idempotently for an already-DELETED withdrawal without calling 효성', async () => {
    const { provider, cmsApi } = makeProvider('DELETED');
    const res = await provider.cancel(params);
    expect(res.status).toBe('SUCCEEDED');
    expect(cmsApi.deleteWithdrawal).not.toHaveBeenCalled();
  });

  it('refuses to cancel an already-settled (SUCCEEDED) withdrawal', async () => {
    const { provider, cmsApi } = makeProvider('SUCCEEDED');
    const res = await provider.cancel(params);
    expect(res.status).toBe('FAILED');
    expect(res.errorCode).toBe('CMS_ALREADY_SETTLED');
    expect(cmsApi.deleteWithdrawal).not.toHaveBeenCalled();
  });

  it('calls 효성 deleteWithdrawal and succeeds for a REQUESTED withdrawal', async () => {
    const { provider, cmsApi, db } = makeProvider('REQUESTED');
    cmsApi.deleteWithdrawal.mockResolvedValue({ ok: true });
    const res = await provider.cancel(params);
    expect(cmsApi.deleteWithdrawal).toHaveBeenCalledWith('txn-1');
    expect(res.status).toBe('SUCCEEDED');
    expect(db.update).toHaveBeenCalled(); // marked DELETED
  });

  it('returns FAILED when 효성 deleteWithdrawal is rejected (마감 후 등)', async () => {
    const { provider, cmsApi } = makeProvider('REQUESTED');
    cmsApi.deleteWithdrawal.mockResolvedValue({ ok: false, error: { code: 'CMS_CUTOFF', message: '마감 후' } });
    const res = await provider.cancel(params);
    expect(res.status).toBe('FAILED');
    expect(res.errorCode).toBe('CMS_CUTOFF');
  });
});
