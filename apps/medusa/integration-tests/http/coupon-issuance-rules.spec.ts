import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

jest.setTimeout(120 * 1000);

/**
 * 발급 시점 룰 분류 + fail-closed (#488 `1-5`, P7).
 *
 * 픽스처는 `coupon-admin.spec.ts` · `coupon-store.spec.ts` 의 관례를 그대로 복제한다 —
 * 공용 헬퍼가 저장소에 없고, 러너가 매 테스트 후 DB 를 teardown 하므로 `beforeEach` 에서
 * admin/customer 를 새로 만들어야 한다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  // 트리거 자동발급은 프로덕션 기본 OFF(COUPON_AUTO_ISSUE_ENABLED). 이 스펙은 켠 상태의
  // 동작을 검증하므로 러너에만 켠다 — 라이브 플립과 무관하다.
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let storeHeaders: { headers: Record<string, string> };
    let customerId: string;
    let otherGroupId: string;
    let seq = 0;

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@p7.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const pk = await api.post('/admin/api-keys', { title: `pk${seq}`, type: 'publishable' }, adminHeaders);

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `buyer${seq}@p7.test` }]);
      customerId = cust.id;
      storeHeaders = {
        headers: {
          'x-publishable-api-key': pk.data.api_key.token,
          authorization: `Bearer ${jwt.sign(
            { actor_id: cust.id, actor_type: 'customer', auth_identity_id: 'c', app_metadata: { customer_id: cust.id } },
            secret,
          )}`,
        },
      };

      // 고객이 **속하지 않은** 그룹. 이 그룹으로 만든 `ne` 룰은 「그룹 밖이면 준다」는 뜻이라
      // 오늘의 fail-open 이면 발급되고, fail-closed 면 거부된다 — 두 동작이 정확히 갈린다.
      const [group] = await customerModule.createCustomerGroups([{ name: `other${seq}` }]);
      otherGroupId = group.id;
    });

    const createPromo = async (
      code: string,
      rules: unknown[],
      additional_data: Record<string, unknown> = {
        visibility: 'claimable',
        auto_issue_trigger: 'customer_registered',
      },
    ) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          rules,
          additional_data,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    /**
     * 분류표 밖 룰. 속성은 엔진이 아는 것이되 **operator 가 우리가 모르는 것**이라
     * 「생성은 반드시 된다 + 발급은 반드시 거부된다」를 둘 다 만족한다.
     */
    const unsupportedRule = () => [
      { attribute: 'customer.groups.id', operator: 'ne', values: [otherGroupId] },
    ];

    const autoIssue = () =>
      api.post(`/admin/customers/${customerId}/issue-coupons`, { trigger: 'customer_registered' }, adminHeaders);

    describe('발급 시점 룰 분류 (#488 1-5)', () => {
      it('분류표 밖 룰은 자동발급에서 unsupported_rule 로 skip 된다', async () => {
        const promoId = await createPromo('P7UNSUP', unsupportedRule());

        const res = await autoIssue();

        expect(res.status).toEqual(200);
        expect(res.data.issued.map((i: any) => i.promotion_id)).not.toContain(promoId);
        expect(res.data.skipped).toEqual(
          expect.arrayContaining([{ promotion_id: promoId, reason: 'unsupported_rule' }]),
        );
      });

      it('카트 문맥 룰(subtotal)은 의도적으로 무시하고 발급한다', async () => {
        const promoId = await createPromo('P7SUBTOTAL', [
          { attribute: 'subtotal', operator: 'gte', values: ['30000'] },
        ]);

        const res = await autoIssue();

        expect(res.data.issued.map((i: any) => i.promotion_id)).toContain(promoId);
      });

      it('수동 발급도 분류표 밖 룰을 skip 하고, force 는 그것을 넘는다', async () => {
        const promoId = await createPromo('P7MANUAL', unsupportedRule());

        const skipped = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [promoId], force: false, submit_id: `p7manual-skip-${seq}` },
          adminHeaders,
        );
        expect(skipped.data.issued).not.toContain(promoId);
        expect(skipped.data.skipped.find((s: any) => s.promotion_id === promoId)?.reason).toEqual(
          'unsupported_rule',
        );

        const forced = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [promoId], force: true, submit_id: `p7manual-force-${seq}` },
          adminHeaders,
        );
        expect(forced.data.issued).toContain(promoId);
      });

      it('클레임도 거부한다 — 고객에게는 기존 어휘로 접어 보낸다', async () => {
        const promoId = await createPromo('P7CLAIM', unsupportedRule());

        await expect(
          api.post(`/store/customers/me/promotions/${promoId}/claim`, {}, storeHeaders),
        ).rejects.toThrow();
      });
    });

    describe('표시 경로도 같은 술어를 쓴다', () => {
      it('분류표 밖 룰 쿠폰은 프리뷰에서 거부된다 (기존 어휘 그대로)', async () => {
        await createPromo('P7PREVIEW', unsupportedRule());

        const res = await api.get('/store/coupons/preview?code=P7PREVIEW', storeHeaders);

        expect(res.status).toEqual(200);
        expect(res.data.valid).toBe(false);
        // 새 reason 을 만들지 않는다 — 스토어프론트가 닫힌 집합으로 읽는다.
        expect(res.data.reason).toEqual('COUPON_GROUP_RESTRICTED');
      });

      it('분류표 밖 룰 쿠폰은 claimable 목록에 뜨지 않는다', async () => {
        await createPromo('P7LIST', unsupportedRule());

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        const codes = (res.data.claimable_promotions ?? []).map((p: any) => p.code);
        expect(codes).not.toContain('P7LIST');
      });

      it('이미 발급된 쿠폰은 룰과 무관하게 목록에 남는다 (회귀 가드)', async () => {
        // 🔴 assigned 목록에 fail-closed 를 넣으면 **고객이 보유한 쿠폰이 사라진다.**
        // 카트에서는 엔진이 룰을 제대로 평가해 쓸 수 있는데도 목록에서만 없어진다.
        //
        // Task 5: 「보유」의 정본이 customer-promotion 링크에서 grant 로 옮겨갔다 — 이 라우트는
        // 링크를 더 이상 읽지 않으므로 grant 를 직접 심는다(옛 픽스처의 link.create 는 지웠다).
        const promoId = await createPromo('P7OWNED', unsupportedRule(), { visibility: 'assigned_only' });
        const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
        await metaService.issueGrant({
          promotion_id: promoId, customer_id: customerId, issue_key: `p7owned_${seq}`,
          issued_via: 'admin_manual', expires_at: null, now: new Date(),
        });

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect((res.data.promotions ?? []).map((p: any) => p.code)).toContain('P7OWNED');
      });
    });
  },
});
