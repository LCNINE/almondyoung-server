import { medusaIntegrationTestRunner } from '@medusajs/test-utils';
import { Modules, ContainerRegistrationKeys } from '@medusajs/framework/utils';
import jwt from 'jsonwebtoken';
import { PROMOTION_META_MODULE } from '../../src/modules/promotion-meta';

jest.setTimeout(120 * 1000);

medusaIntegrationTestRunner({
  inApp: true,
  env: {},
  disableAutoTeardown: true,
  testSuite: ({ api, getContainer }) => {
    let adminHeaders: { headers: Record<string, string> };
    let storeHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

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

    const linkCustomer = async (promotionId: string) => {
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.LINK) as any;
      await remoteLink.create([
        { [Modules.CUSTOMER]: { customer_id: customerId }, [Modules.PROMOTION]: { promotion_id: promotionId } },
      ]);
    };

    const preview = (code: string) =>
      api.get(`/store/coupons/preview?code=${code}`, storeHeaders);

    const claim = (promotionId: string) =>
      api.post(`/store/customers/me/promotions/${promotionId}/claim`, {}, storeHeaders);

    const otherGroupRule = async () => {
      const [g] = await getContainer().resolve(Modules.CUSTOMER).createCustomerGroups([{ name: `og${seq}` }]);
      return { rules: [{ attribute: 'customer.groups.id', operator: 'in', values: [g.id] }] };
    };

    const createPromoRaw = async (code: string, additional_data: Record<string, unknown>, overrides: Record<string, unknown> = {}) => {
      const res = await api.post(
        '/admin/promotions',
        {
          code, type: 'standard', is_automatic: false, status: 'active',
          application_method: { type: 'percentage', value: 10, target_type: 'order', currency_code: 'krw' },
          additional_data, ...overrides,
        },
        adminHeaders,
      );
      return res.data.promotion.id as string;
    };

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@store.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      // publishable key (store 라우트 필수 헤더)
      const pk = await api.post('/admin/api-keys', { title: `pk${seq}`, type: 'publishable' }, adminHeaders);
      const pkToken = pk.data.api_key.token;

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `buyer${seq}@store.test` }]);
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

    it('preview is case-insensitive: lowercase input matches uppercase-stored code (P2-4/3-5b)', async () => {
      await createPromo('SUMMER', { visibility: 'public' });
      const res = await api.get('/store/coupons/preview?code=summer', storeHeaders);
      expect(res.status).toEqual(200);
      expect(res.data.valid).toBe(true);
      expect(res.data.promotion?.code).toEqual('SUMMER');
    });

    it('me/promotions returns assigned + public, and separates claimable (contract 7)', async () => {
      const assignedId = await createPromo('ASSIGNED1', { visibility: 'assigned_only' });
      await createPromo('PUBLIC1', { visibility: 'public' });
      await createPromo('CLAIM1', { visibility: 'claimable' });
      await linkCustomer(assignedId);

      const res = await api.get('/store/customers/me/promotions', storeHeaders);
      const codes = res.data.promotions.map((p: any) => p.code);
      const claimCodes = res.data.claimable_promotions.map((p: any) => p.code);
      expect(codes).toContain('ASSIGNED1'); // 발급됨
      expect(codes).toContain('PUBLIC1'); // 공개
      expect(codes).not.toContain('CLAIM1'); // claimable 은 별도 목록
      expect(claimCodes).toContain('CLAIM1');
    });

    it('me/promotions excludes a claim-exhausted claimable coupon (P2-8)', async () => {
      const claimId = await createPromo('CLAIMFULL', { visibility: 'claimable', max_claims: 1 });
      // issued_count 를 max_claims 까지 채워 소진 상태로
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.reserveClaimSlot(claimId, 1); // issued_count = 1 == max_claims

      const res = await api.get('/store/customers/me/promotions', storeHeaders);
      const claimCodes = res.data.claimable_promotions.map((p: any) => p.code);
      expect(claimCodes).not.toContain('CLAIMFULL');
    });

    // #488 Task 8. per-customer 소진의 정본이 campaign budget(use_by_attribute) 에서 grant 로
    // 옮겨갔다 — 「1장=1회」가 grant 로 강제되므로 캠페인 예산 축은 더 이상 검사하지 않는다
    // (me/promotions/route.ts 의 isUsageExhausted 에서 그 브랜치가 삭제됨). 그래서 이 테스트도
    // «장 발급 → 소모» 로 다시 쓴다 — 원래 의도("이미 쓴 쿠폰은 목록에서 빠진다")는 그대로다.
    it('me/promotions excludes a coupon whose grant has been used up (P2 used-coupon)', async () => {
      const id = await createPromo('USEDUP', { visibility: 'assigned_only' });
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.issueGrant({
        promotion_id: id, customer_id: customerId, issue_key: `usedup_${seq}`,
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
      });
      await linkCustomer(id);

      // 사용 전: 목록에 노출
      const before = await api.get('/store/customers/me/promotions', storeHeaders);
      expect(before.data.promotions.map((p: any) => p.code)).toContain('USEDUP');

      // 「1장=1회」— 발급받은 장을 소모한다(주문 완료를 흉내)
      const [grant] = await metaService.listGrantsForCustomer(customerId);
      await metaService.consumeGrant(grant.id, `order_${seq}`, new Date());

      // 사용 후: 목록에서 제외
      const after = await api.get('/store/customers/me/promotions', storeHeaders);
      expect(after.data.promotions.map((p: any) => p.code)).not.toContain('USEDUP');
    });

    // #488 Task 8 리뷰 Important #1 회귀 가드. 여러 장을 가진 고객이 그중 하나는 만료됐지만
    // (날짜 있음) 다른 하나는 무기한으로 아직 살아있으면(usable_count > 0), 그 쿠폰은
    // "사용 가능"(promotions) 목록에만 떠야 한다 — expiredEndsAtOf 가 살아있는 무기한 장을
    // 무시하고 죽은 장의 날짜만 봐서 같은 쿠폰이 "최근 만료"(expired_promotions) 에도 동시에
    // 뜨던 결함이 있었다(수정 전 실측: 아래 두 assertion 중 두 번째가 실패했다).
    it('a coupon with one expired grant and one still-usable grant appears only as assigned, never also as expired', async () => {
      const id = await createPromo('MIXGRANT', { visibility: 'assigned_only' });
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000);
      // 만료된 장 — 날짜가 있고 이미 지났다(30일 컷오프 안).
      await metaService.issueGrant({
        promotion_id: id, customer_id: customerId, issue_key: `mix_old_${seq}`,
        issued_via: 'admin_manual', expires_at: fiveDaysAgo, now: new Date(),
      });
      // 사용 가능한 장 — 무기한, 미사용.
      await metaService.issueGrant({
        promotion_id: id, customer_id: customerId, issue_key: `mix_live_${seq}`,
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
      });
      await linkCustomer(id);

      const res = await api.get('/store/customers/me/promotions', storeHeaders);

      expect(res.data.promotions.map((p: any) => p.code)).toContain('MIXGRANT');
      expect(res.data.expired_promotions.map((p: any) => p.code)).not.toContain('MIXGRANT');
    });

    it('customer can claim a claimable coupon; it then appears as assigned', async () => {
      const claimId = await createPromo('CLAIMME', { visibility: 'claimable' });
      const res0 = await claim(claimId);
      expect(res0.status).toEqual(200);
      const res = await api.get('/store/customers/me/promotions', storeHeaders);
      expect(res.data.promotions.map((p: any) => p.code)).toContain('CLAIMME');
    });

    it('preview reasons: assigned_only(not assigned)=NOT_ASSIGNED, expired=EXPIRED, group=RESTRICTED', async () => {
      await createPromo('ASSIGNONLY', { visibility: 'assigned_only' });
      await createPromoRaw('EXPIREDC', {
        visibility: 'public',
        ends_at: '2000-01-01T00:00:00.000Z',
      });
      await createPromoRaw('GROUPRES', { visibility: 'public' }, await otherGroupRule());

      const a = await preview('ASSIGNONLY');
      expect(a.data.reason).toEqual('COUPON_NOT_ASSIGNED');
      const e = await preview('EXPIREDC');
      expect(e.data.reason).toEqual('COUPON_EXPIRED');
      const g = await preview('GROUPRES');
      expect(g.data.reason).toEqual('COUPON_GROUP_RESTRICTED');
    });

    // preview 의 「보유 여부」가 링크가 아니라 grant 로 판정된다(#488 Task 8 결정 3) — 링크만
    // 있고 장이 없으면 COUPON_NOT_ASSIGNED 로 떨어진다. 그래서 link 뿐 아니라 grant 도 심는다.
    it('preview of an assigned assigned_only coupon is valid', async () => {
      const id = await createPromo('ASSIGNED_OK', { visibility: 'assigned_only' });
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.issueGrant({
        promotion_id: id, customer_id: customerId, issue_key: `assigned_ok_${seq}`,
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
      });
      await linkCustomer(id);
      const res = await preview('ASSIGNED_OK');
      expect(res.data.valid).toBe(true);
    });

    // 리뷰 Finding 1: `issuanceWindowState === 'not_started'` 검사에 `&& !issuedLink` 를 얹으면
    // 이미 발급받은(admin 이 launch 전에 미리 배정한) 고객에게 같은 사유가 COUPON_EXPIRED 로
    // 오분류됐다 — isUsable 도 정책 starts_at 을 보므로 다음 줄에서 같은 이유로 다시 걸리기
    // 때문이다. 발급 여부와 무관하게 COUPON_NOT_STARTED 여야 한다.
    it('preview of an assigned coupon whose policy starts_at is future is NOT_STARTED, not EXPIRED', async () => {
      const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
      const id = await createPromo('ASSIGNED_NS', { visibility: 'assigned_only', starts_at: future });
      await linkCustomer(id);
      const res = await preview('ASSIGNED_NS');
      expect(res.data.reason).toEqual('COUPON_NOT_STARTED');
    });

    it('claim rejects non-claimable (assigned_only) coupon', async () => {
      const id = await createPromo('NOTCLAIM', { visibility: 'assigned_only' });
      await expect(claim(id)).rejects.toMatchObject({ response: { status: 400 } });
    });

    it('claim rejects an exhausted claimable coupon', async () => {
      const id = await createPromo('CLAIMEXH', { visibility: 'claimable', max_claims: 1 });
      const meta = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await meta.reserveClaimSlot(id, 1); // 소진
      await expect(claim(id)).rejects.toMatchObject({ response: { status: 400 } });
    });

    it('claim is idempotent (already claimed → 200)', async () => {
      const id = await createPromo('CLAIMIDEM', { visibility: 'claimable' });
      const first = await claim(id);
      expect(first.status).toEqual(200);
      const second = await claim(id);
      expect(second.status).toEqual(200);
    });
  },
});
