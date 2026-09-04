import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { ContainerRegistrationKeys, Modules } from '@medusajs/framework/utils';
import { createCustomerAccountWorkflow } from '@medusajs/core-flows';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import handleCouponAutoIssueOnCustomerCreated from '../../src/subscribers/coupon-auto-issue-on-customer-created';

jest.setTimeout(180 * 1000);

/**
 * 회원가입 자동발급의 «층 사이» 증명 (#775, 스펙 §6).
 *
 * 앞부분은 subscriber 를 직접 부른다(`coupon-consume.spec.ts` 선례) — 결정적이다. 마지막 케이스는
 * **실제 `createCustomerAccountWorkflow`** 로 고객을 만들고 로컬 이벤트버스가 subscriber 를 깨워 `coupon_grant`
 * 행이 생기는지를 본다 — 「발행자가 실제로 있다」의 자동 증명이다. 그 케이스가 환경에서 불안정하면
 * (`it.skip` 으로 두지 말고) 원인을 이 파일 헤더에 적고 플랜 Task 5 의 기록 항목을 채울 것.
 *
 * `createCustomerAccountWorkflow` 반환 모양 검증 (Task 5 지시): `apps/medusa/node_modules/@medusajs/core-flows/
 * dist/customer/workflows/create-customer-account.js` 를 읽으면 `createCustomersWorkflow.runAsStep(...)` 이 낸
 * 배열의 `[0]` 을 `transform` 으로 뽑아 그대로 `new WorkflowResponse(customer)` 에 넘긴다 — 즉 `result` 자체가
 * 고객 엔티티다(`result.customer.id` 가 아니라 `result.id`). 아래 e2e 케이스는 이미 그 모양(`{ result:
 * customer } = ...; customer.id`)을 쓰고 있어 **수정이 필요 없었다** — 브리프 코드가 그대로 맞다.
 *
 * 실행 중 발견한 진짜 스펙 버그(브리프 원문 그대로는 e2e case 가 실패했다): `disableAutoTeardown: true`
 * 라 DB 가 case 사이에 안 비워진다. 앞 세 case 가 만드는 트리거 프로모션(SUB1A·SUB2B·SUB3C)이 `status:
 * active` 로 남아 있는 채 e2e case 가 새 고객을 만들면, 그 고객은 **전부**(4장, codes=SUB1A,SUB2B,
 * SUB3C,SUB4E2E)에 대해 자격이 있어 `toHaveLength(1)` 이 4로 깨졌다(실측). assertion 을 손대지 않고
 * `createTriggerPromo` 가 만든 프로모션을 각 case 종료 시 `status: inactive` 로 꺼서(`afterEach`) 고쳤다 —
 * `autoIssueCoupons` 의 조회가 `status: 'active'` 를 거르므로 이후 case 의 후보에서 스스로 빠지고, 이미
 * 만들어진 grant 행은 프로모션 상태를 보지 않는 `listGrantsForCustomer` 라 영향받지 않는다.
 */
medusaIntegrationTestRunner({
  inApp: true,
  env: { COUPON_AUTO_ISSUE_ENABLED: 'true' },
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let seq = 0;
    /** case 간 트리거 프로모션 누출 방지용 — 이유는 파일 헤더 참고. */
    const createdPromoIds: string[] = [];

    afterEach(async () => {
      const ids = createdPromoIds.splice(0);
      await Promise.all(
        ids.map((id) => api.post(`/admin/promotions/${id}`, { status: 'inactive' }, adminHeaders).catch(() => {})),
      );
    });

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;
      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@sub.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };
    });

    const createTriggerPromo = async (code: string) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code,
          type: 'standard',
          is_automatic: false,
          status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          rules: [],
          additional_data: { visibility: 'assigned_only', auto_issue_trigger: 'customer_registered', validity_days: 30 },
        },
        adminHeaders,
      );
      createdPromoIds.push(res.data.promotion.id);
      return res.data.promotion.id as string;
    };

    const grantsOf = async (customerId: string) =>
      (getContainer().resolve(PROMOTION_META_MODULE) as any).listGrantsForCustomer(customerId);

    const invoke = (customerId: string) =>
      handleCouponAutoIssueOnCustomerCreated({ event: { data: { id: customerId } }, container: getContainer() } as any);

    describe('subscriber 직접 호출', () => {
      it('has_account 고객이면 트리거 쿠폰이 한 장 생기고, 두 번 불려도 한 장이다', async () => {
        const promoId = await createTriggerPromo(`SUB${seq}A`);
        const customerModule = getContainer().resolve(Modules.CUSTOMER);
        const [cust] = await customerModule.createCustomers([{ email: `acct${seq}@sub.test`, has_account: true }]);

        await invoke(cust.id);
        await invoke(cust.id);

        const grants = await grantsOf(cust.id);
        expect(grants).toHaveLength(1);
        expect(grants[0]).toEqual(
          expect.objectContaining({ promotion_id: promoId, issued_via: 'customer_registered', issue_key: 'trigger:customer_registered' }),
        );
        expect(grants[0].expires_at).not.toBeNull();
      });

      it('has_account=false 고객(어드민 생성·게스트)에는 아무것도 생기지 않는다', async () => {
        await createTriggerPromo(`SUB${seq}B`);
        const customerModule = getContainer().resolve(Modules.CUSTOMER);
        const [guest] = await customerModule.createCustomers([{ email: `guest${seq}@sub.test` }]);

        await invoke(guest.id);

        expect(await grantsOf(guest.id)).toEqual([]);
      });

      it('플래그가 꺼져 있으면 아무것도 생기지 않는다', async () => {
        await createTriggerPromo(`SUB${seq}C`);
        const customerModule = getContainer().resolve(Modules.CUSTOMER);
        const [cust] = await customerModule.createCustomers([{ email: `off${seq}@sub.test`, has_account: true }]);
        const prev = process.env.COUPON_AUTO_ISSUE_ENABLED;
        process.env.COUPON_AUTO_ISSUE_ENABLED = 'false';
        try {
          await invoke(cust.id);
        } finally {
          process.env.COUPON_AUTO_ISSUE_ENABLED = prev;
        }
        expect(await grantsOf(cust.id)).toEqual([]);
      });
    });

    describe('층 사이 — 실제 고객 생성 워크플로가 subscriber 를 깨운다', () => {
      it('createCustomerAccountWorkflow → customer.created → coupon_grant 행 (손으로 아무것도 안 부른다)', async () => {
        const promoId = await createTriggerPromo(`SUB${seq}E2E`);
        const container = getContainer();
        const authModule = container.resolve(Modules.AUTH);
        const email = `e2e${seq}@sub.test`;
        const [identity] = await authModule.createAuthIdentities([
          { provider_identities: [{ provider: 'emailpass', entity_id: email, provider_metadata: {} }] },
        ]);

        const { result: customer } = await createCustomerAccountWorkflow(container).run({
          input: { authIdentityId: identity.id, customerData: { email } },
        });

        // 이벤트는 워크플로 커밋 뒤 비동기로 풀린다 — 짧게 폴링한다.
        const deadline = Date.now() + 10_000;
        let grants: any[] = [];
        while (Date.now() < deadline) {
          grants = await grantsOf(customer.id);
          if (grants.length > 0) break;
          await new Promise((r) => setTimeout(r, 200));
        }

        expect(grants).toHaveLength(1);
        expect(grants[0]).toEqual(expect.objectContaining({ promotion_id: promoId, issued_via: 'customer_registered' }));
      });
    });
  },
});
