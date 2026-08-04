import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

jest.setTimeout(120 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  // 트리거 자동발급은 프로덕션 기본 OFF(COUPON_AUTO_ISSUE_ENABLED). 이 스펙은
  // 발급 메커니즘 자체를 검증하므로 플래그를 켜고 돌린다.
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  // 매 테스트 DB teardown 이 redis/BullMQ 커넥션을 닫아 async 워크플로와 레이스 →
  // teardown 을 끄고 테스트마다 고유 식별자로 격리한다.
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

    // 러너가 매 테스트 후 DB teardown → beforeEach 에서 admin/customer 를 새로 만든다.
    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@coupon.test` }]);
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const token = jwt.sign(
        { actor_id: user.id, actor_type: 'user', auth_identity_id: 'test-admin-auth', app_metadata: { user_id: user.id } },
        secret,
      );
      adminHeaders = { headers: { authorization: `Bearer ${token}` } };

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([
        { email: `buyer${seq}@coupon.test`, first_name: 'B', last_name: 'Uyer' },
      ]);
      customerId = cust.id;
    });

    const createPromo = async (
      code: string,
      additional_data: Record<string, unknown>,
      overrides: Record<string, unknown> = {},
    ) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data,
          ...overrides,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    const issue = (promotionIds: string[], force = false) =>
      api.post(`/admin/customers/${customerId}/promotions`, { promotion_ids: promotionIds, force }, adminHeaders);

    const skipReason = (res: any, id: string) =>
      res.data.skipped.find((s: any) => s.promotion_id === id)?.reason;

    const createGroupWithCustomer = async (): Promise<string> => {
      const customerModule = getContainer().resolve(Modules.CUSTOMER);
      const [group] = await customerModule.createCustomerGroups([{ name: `grp${seq}` }]);
      await customerModule.addCustomerToGroup({ customer_id: customerId, customer_group_id: group.id });
      return group.id;
    };

    const groupRule = (groupId: string) => ({
      rules: [{ attribute: 'customer.groups.id', operator: 'in', values: [groupId] }],
    });

    // status draft 로 만들면 fetch-back 이 404 → active 생성 후 컨테이너로 inactive 전환
    const makeInactive = async (id: string) => {
      const promotionModule = getContainer().resolve(Modules.PROMOTION);
      await promotionModule.updatePromotions([{ id, status: 'inactive' }]);
    };

    const linkedPromoIds = async (): Promise<string[]> => {
      const res = await api.get(`/admin/customers/${customerId}/promotions`, adminHeaders);
      return (res.data.promotions ?? []).map((p: any) => p.id);
    };

    it('creates a promotion with meta via admin API (status active + visibility)', async () => {
      const res = await api.post(
        '/admin/promotions',
        {
          code: 'SANITY10',
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data: { visibility: 'assigned_only', name: '테스트 쿠폰' },
        },
        adminHeaders,
      );
      expect(res.status).toEqual(200);
      expect(res.data.promotion?.status).toEqual('active');
    });

    it('auto-issues by trigger, is idempotent, and RE-ISSUES after revoke (P2-2 end-to-end)', async () => {
      const promoId = await createPromo('AUTO10', {
        visibility: 'assigned_only',
        auto_issue_trigger: 'customer_registered',
      });

      // 1) 트리거 발급
      const issue1 = await api.post(
        `/admin/customers/${customerId}/issue-coupons`,
        { trigger: 'customer_registered' },
        adminHeaders,
      );
      expect(issue1.data.issued.map((i: any) => i.promotion_id)).toContain(promoId);
      expect(await linkedPromoIds()).toContain(promoId);

      // 2) 재발급 시도 → 멱등(already_issued skip)
      const issue2 = await api.post(
        `/admin/customers/${customerId}/issue-coupons`,
        { trigger: 'customer_registered' },
        adminHeaders,
      );
      expect(issue2.data.skipped.map((s: any) => s.promotion_id)).toContain(promoId);
      expect(issue2.data.issued.map((i: any) => i.promotion_id)).not.toContain(promoId);

      // 3) 회수
      const revoke = await api.delete(`/admin/customers/${customerId}/promotions`, {
        ...adminHeaders,
        data: { promotion_ids: [promoId] },
      });
      expect(revoke.status).toEqual(200);
      expect(await linkedPromoIds()).not.toContain(promoId);

      // 4) 회수 후 트리거 → 재발급되어야 함 (issue-log 정리 검증, P2-2)
      const issue3 = await api.post(
        `/admin/customers/${customerId}/issue-coupons`,
        { trigger: 'customer_registered' },
        adminHeaders,
      );
      expect(issue3.data.issued.map((i: any) => i.promotion_id)).toContain(promoId);
      expect(await linkedPromoIds()).toContain(promoId);
    });

    it('manual assign is batch-resilient: invalid coupon is skipped, valid one issued (P1-3)', async () => {
      const validId = await createPromo('BATCHOK', { visibility: 'assigned_only' });
      const inactiveId = await createPromo('BATCHBAD', { visibility: 'assigned_only' });
      await makeInactive(inactiveId);

      const res = await api.post(
        `/admin/customers/${customerId}/promotions`,
        { promotion_ids: [validId, inactiveId] },
        adminHeaders,
      );
      expect(res.status).toEqual(200); // throw 아님
      expect(res.data.issued).toContain(validId);
      const inactiveSkip = res.data.skipped.find((s: any) => s.promotion_id === inactiveId);
      expect(inactiveSkip?.reason).toEqual('inactive');
    });

    it('force assign bypasses the inactive-status gate', async () => {
      const inactiveId = await createPromo('FORCEME', { visibility: 'assigned_only' });
      await makeInactive(inactiveId);
      const res = await issue([inactiveId], true);
      expect(res.data.issued).toContain(inactiveId);
    });

    it('skip reasons: automatic / not_started / expired / group_mismatch', async () => {
      const autoId = await createPromo('AUTOMATIC', { visibility: 'assigned_only' }, { is_automatic: true });
      const futureId = await createPromo('FUTURE', { visibility: 'assigned_only' }, {
        campaign: { name: 'f', campaign_identifier: `F_${seq}`, starts_at: '2999-01-01T00:00:00Z' },
      });
      const pastId = await createPromo('PAST', { visibility: 'assigned_only' }, {
        campaign: { name: 'p', campaign_identifier: `P_${seq}`, ends_at: '2000-01-01T00:00:00Z' },
      });
      const otherGroup = (await getContainer().resolve(Modules.CUSTOMER).createCustomerGroups([{ name: `other${seq}` }]))[0];
      const groupId = otherGroup.id;
      const restrictedId = await createPromo('RESTRICTED', { visibility: 'assigned_only' }, groupRule(groupId));

      const res = await issue([autoId, futureId, pastId, restrictedId]);
      expect(res.status).toEqual(200);
      expect(skipReason(res, autoId)).toEqual('automatic');
      expect(skipReason(res, futureId)).toEqual('not_started');
      expect(skipReason(res, pastId)).toEqual('expired');
      expect(skipReason(res, restrictedId)).toEqual('group_mismatch');
    });

    it('group rule: customer IN group is issued', async () => {
      const groupId = await createGroupWithCustomer();
      const promoId = await createPromo('INGROUP', { visibility: 'assigned_only' }, groupRule(groupId));
      const res = await issue([promoId]);
      expect(res.data.issued).toContain(promoId);
    });

    it('max_claims_exceeded once issued_count reaches the cap', async () => {
      const promoId = await createPromo('CAPPED', { visibility: 'claimable', max_claims: 1 });
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.reserveClaimSlot(promoId, 1); // 소진
      const res = await issue([promoId]);
      expect(skipReason(res, promoId)).toEqual('max_claims_exceeded');
    });

    it('revoke restores issued_count and clears issue-log (customers/:id/promotions path)', async () => {
      const promoId = await createPromo('REVOKE1', { visibility: 'claimable', max_claims: 5 });
      await issue([promoId]);
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      expect(Number((await metaService.getByPromotionId(promoId)).issued_count)).toEqual(1);
      expect(await metaService.isAlreadyIssued(customerId, promoId)).toBe(true);

      await api.delete(`/admin/customers/${customerId}/promotions`, { ...adminHeaders, data: { promotion_ids: [promoId] } });
      expect(Number((await metaService.getByPromotionId(promoId)).issued_count)).toEqual(0);
      expect(await metaService.isAlreadyIssued(customerId, promoId)).toBe(false);
    });

    it('revoke via promotions/:id/customers path also restores count + clears log', async () => {
      const promoId = await createPromo('REVOKE2', { visibility: 'claimable', max_claims: 5 });
      await issue([promoId]);
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;

      await api.delete(`/admin/promotions/${promoId}/customers`, { ...adminHeaders, data: { customer_ids: [customerId] } });
      expect(Number((await metaService.getByPromotionId(promoId)).issued_count)).toEqual(0);
      expect(await metaService.isAlreadyIssued(customerId, promoId)).toBe(false);
    });

    it('GET promotion exposes issued_count in metadata (P2-10)', async () => {
      const promoId = await createPromo('PROGRESS', { visibility: 'claimable', max_claims: 10 });
      await issue([promoId]);
      const res = await api.get(`/admin/promotions/${promoId}`, adminHeaders);
      expect(Number(res.data.promotion.metadata.issued_count)).toEqual(1);
      expect(Number(res.data.promotion.metadata.max_claims)).toEqual(10);
    });

    it('DELETE promotion purges issue-logs (P3-6)', async () => {
      const promoId = await createPromo('DELME', { visibility: 'assigned_only' });
      await issue([promoId]);
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      expect(await metaService.isAlreadyIssued(customerId, promoId)).toBe(true);

      await api.delete(`/admin/promotions/${promoId}`, adminHeaders);
      expect(await metaService.isAlreadyIssued(customerId, promoId)).toBe(false);
    });
  },
});
