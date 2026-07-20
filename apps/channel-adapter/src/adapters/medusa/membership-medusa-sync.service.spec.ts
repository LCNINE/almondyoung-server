import { MembershipMedusaSyncService } from './membership-medusa-sync.service';
import type { MembershipStatusChangedPayload } from '@packages/event-contracts/streams/membership.stream';

describe('MembershipMedusaSyncService.handleMembershipStatusChanged', () => {
  const GROUP_ID = 'cusgroup_test';
  const USER_ID = 'user-1';

  function createService(params?: {
    byAlmondUserId?: { id: string; email: string } | null;
    byEmail?: { id: string; email: string } | null;
  }) {
    const medusaClient = {
      findCustomerByAlmondUserId: jest.fn().mockResolvedValue(params?.byAlmondUserId ?? null),
      findCustomerByEmail: jest.fn().mockResolvedValue(params?.byEmail ?? null),
      addCustomerToGroup: jest.fn().mockResolvedValue(undefined),
      removeCustomerFromGroup: jest.fn().mockResolvedValue(undefined),
      updateCustomerMetadata: jest.fn().mockResolvedValue(undefined),
      clearCustomerMetadataKey: jest.fn().mockResolvedValue(undefined),
      refreshCustomerCartPrices: jest.fn(),
      issuePromotionsByTrigger: jest.fn().mockResolvedValue(undefined),
    };
    const eventTracking = { trackEffect: jest.fn().mockResolvedValue(undefined) };
    const service = new MembershipMedusaSyncService(medusaClient as any, eventTracking as any);
    return { service, medusaClient };
  }

  const event = (email?: string): MembershipStatusChangedPayload =>
    ({
      userId: USER_ID,
      email,
      status: 'ACTIVE',
      occurredAt: '2026-07-20T08:43:39.000Z',
    }) as MembershipStatusChangedPayload;

  beforeEach(() => {
    process.env.MEDUSA_MEMBERSHIP_GROUP_ID = GROUP_ID;
  });

  it('이메일이 드리프트해도 almond_user_id 매칭 고객을 그룹에 추가한다', async () => {
    // user-service 이메일(cafe24 이관 등)과 Medusa 고객 이메일이 갈린 상태.
    // email fallback 은 아무도 못 찾지만, almond_user_id 매칭은 유효하다.
    const { service, medusaClient } = createService({
      byAlmondUserId: { id: 'cus_1', email: 'medusa@example.com' },
      byEmail: null,
    });

    const result = await service.handleMembershipStatusChanged(event('userservice@example.com'));

    expect(medusaClient.addCustomerToGroup).toHaveBeenCalledWith('cus_1', GROUP_ID);
    expect(result.success).toBe(true);
    // 유령이 아니므로 almond_user_id 를 떼면 안 된다
    expect(medusaClient.clearCustomerMetadataKey).not.toHaveBeenCalled();
  });

  it('진짜 유령 고객이면 email 로 찾은 고객을 쓰고 유령의 almond_user_id 를 제거한다', async () => {
    const { service, medusaClient } = createService({
      byAlmondUserId: { id: 'cus_ghost', email: 'old@example.com' },
      byEmail: { id: 'cus_real', email: 'current@example.com' },
    });

    await service.handleMembershipStatusChanged(event('current@example.com'));

    expect(medusaClient.addCustomerToGroup).toHaveBeenCalledWith('cus_real', GROUP_ID);
    expect(medusaClient.clearCustomerMetadataKey).toHaveBeenCalledWith(
      'cus_ghost',
      'almond_user_id',
    );
  });

  it('어느 경로로도 고객을 못 찾으면 throw 해서 inbox 가 재시도하게 한다', async () => {
    const { service } = createService({ byAlmondUserId: null, byEmail: null });

    await expect(
      service.handleMembershipStatusChanged(event('nobody@example.com')),
    ).rejects.toThrow(/Medusa customer not found/);
  });
});
