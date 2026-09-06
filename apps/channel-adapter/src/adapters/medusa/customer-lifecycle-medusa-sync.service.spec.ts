import { CustomerLifecycleMedusaSyncService } from './customer-lifecycle-medusa-sync.service';
import { SlowRetryInboxError } from './slow-retry.error';

describe('CustomerLifecycleMedusaSyncService (#786)', () => {
  const USER_ID = '3f9a1c2e-1111-4222-8333-444455556666';

  function createService(params?: {
    customer?: { id: string; email: string } | null;
    withdrawOutcome?: { customer: 'anonymized' | 'not_found'; auth_identities_deleted: number };
    withdrawError?: Error;
    updateError?: Error;
  }) {
    const medusaClient = {
      findCustomerByAlmondUserId: jest.fn().mockResolvedValue(params?.customer ?? null),
      updateCustomerEmail: params?.updateError
        ? jest.fn().mockRejectedValue(params.updateError)
        : jest.fn().mockResolvedValue(undefined),
      withdrawCustomer: params?.withdrawError
        ? jest.fn().mockRejectedValue(params.withdrawError)
        : jest.fn().mockResolvedValue(params?.withdrawOutcome ?? { customer: 'anonymized', auth_identities_deleted: 1 }),
    };
    const eventTracking = { trackEffect: jest.fn().mockResolvedValue(undefined) };
    const service = new CustomerLifecycleMedusaSyncService(medusaClient as any, eventTracking as any);
    return { service, medusaClient, eventTracking };
  }

  describe('handleUserUpdated', () => {
    it('고객이 있고 이메일이 다르면 갱신하고 SYNCED effect 를 남긴다', async () => {
      const { service, medusaClient, eventTracking } = createService({ customer: { id: 'cus_1', email: 'old@example.com' } });

      const result = await service.handleUserUpdated({ userId: USER_ID, email: 'new@example.com' });

      expect(medusaClient.updateCustomerEmail).toHaveBeenCalledWith('cus_1', 'new@example.com');
      expect(result).toEqual({ success: true, data: { userId: USER_ID, action: 'synced' } });
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'MedusaCustomer', resourceId: 'cus_1', action: 'SYNCED', eventType: 'UserUpdated' }),
      );
    });

    it('이메일이 이미 같으면 아무것도 부르지 않고 skipped', async () => {
      const { service, medusaClient } = createService({ customer: { id: 'cus_1', email: 'same@example.com' } });

      const result = await service.handleUserUpdated({ userId: USER_ID, email: 'same@example.com' });

      expect(medusaClient.updateCustomerEmail).not.toHaveBeenCalled();
      expect(result.data.action).toBe('skipped');
    });

    it('고객이 없으면 SKIPPED effect 후 skipped — 첫 로그인 때 현재 이메일로 생성되므로 기다리지 않는다', async () => {
      const { service, eventTracking } = createService({ customer: null });

      const result = await service.handleUserUpdated({ userId: USER_ID, email: 'new@example.com' });

      expect(result.data.action).toBe('skipped');
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(
        expect.objectContaining({ resourceType: 'UserAccount', resourceId: USER_ID, action: 'SKIPPED' }),
      );
    });

    it('갱신 실패는 그대로 전파한다 — inbox 가 재시도/failed 를 판단한다', async () => {
      const { service } = createService({ customer: { id: 'cus_1', email: 'old@example.com' }, updateError: new Error('dup') });

      await expect(service.handleUserUpdated({ userId: USER_ID, email: 'taken@example.com' })).rejects.toThrow('dup');
    });
  });

  describe('handleUserDeleted', () => {
    it('anonymized 면 SYNCED effect 와 synced', async () => {
      const { service, medusaClient, eventTracking } = createService({
        withdrawOutcome: { customer: 'anonymized', auth_identities_deleted: 2 },
      });

      const result = await service.handleUserDeleted({ userId: USER_ID });

      expect(medusaClient.withdrawCustomer).toHaveBeenCalledWith(USER_ID);
      expect(result).toEqual({ success: true, data: { userId: USER_ID, action: 'synced' } });
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(
        expect.objectContaining({
          resourceType: 'UserAccount',
          resourceId: USER_ID,
          action: 'SYNCED',
          eventType: 'UserDeleted',
          description: expect.stringContaining('auth_identities_deleted=2'),
        }),
      );
    });

    it('not_found 면 SKIPPED effect 와 skipped — 한 번도 로그인 안 한 회원, 재시도 없음', async () => {
      const { service, eventTracking } = createService({
        withdrawOutcome: { customer: 'not_found', auth_identities_deleted: 0 },
      });

      const result = await service.handleUserDeleted({ userId: USER_ID });

      expect(result.data.action).toBe('skipped');
      expect(eventTracking.trackEffect).toHaveBeenCalledWith(expect.objectContaining({ action: 'SKIPPED' }));
    });

    it('Medusa 실패는 그대로 전파하되 절대 SlowRetryInboxError 로 바꾸지 않는다', async () => {
      const { service } = createService({ withdrawError: new Error('Medusa withdrawCustomer failed (status=503)') });

      const promise = service.handleUserDeleted({ userId: USER_ID });

      await expect(promise).rejects.toThrow('status=503');
      await expect(promise).rejects.not.toBeInstanceOf(SlowRetryInboxError);
    });
  });

  it('effect 기록 실패는 결과를 바꾸지 않는다', async () => {
    const { service, eventTracking } = createService({ customer: { id: 'cus_1', email: 'old@example.com' } });
    eventTracking.trackEffect.mockRejectedValueOnce(new Error('tracking down'));

    const result = await service.handleUserUpdated({ userId: USER_ID, email: 'new@example.com' });

    expect(result.data.action).toBe('synced');
  });
});
