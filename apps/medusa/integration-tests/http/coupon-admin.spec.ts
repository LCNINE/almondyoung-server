import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import { createPromotionsWorkflow } from '@medusajs/core-flows';
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

    it('메타 쓰기가 실패하면 프로모션이 롤백된다 (N7 — 워크플로 안으로 옮긴 이유)', async () => {
      const container = getContainer();
      const code = `ROLLBACK${seq}`;

      // HTTP validator 를 우회해 워크플로를 직접 돌린다 — 훅 안의 쓰기가 던졌을 때 앞 스텝이
      // 보상되는가만 본다. `visibility` 어휘 밖 값은 모듈 서비스 upsert 가 던진다.
      //
      // ⚠️ `.rejects.toThrow()` 를 쓰지 말 것. 워크플로 엔진을 거친 에러는 프로토타입을 잃어
      // **Error 인스턴스가 아닌 평범한 객체**로 온다(2026-08-31 실측: `instanceof Error === false`).
      // 그러면 jest 의 toThrow 가 「Received function did not throw」라는 엉뚱한 메시지로 실패해,
      // 롤백이 실제로 동작하는데도 구현 버그처럼 보인다.
      let caught: unknown = null;
      try {
        await createPromotionsWorkflow(container).run({
          input: {
            promotionsData: [
              {
                code,
                type: 'standard',
                status: 'active',
                application_method: { type: 'percentage', value: 10, target_type: 'order' },
              },
            ],
            additional_data: { visibility: 'bogus_value' },
          },
        } as any);
      } catch (e) {
        caught = e;
      }
      expect((caught as { message?: string } | null)?.message).toContain('Invalid visibility value');

      // 프로모션이 남아 있으면 안 된다. 남으면 그게 바로 «전체공개 활성 쿠폰» 이다.
      const promotionModule = container.resolve(Modules.PROMOTION);
      expect(await promotionModule.listPromotions({ code })).toHaveLength(0);
    });

    it('어휘 밖 visibility 는 400 이고 프로모션이 남지 않는다 (N7 회귀)', async () => {
      const code = `BADVIS${seq}`;
      const err = await api
        .post(
          '/admin/promotions',
          {
            code,
            type: 'standard',
            is_automatic: false,
            status: 'active',
            application_method: { type: 'percentage', value: 10, target_type: 'order' },
            additional_data: { visibility: 'bogus_value' },
          },
          adminHeaders,
        )
        .catch((e: any) => e);

      expect(err.response.status).toEqual(400);

      const promotionModule = getContainer().resolve(Modules.PROMOTION);
      expect(await promotionModule.listPromotions({ code })).toHaveLength(0);
    });

    it('상태 토글은 additional_data 없이도 200 이고 메타를 지우지 않는다', async () => {
      const id = await createPromo(`TOGGLE${seq}`, {
        visibility: 'assigned_only',
        name: '토글 대상',
      });

      const res = await api.post(`/admin/promotions/${id}`, { status: 'inactive' }, adminHeaders);
      expect(res.status).toEqual(200);

      const detail = await api.get(`/admin/promotions/${id}`, adminHeaders);
      expect(detail.data.promotion.metadata).toMatchObject({
        visibility: 'assigned_only',
        name: '토글 대상',
      });
    });

    it('유효기간 3키가 promotion_meta 에 저장되고 metadata 로 돌아온다 (Task 5)', async () => {
      const startsAt = '2026-09-01T00:00:00.000Z';
      const endsAt = '2026-09-30T00:00:00.000Z';
      const validityDays = 30;

      const promoId = await createPromo(`VALIDITY${seq}`, {
        visibility: 'claimable',
        starts_at: startsAt,
        ends_at: endsAt,
        validity_days: validityDays,
      });

      const res = await api.get(`/admin/promotions/${promoId}`, adminHeaders);
      expect(res.status).toEqual(200);
      expect(res.data.promotion.metadata).toMatchObject({
        visibility: 'claimable',
        starts_at: startsAt,
        ends_at: endsAt,
        validity_days: validityDays,
      });
    });
  },
});
