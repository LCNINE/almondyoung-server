import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';
import {
  issueCouponGrantWorkflow,
  type IssueGrantRequest,
} from '../../src/workflows/coupons/workflows/issue-coupon-grant-workflow';

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

    /**
     * 쿠폰 하나를 만든다. `additional_data` 로 visibility·발급창·수량한도를 준다.
     * `overrides` 는 `is_automatic` 등 promotion 자체 필드를 덮어쓴다(coupon-admin.spec.ts 의
     * 같은 이름 파라미터와 같은 모양 — 새 헬퍼가 아니라 기존 헬퍼의 확장이다).
     */
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

      it('고객축: 전량 duplicate 인 재시도는 skipped(already_issued) 로 답한다 — 응답에서 사라지지 않는다', async () => {
        // 🔴 형제(쿠폰축) 라우트는 Task 12 리뷰에서 이 수정을 받았는데 고객축은 빠져 있었다
        // (2026-09-02 전체 리뷰). `if (granted > 0) { issued.push }` 에 else 가 없어, 재시도한
        // 프로모션이 issued 에도 skipped 에도 없는 「응답에 없는 항목」이 됐다 — 클라이언트는
        // 그걸 'unknown' 으로 떨어뜨려 이미 성공한 건을 «발급할 수 없습니다» 로 보여준다.
        // 위 G2 는 장수(원장)만 봐서 이 응답 계약 결함을 못 잡는다 — 여기선 응답 본문을 본다.
        const promotionId = await createPromo(`G2R${seq}`, { visibility: 'assigned_only' });

        const first = await issue(promotionId, `sub-retry-${seq}`, 2);
        expect(first.data.issued).toEqual([promotionId]);
        expect(first.data.skipped).toEqual([]);

        const second = await issue(promotionId, `sub-retry-${seq}`, 2);
        expect(second.data.issued).toEqual([]);
        expect(second.data.skipped).toEqual([{ promotion_id: promotionId, reason: 'already_issued' }]);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
      });

      it('고객축: submit_id 가 없으면 400 이다 — 서버가 만들어 주면 따닥이 곧 두 배 발급', async () => {
        // 🔴 옛 코드는 `submit_id ?? randomUUID()` 라 요청마다 새 키였다 — 클라이언트가 값을
        // 안 보내면 멱등성이 통째로 사라진다(2026-09-02 전체 리뷰). 형제 라우트와 같은 계약.
        const promotionId = await createPromo(`G2N${seq}`, { visibility: 'assigned_only' });

        const res = await api
          .post(`/admin/customers/${customerId}/promotions`, { promotion_ids: [promotionId] }, adminHeaders)
          .catch((e: any) => e.response);

        expect(res.status).toBe(400);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
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

      it('G3: 동시 클레임 2회 → 장 1개, 그리고 coupon_grant COUNT 는 +1 이다', async () => {
        // 🔴 이 테스트가 실제로 지키는 것은 `FOR UPDATE` 락(상한 직렬화)이 «아니다» — 두 요청
        // 모두 **같은** 고객이고, `claim/route.ts` 의 `issue_key` 는 `'claim'` 고정이라
        // `(promotion_id, customer_id, issue_key)` 유니크 인덱스가 둘 중 하나를 유니크
        // 위반으로 되감는다(따닥 방어). max_claims: 10 은 두 동시 요청으로는 닿지도 않는
        // 값이라 상한 집행 경로를 재현하지 않는다 — 상한 락의 실제 경합 테스트는
        // `service.integration.spec.ts` 의 "발급은 promotion_meta 행 락으로 직렬화된다 —
        // 락을 빼면 빨개진다" 가 맡는다(타이밍 경합을 기다리는 대신 락을 밖에서 쥐고
        // 대기 여부를 결정론적으로 관찰한다 — 옛 「서로 다른 고객 둘이 경합」테스트는
        // 재현이 안 돼 이 방식으로 대체됐다).
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
        expect(await svc().countIssuedGrants(promotionId)).toBe(1);
      });
    });

    describe('회수와 발급 현황', () => {
      it('G10: 회수는 장수만큼 coupon_grant COUNT 를 되돌린다', async () => {
        const promotionId = await createPromo(`G10${seq}`, {
          visibility: 'assigned_only',
          max_claims: 100,
        });
        await issue(promotionId, 'sub-rev', 3);
        const before = await svc().countIssuedGrants(promotionId);
        expect(before).toBe(3);

        await api.delete(`/admin/promotions/${promotionId}/customers`, {
          ...adminHeaders,
          data: { customer_ids: [customerId] },
        });

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
        expect(await svc().countIssuedGrants(promotionId)).toBe(0);
      });

      it('G10 (고객축): DELETE /admin/customers/:id/promotions 도 장수만큼 coupon_grant COUNT 를 되돌린다', async () => {
        // 두 DELETE 라우트(프로모션축·고객축)가 같은 회수 루프를 각자 갖고 있다 — 한쪽만
        // 배선하고 다른 쪽을 놓치는 게 이 태스크의 실제 실패 모드였다(#488 Task 7 리뷰).
        // 프로모션축은 위 G10 이 다장 회수를 검사하니, 여기선 고객축을 같은 강도로 검사한다.
        const promotionId = await createPromo(`G10B${seq}`, {
          visibility: 'assigned_only',
          max_claims: 100,
        });
        await issue(promotionId, 'sub-rev-b', 3);
        const before = await svc().countIssuedGrants(promotionId);
        expect(before).toBe(3);

        await api.delete(`/admin/customers/${customerId}/promotions`, {
          ...adminHeaders,
          data: { promotion_ids: [promotionId] },
        });

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
        expect(await svc().countIssuedGrants(promotionId)).toBe(0);
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

    describe('대량 발급', () => {
      let customerId2: string;

      beforeEach(async () => {
        const [c2] = await getContainer()
          .resolve(Modules.CUSTOMER)
          .createCustomers([{ email: `buyer2_${seq}@grant.test` }]);
        customerId2 = c2.id;
      });

      it('한 쿠폰을 여러 고객에게 발급한다', async () => {
        const promotionId = await createPromo(`BULK${seq}`, { visibility: 'assigned_only' });

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: [customerId, customerId2], quantity: 2, submit_id: 'bulk-1' },
          adminHeaders,
        );

        expect(res.status).toBe(200);
        expect(res.data.issued).toHaveLength(2);
        expect(res.data.issued[0].granted).toBe(2);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
        expect(await svc().listGrantsForCustomer(customerId2)).toHaveLength(2);
      });

      it('같은 submit_id 로 두 번 보내도 장수가 늘지 않는다', async () => {
        const promotionId = await createPromo(`BULKI${seq}`, { visibility: 'assigned_only' });
        const body = { customer_ids: [customerId], quantity: 2, submit_id: 'bulk-same' };

        await api.post(`/admin/promotions/${promotionId}/customers`, body, adminHeaders);
        await api.post(`/admin/promotions/${promotionId}/customers`, body, adminHeaders);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
      });

      it('재시도(같은 submit_id, 전량 duplicate)는 그 고객을 skipped(already_issued) 로 정직하게 답한다', async () => {
        // 🔴 Task 12 리뷰 Important #1: 첫 발급이 이미 성공한 고객을 같은 submit_id 로
        // 재전송하면(force 재시도가 전체 목록을 다시 보내는 경우가 실제 경로) 모든 n 이
        // 'duplicate' 로 끝나 granted===0 이 된다. 이 branch 가 없으면 그 고객은 issued 에도
        // skipped 에도 없는 「응답에 없는 고객」이 되어, 클라이언트의 summarizeIssueResult 가
        // 'unknown' 으로 떨어뜨려 이미 성공한 고객을 화면에 «발급할 수 없습니다» 로 보여준다.
        // 위 테스트는 장수(원장)만 봐서 이 응답 계약 결함을 못 잡았다 — 이번엔 응답 본문을 본다.
        const promotionId = await createPromo(`BULKI2${seq}`, { visibility: 'assigned_only' });
        const body = { customer_ids: [customerId], quantity: 2, submit_id: 'bulk-same-2' };

        const first = await api.post(`/admin/promotions/${promotionId}/customers`, body, adminHeaders);
        expect(first.data.issued).toEqual([{ customer_id: customerId, granted: 2 }]);
        expect(first.data.skipped).toEqual([]);

        const second = await api.post(`/admin/promotions/${promotionId}/customers`, body, adminHeaders);
        expect(second.data.issued).toEqual([]);
        expect(second.data.skipped).toEqual([{ customer_id: customerId, reason: 'already_issued' }]);

        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(2);
      });

      it('한 고객의 실패가 나머지를 막지 않는다', async () => {
        const promotionId = await createPromo(`BULKM${seq}`, { visibility: 'assigned_only' });

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: ['cus_does_not_exist', customerId], submit_id: 'bulk-mixed' },
          adminHeaders,
        );

        expect(res.data.issued.map((i: any) => i.customer_id)).toEqual([customerId]);
        expect(res.data.skipped[0]).toEqual({
          customer_id: 'cus_does_not_exist',
          reason: 'customer_not_found',
        });
      });

      it('submit_id 가 없으면 400 이다 — 멱등성을 포기할 수 없다', async () => {
        const promotionId = await createPromo(`BULKN${seq}`, { visibility: 'assigned_only' });

        const res = await api
          .post(
            `/admin/promotions/${promotionId}/customers`,
            { customer_ids: [customerId] },
            adminHeaders,
          )
          .catch((e: any) => e.response);

        expect(res.status).toBe(400);
      });

      it('자동적용 프로모션은 대량발급 대상이 아니다 — 전원 skip(reason: automatic)', async () => {
        // 리뷰 Important #1: 형제(고객축) 라우트는 is_automatic 을 막는데 이 라우트는 fetch 만
        // 하고 안 읽었다 — 자동적용 쿠폰에 개별 grant 를 대량발급할 수 있게 되는 결함이었다.
        const promotionId = await createPromo(
          `BULKA${seq}`,
          { visibility: 'assigned_only' },
          { is_automatic: true },
        );

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: [customerId, customerId2], submit_id: 'bulk-auto' },
          adminHeaders,
        );

        expect(res.status).toBe(200);
        expect(res.data.issued).toEqual([]);
        expect(res.data.skipped).toEqual([
          { customer_id: customerId, reason: 'automatic' },
          { customer_id: customerId2, reason: 'automatic' },
        ]);
        // 🔴 쿠폰축 조기 반환도 성공 응답과 «같은 모양»이어야 한다 — admin-web 의
        // `BulkIssueResult` 는 `promotion_id`·`force` 를 required 로 선언하는데, 두 트리
        // 사이엔 타입 검사가 없어(admin-web 은 medusa 를 import 못 한다) 빠뜨려도 어떤
        // 게이트도 안 잡는다(2026-09-02 전체 리뷰). 네 조기 반환 중 하나로 대표 검증한다.
        expect(res.data.promotion_id).toBe(promotionId);
        expect(res.data.force).toBe(false);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
      });

      it('시작 전 쿠폰의 조기 반환도 promotion_id·force 를 싣는다 (not_started)', async () => {
        const promotionId = await createPromo(`BULKNS${seq}`, {
          visibility: 'assigned_only',
          starts_at: '2999-01-01T00:00:00.000Z',
        });

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: [customerId], submit_id: `bulk-ns-${seq}` },
          adminHeaders,
        );

        expect(res.status).toBe(200);
        expect(res.data).toMatchObject({
          promotion_id: promotionId,
          force: false,
          issued: [],
          skipped: [{ customer_id: customerId, reason: 'not_started' }],
        });
      });

      it('customer_ids × quantity 상한(1000)을 넘으면 400 이다 — 두 상한을 따로 두면 곱이 안 막힌다', async () => {
        // 500명 × 50장 = 25,000 회의 순차 INSERT 는 어떤 프록시 타임아웃보다 길고, 클라이언트가
        // 끊긴 뒤에도 서버 루프는 계속 돈다 = 「응답은 실패인데 발급은 됐다」(2026-09-02 리뷰).
        const promotionId = await createPromo(`BULKCAP${seq}`, { visibility: 'assigned_only' });
        const many = Array.from({ length: 40 }, (_, i) => `cus_fake_${i}`);

        const res = await api
          .post(
            `/admin/promotions/${promotionId}/customers`,
            { customer_ids: many, quantity: 50, submit_id: `bulk-cap-${seq}` },
            adminHeaders,
          )
          .catch((e: any) => e.response);

        expect(res.status).toBe(400);
        // 🔴 `customerId` 로 물으면 «항상» 0 이다 — 이 요청의 대상은 `cus_fake_*` 40개라
        // 그 고객은 애초에 후보가 아니었다(공허한 단언). 물어야 할 것은 «이 프로모션에
        // 장이 하나도 안 생겼는가» 다.
        expect(await svc().listGrantsForPromotion(promotionId)).toHaveLength(0);
      });

      it('곱이 상한 이내면 통과한다 — 위 테스트가 「전부 400」으로 공허하게 통과하지 않게', async () => {
        const promotionId = await createPromo(`BULKCAPOK${seq}`, { visibility: 'assigned_only' });

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: [customerId, customerId2], quantity: 50, submit_id: `bulk-cap-ok-${seq}` },
          adminHeaders,
        );

        expect(res.status).toBe(200);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(50);
      });

      it('비숫자 quantity 는 400 이다 — 조용한 200 이 아니어야 한다', async () => {
        // 리뷰 Important #2: `Number('abc')` 는 NaN 이고 NaN 과의 모든 비교가 false 라
        // 발급 루프가 한 번도 안 돌아 `200 {issued: [], skipped: []}` 가 사유 없이 나갔다.
        const promotionId = await createPromo(`BULKQ${seq}`, { visibility: 'assigned_only' });

        const res = await api
          .post(
            `/admin/promotions/${promotionId}/customers`,
            { customer_ids: [customerId], submit_id: 'bulk-bad-qty', quantity: 'abc' },
            adminHeaders,
          )
          .catch((e: any) => e.response);

        expect(res.status).toBe(400);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
      });

      it('형제(고객축) 라우트도 비숫자 quantity 에 400 이다 — 같은 결함, 같은 수정', async () => {
        const promotionId = await createPromo(`BULKQ2${seq}`, { visibility: 'assigned_only' });

        const res = await api
          .post(
            `/admin/customers/${customerId}/promotions`,
            { promotion_ids: [promotionId], submit_id: 'bulk-bad-qty-sibling', quantity: 'abc' },
            adminHeaders,
          )
          .catch((e: any) => e.response);

        expect(res.status).toBe(400);
        expect(await svc().listGrantsForCustomer(customerId)).toHaveLength(0);
      });
    });

    /**
     * #488 A2 — `public` 쿠폰에 직권 발급하면 **그 고객만** 제한된다.
     *
     * 카트 게이트는 「장이 있으면 장이 정한다」로 갈리므로, 선의로 발급한 한 장이 곧
     * 그 고객만의 1회 제한이 된다. 나머지 고객은 계속 자유롭게 쓴다. 발급 자체를 막는 것이
     * 가장 싼 해법이라 세 경로(고객축·쿠폰축·트리거) 전부에서 거절한다.
     */
    describe('public 쿠폰 직권 발급 차단 (#488 A2)', () => {
      it('고객축: public 쿠폰은 발급되지 않는다', async () => {
        const promotionId = await createPromo(`PUBC${seq}`, { visibility: 'public' });

        const res = await issue(promotionId, `pub-c-${seq}`);

        expect(res.status).toBe(200);
        expect(res.data.issued).toEqual([]);
        expect(res.data.skipped).toEqual([{ promotion_id: promotionId, reason: 'public_promotion' }]);
        expect(await svc().listGrantsForPromotion(promotionId)).toHaveLength(0);
      });

      it('쿠폰축: public 쿠폰 대량발급은 전원 public_promotion 으로 떨어진다', async () => {
        const promotionId = await createPromo(`PUBB${seq}`, { visibility: 'public' });

        const res = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: [customerId], quantity: 3, submit_id: `pub-b-${seq}` },
          adminHeaders,
        );

        expect(res.status).toBe(200);
        expect(res.data.issued).toEqual([]);
        expect(res.data.skipped).toEqual([{ customer_id: customerId, reason: 'public_promotion' }]);
        // 쿠폰축 조기 반환은 성공 응답과 같은 모양이어야 한다(admin-web `BulkIssueResult`).
        expect(res.data.promotion_id).toBe(promotionId);
        expect(res.data.force).toBe(false);
        expect(await svc().listGrantsForPromotion(promotionId)).toHaveLength(0);
      });

      it('🔴 force 로도 뚫리지 않는다 — 강제 발급이 결함을 «찍어내면» 안 된다', async () => {
        // 다른 `!force` 검사들(inactive·not_started·룰)은 전부 「지금은 정책상 발급이 안 되는
        // 상태」라 운영자가 정당하게 넘어설 수 있다. `public` 은 그게 아니라 「이 쿠폰엔 1인
        // 발급 개념 자체가 없다」이고, 넘어서면 그 고객만 제한되는 결함이 만들어진다.
        // 그래서 이 검사만 `!force` 블록 «밖»에 둔다.
        const promotionId = await createPromo(`PUBF${seq}`, { visibility: 'public' });

        const customerAxis = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [promotionId], submit_id: `pub-f1-${seq}`, force: true },
          adminHeaders,
        );
        const couponAxis = await api.post(
          `/admin/promotions/${promotionId}/customers`,
          { customer_ids: [customerId], submit_id: `pub-f2-${seq}`, force: true },
          adminHeaders,
        );

        expect(customerAxis.data.skipped).toEqual([
          { promotion_id: promotionId, reason: 'public_promotion' },
        ]);
        expect(couponAxis.data.skipped).toEqual([
          { customer_id: customerId, reason: 'public_promotion' },
        ]);
        expect(await svc().listGrantsForPromotion(promotionId)).toHaveLength(0);
      });

      it('트리거 자동발급도 public 쿠폰을 건너뛴다', async () => {
        const promotionId = await createPromo(`PUBT${seq}`, {
          visibility: 'public',
          auto_issue_trigger: 'customer_registered',
        });

        const res = await api.post(
          `/admin/customers/${customerId}/issue-coupons`,
          { trigger: 'customer_registered' },
          adminHeaders,
        );

        expect(res.status).toBe(200);
        // 🔴 자동발급은 «그 트리거를 가진 모든 쿠폰» 에 작용하므로 이 스위트의 다른 테스트가
        // 만든 쿠폰(G4)도 같이 실린다. `toEqual([])` 로 쓰면 그 쿠폰 때문에 실패하고,
        // 그걸 피하려고 스위트를 격리하면 이 라우트의 실제 동작에서 멀어진다 — 기존 G4 와
        // 같이 «내 프로모션만» 골라 본다.
        expect(res.data.issued.map((i: any) => i.promotion_id)).not.toContain(promotionId);
        expect(res.data.skipped).toContainEqual({ promotion_id: promotionId, reason: 'public_promotion' });
        expect(await svc().listGrantsForPromotion(promotionId)).toHaveLength(0);
      });

      it('대조군: assigned_only·claimable 은 그대로 발급된다 — 위 넷이 「전부 거절」로 공허하게 통과하지 않게', async () => {
        const assignedId = await createPromo(`PUBOK1${seq}`, { visibility: 'assigned_only' });
        const claimableId = await createPromo(`PUBOK2${seq}`, { visibility: 'claimable' });

        const res = await api.post(
          `/admin/customers/${customerId}/promotions`,
          { promotion_ids: [assignedId, claimableId], submit_id: `pub-ok-${seq}` },
          adminHeaders,
        );

        expect(res.data.issued).toEqual([assignedId, claimableId]);
        expect(res.data.skipped).toEqual([]);
        expect(await svc().listGrantsForPromotion(assignedId)).toHaveLength(1);
        expect(await svc().listGrantsForPromotion(claimableId)).toHaveLength(1);
      });
    });

    /**
     * Task 7 — customer↔promotion 링크 쓰기 제거 (ADR-0034 결정 2 완료). 회수·재클레임 둘 다
     * 이제 grant 만으로 끝난다. 링크가 있던 시절엔 이 두 경로가 `link.dismiss`/워크플로의
     * `createRemoteLinkStep` 을 각자 걸고 있었다 — 그게 사라졌다는 것 자체가 회귀 없이
     * 확인돼야 한다.
     */
    describe('링크 쓰기 제거 (Task 7)', () => {
      it('회수는 링크와 무관하게 grant 만으로 끝난다', async () => {
        const promotionId = await createPromo(`REVOKE${seq}`, { visibility: 'assigned_only' });
        // 🔴 브리프 원문은 `submit_id` 없이 발급 POST 를 불렀는데, 이 라우트는 그걸 필수로
        // 요구한다(없으면 400) — 위에서 이미 만들어 둔 `issue` 헬퍼를 그대로 쓴다.
        await issue(promotionId, `revoke-${seq}`);
        // 🔴 브리프 원문은 `promotion_ids` 를 쿼리스트링으로 실었는데, 이 라우트는 body 만
        // 읽는다(`req.body as RemovePromotionsBody`) — 다른 모든 DELETE 호출과 같은 모양으로
        // 고쳐 부른다. 그러지 않으면 400(`promotion_ids is required`)이 나 이 테스트가
        // 검증하려는 것(링크 없이도 `removed` 가 정직하다)을 아예 확인하지 못한다.
        const del = await api.delete(`/admin/customers/${customerId}/promotions`, {
          ...adminHeaders,
          data: { promotion_ids: [promotionId] },
        });
        expect(del.status).toEqual(200);
        // `kept_used` 는 0단계(PR #778 리뷰 F3)가 더한 필드 — 회수 뒤 남긴 «쓴 장» 수. 여긴 미사용 1장이라 0.
        expect(del.data.removed).toEqual([{ promotion_id: promotionId, grants: 1, kept_used: 0 }]);

        const after = await api.get(`/admin/customers/${customerId}/promotions`, adminHeaders);
        expect(after.data.promotions).toEqual([]);
      });

      it('이미 보유한 고객의 재클레임은 워크플로를 다시 돌리지 않는다', async () => {
        const promotionId = await createPromo(`RECLAIM${seq}`, { visibility: 'claimable' });
        const first = await api.post(`/store/customers/me/promotions/${promotionId}/claim`, {}, storeHeaders);
        // 두 경로(빠른 경로 / 원자 경로)의 200 본문이 한 모양이다 (PR-2 결정 4). 스토어프론트는
        // 본문을 안 읽지만(claimCoupon: Promise<void>), 읽는 소비자가 생겼을 때 `success` 와
        // `reason` 이 경로에 따라 undefined 로 갈리면 성공한 재클릭이 실패로 렌더된다.
        expect(first.data).toEqual({ success: true, promotion_id: promotionId, issued: true });
        const second = await api.post(
          `/store/customers/me/promotions/${promotionId}/claim`,
          {},
          storeHeaders,
        );
        expect(second.status).toEqual(200);
        expect(second.data).toEqual({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });

        expect(await svc().countIssuedGrants(promotionId)).toEqual(1);
      });

      it('이미 쓴 장을 가진 고객의 재클레임은 쿠폰이 소진돼 있어도 200 이다 (§5.1 200 계약)', async () => {
        // 🔴 이 케이스는 위 테스트와 다르다 — 위는 «usable 한 장이 있는» 고객이라 빠른 경로
        // (hasUsableGrant) 가 잡는다. 여기는 그 장을 «다 쓴» 고객이라 hasUsableGrant 는
        // false 다. `myGrants.length === 0` 를 같이 안 보면, 읽기 기반 소진 pre-check
        // (countIssuedGrants ≥ maxClaims) 가 이 재시도까지 막아 「소진되었습니다」를 던진다 —
        // 그런데 issue_key='claim' 고정이라 원자 경로는 이 재시도를 항상 duplicate 로
        // 판정한다(상한보다 먼저). 자기 몫을 이미 쓴 사람이 재클릭했을 때도 200 이어야
        // 스펙 §5.1 이 지켜진다.
        const promotionId = await createPromo(`RECLAIMUSED${seq}`, {
          visibility: 'claimable',
          max_claims: 1,
        });
        await api.post(`/store/customers/me/promotions/${promotionId}/claim`, {}, storeHeaders);
        const [grant] = await svc().listGrantsForCustomer(customerId);
        expect(await svc().consumeGrantIfUnused(grant.id, `cart_${seq}`, new Date())).toBe(true);

        const second = await api.post(
          `/store/customers/me/promotions/${promotionId}/claim`,
          {},
          storeHeaders,
        );
        expect(second.status).toEqual(200);
        // 이 재클릭은 빠른 경로가 아니라 원자 경로의 duplicate 다 — 그래도 본문은 같은 모양이어야 한다.
        expect(second.data).toEqual({ success: true, promotion_id: promotionId, issued: false, reason: 'already_issued' });
        // 🔴 `second.status === 200` 만으로는 이 가드가 상한 집행을 «통째로» 건너뛰도록
        // 바뀌어도 통과한다 — max_claims: 1 인 쿠폰에서 장이 2장이 되면 안 된다는 것까지
        // 같이 고정한다.
        expect(await svc().countIssuedGrants(promotionId)).toEqual(1);
      });
    });

    // 워크플로가 배치를 받고 verdict 를 돌려준다 (PR-2 결정 3). 라우트 계약은 위 블록들이 지키므로
    // 여기는 워크플로 «자체»의 계약 둘만 본다 — 요청 단위 격리와 verdict 결정.
    //
    // 🔴 별도 스펙 파일이 아니라 이 파일 안에 있다. 스위트 하나 = 임시 DB 생성·마이그레이션·앱 부팅
    // 한 사이클이라, 테스트 2개를 위해 그 사이클을 더 도는 것이 HTTP 게이트의 간헐 실패 확률을
    // 올렸다(최종 리뷰 진단). 여기 `svc()`·`getContainer()` 를 그대로 쓴다.
    describe('issueCouponGrantWorkflow — 배치 입력·verdict 출력', () => {
      const run = (requests: IssueGrantRequest[]) =>
        issueCouponGrantWorkflow(getContainer()).run({ input: { requests } });

      it('요청 하나의 예외는 그 요청의 error 로 격리되고 나머지는 발급된다', async () => {
        await svc().upsert({ promotion_id: 'promo_wf_ok', max_claims: 5 });
        // promo_wf_bad 는 promotion_meta 행이 없다 — 상한 집행 요청이 오면 lockPromotionForIssue 가
        // fail-closed 로 던진다(서비스 독스트링). 그 예외가 배치를 죽이면 옛 라우트 셋이 지키던
        // 「한 고객의 장애가 나머지를 막지 않는다」가 깨진다.
        const { result } = await run([
          { promotion_id: 'promo_wf_bad', customer_id: 'cus_wf', issue_keys: ['k1'], issued_via: 'admin_manual', expires_at: null, max_claims: 1, enforce_cap: true },
          { promotion_id: 'promo_wf_ok', customer_id: 'cus_wf', issue_keys: ['k1', 'k2'], issued_via: 'admin_manual', expires_at: null, max_claims: 5, enforce_cap: true },
        ]);
        expect(result.results.map((r: any) => r.verdict)).toEqual(['error', 'issued']);
        expect(result.results[0].error).toMatch(/promotion_meta/);
        expect(result.results[1]).toMatchObject({ created: 2, duplicated: 0 });
        expect(await svc().countIssuedGrants('promo_wf_ok')).toBe(2);
      });

      it('verdict 는 created·duplicated·상한으로 결정된다 — issued → already_issued → partial → exhausted', async () => {
        await svc().upsert({ promotion_id: 'promo_wf_v', max_claims: 3 });
        const base = { promotion_id: 'promo_wf_v', issued_via: 'admin_manual' as const, expires_at: null, max_claims: 3, enforce_cap: true };

        const first = await run([{ ...base, customer_id: 'c1', issue_keys: ['a', 'b'] }]);
        expect(first.result.results[0]).toMatchObject({ verdict: 'issued', created: 2, duplicated: 0 });

        const again = await run([{ ...base, customer_id: 'c1', issue_keys: ['a', 'b'] }]);
        expect(again.result.results[0]).toMatchObject({ verdict: 'already_issued', created: 0, duplicated: 2 });

        const partial = await run([{ ...base, customer_id: 'c2', issue_keys: ['a', 'b'] }]); // 슬롯 1개 남음
        expect(partial.result.results[0]).toMatchObject({ verdict: 'partial', created: 1 });

        const none = await run([{ ...base, customer_id: 'c3', issue_keys: ['a'] }]);
        expect(none.result.results[0]).toMatchObject({ verdict: 'exhausted', created: 0 });

        expect(await svc().countIssuedGrants('promo_wf_v')).toBe(3);
      });
    });
  },
});
