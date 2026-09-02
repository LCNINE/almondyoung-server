import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

jest.setTimeout(120 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let storeHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

    const svc = () => getContainer().resolve(PROMOTION_META_MODULE) as any;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@grant.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'test-admin-auth', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      // publishable key (store 라우트 필수 헤더 — coupon-store.spec.ts·coupon-issuance-rules.spec.ts 관례)
      const pk = await api.post('/admin/api-keys', { title: `pk${seq}`, type: 'publishable' }, adminHeaders);
      const pkToken = pk.data.api_key.token;

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([
        { email: `buyer${seq}@grant.test`, first_name: 'B', last_name: 'Uyer' },
      ]);
      customerId = cust.id;
      storeHeaders = {
        headers: {
          'x-publishable-api-key': pkToken,
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            secret,
          )}`,
        },
      };
    });

    /** 쿠폰 하나를 만든다. `additional_data` 로 visibility·발급창·수량한도를 준다. */
    const createPromo = async (code: string, additional_data: Record<string, unknown>) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    /** 관리자 수동 발급. `submitId` 를 명시해 멱등성을 검사할 수 있게 한다. */
    const issue = (promotionId: string, submitId: string, quantity = 1) =>
      api.post(
        `/admin/customers/${customerId}/promotions`,
        { promotion_ids: [promotionId], submit_id: submitId, quantity },
        adminHeaders,
      );

    describe('여러 장과 멱등성', () => {
      it('G1: 같은 고객에게 같은 쿠폰 2장이 발급된다', async () => {
        const promotionId = await createPromo(`G1${seq}`, { visibility: 'assigned_only' });

        await issue(promotionId, 'sub-a');
        await issue(promotionId, 'sub-b');

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
      });

      it('G2: 같은 submit_id 로 두 번 보내면 한 장이다 — 따닥', async () => {
        const promotionId = await createPromo(`G2${seq}`, { visibility: 'assigned_only' });

        const first = await issue(promotionId, 'sub-same');
        const second = await issue(promotionId, 'sub-same');

        expect(first.status).toBe(200);
        expect(second.status).toBe(200);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(1);
      });

      it('quantity 만큼 한 번에 발급된다', async () => {
        const promotionId = await createPromo(`GQ${seq}`, { visibility: 'assigned_only' });

        await issue(promotionId, 'sub-q', 3);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(3);
      });

      it('G4: 트리거 자동발급을 두 번 불러도 한 장이다', async () => {
        const promotionId = await createPromo(`G4${seq}`, {
          visibility: 'assigned_only',
          auto_issue_trigger: 'customer_registered',
        });
        const body = { trigger: 'customer_registered' };

        await api.post(`/admin/customers/${customerId}/issue-coupons`, body, adminHeaders);
        await api.post(`/admin/customers/${customerId}/issue-coupons`, body, adminHeaders);

        const grants = await svc().listGrantsForCustomer(customerId);
        expect(grants.filter((g: any) => g.promotion_id === promotionId)).toHaveLength(1);
      });

      it('G3: 동시 클레임 2회 → 장 1개, 그리고 issued_count 는 +1 이다', async () => {
        // 🔴 장수만 검사하면 안 된다. 오늘 새고 있는 것은 장수가 아니라 «카운터» 다 —
        //    claim 라우트의 read-then-write 경합이 reserveClaimSlot 을 두 번 돌리는데,
        //    링크의 복합 PK 가 장수만 1로 막아 증상이 안 보였다. max_claims 가 있어야 재현된다.
        const promotionId = await createPromo(`G3${seq}`, {
          visibility: 'claimable',
          max_claims: 10,
        });
        const claim = () =>
          api
            .post(`/store/customers/me/promotions/${promotionId}/claim`, {}, storeHeaders)
            .catch((e: any) => e.response);

        await Promise.all([claim(), claim()]);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(1);
        const meta = await svc().getByPromotionId(promotionId);
        expect(Number(meta.issued_count)).toBe(1);
      });
    });

    describe('회수와 발급 현황', () => {
      it('G10: 회수는 장수만큼 issued_count 를 되돌린다', async () => {
        const promotionId = await createPromo(`G10${seq}`, {
          visibility: 'assigned_only',
          max_claims: 100,
        });
        await issue(promotionId, 'sub-rev', 3);
        const before = Number((await svc().getByPromotionId(promotionId)).issued_count);
        expect(before).toBe(3);

        await api.delete(`/admin/promotions/${promotionId}/customers`, {
          ...adminHeaders,
          data: { customer_ids: [customerId] },
        });

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
        expect(Number((await svc().getByPromotionId(promotionId)).issued_count)).toBe(0);
      });

      it('G10 (고객축): DELETE /admin/customers/:id/promotions 도 장수만큼 issued_count 를 되돌린다', async () => {
        // 두 DELETE 라우트(프로모션축·고객축)가 같은 회수 루프를 각자 갖고 있다 — 한쪽만
        // 배선하고 다른 쪽을 놓치는 게 이 태스크의 실제 실패 모드였다(#488 Task 7 리뷰).
        // 프로모션축은 위 G10 이 다장 회수를 검사하니, 여기선 고객축을 같은 강도로 검사한다.
        const promotionId = await createPromo(`G10B${seq}`, {
          visibility: 'assigned_only',
          max_claims: 100,
        });
        await issue(promotionId, 'sub-rev-b', 3);
        const before = Number((await svc().getByPromotionId(promotionId)).issued_count);
        expect(before).toBe(3);

        await api.delete(`/admin/customers/${customerId}/promotions`, {
          ...adminHeaders,
          data: { promotion_ids: [promotionId] },
        });

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
        expect(Number((await svc().getByPromotionId(promotionId)).issued_count)).toBe(0);
      });

      it('발급 현황이 고객별 보유·사용 장수를 돌려준다', async () => {
        const promotionId = await createPromo(`GST${seq}`, { visibility: 'assigned_only' });
        await issue(promotionId, 'sub-stat', 2);

        const res = await api.get(`/admin/promotions/${promotionId}/customers`, adminHeaders);

        const row = res.data.customers.find((c: any) => c.id === customerId);
        expect(row.granted_count).toBe(2);
        expect(row.used_count).toBe(0);
        expect(row.usable_count).toBe(2);
        expect(res.data.max_uses_per_customer).toBeUndefined();
      });
    });
  },
});
