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

    /**
     * 발급 상한을 「소진」 상태로 만든다. 옛 픽스처는 `reserveClaimSlot` 으로 카운터만 올렸지만,
     * 이제 상한의 정본은 `coupon_grant` 행이라 실제 장을 심어야 한다 (설계 결정 1).
     * `coupon_grant` 는 customer 테이블에 FK 가 없으므로 채움용 고객 id 는 실재하지 않아도 된다.
     */
    const fillClaims = async (promotionId: string, n: number) => {
      const meta = getContainer().resolve(PROMOTION_META_MODULE) as any;
      for (let i = 0; i < n; i++) {
        await meta.issueGrantWithSlot({
          promotion_id: promotionId,
          customer_id: `filler_${seq}_${i}`,
          issue_key: `${promotionId}:filler:${i}`,
          issued_via: 'admin_manual',
          expires_at: null,
          now: new Date(),
          max_claims: null, // 채우는 단계에서는 상한을 집행하지 않는다
          enforce_cap: false,
        });
      }
    };

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
      // 발급 상한을 소진 상태로 — 이제 카운터가 아니라 실제 장으로 채운다.
      await fillClaims(claimId, 1);

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
      await metaService.consumeGrantIfUnused(grant.id, `order_${seq}`, new Date());

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

    /**
     * #488 A1 — 쓴 쿠폰은 어느 바구니에도 없었다.
     *
     * 「1장=1회」가 강제되기 전에는 쓴 쿠폰이 계속 「사용 가능」에 남았다(그것도 그것대로
     * 버그였다 — 다시 쓸 수 있었으니까). 강제한 뒤에는 반대 극단이 됐다: 무기한이거나
     * 만료가 미래인 장을 쓰면 **어디에도 안 뜬다.** 그런데 고객은 보통 만료 «전»에 쓰므로
     * 「쓰면 사라진다」가 예외가 아니라 기본 동작이었다.
     */
    describe('사용완료 바구니 (#488 A1)', () => {
      const metaSvc = () => getContainer().resolve(PROMOTION_META_MODULE) as any;

      /** 장 한 장을 발급하고 링크까지 만든다 — 마이페이지는 링크 행으로 쿠폰을 열거한다. */
      const grantOne = async (promotionId: string, key: string, expiresAt: Date | null = null) => {
        await metaSvc().issueGrant({
          promotion_id: promotionId, customer_id: customerId, issue_key: key,
          issued_via: 'admin_manual', expires_at: expiresAt, now: new Date(),
        });
        await linkCustomer(promotionId);
      };

      const consumeAll = async (promotionId: string, usedAt = new Date()) => {
        const grants = await metaSvc().listGrantsForCustomer(customerId);
        for (const g of grants.filter((x: any) => x.promotion_id === promotionId)) {
          await metaSvc().consumeGrantIfUnused(g.id, `order_${seq}_${g.id}`, usedAt);
        }
      };

      it('🔴 무기한 장을 쓰면 used_promotions 에 뜬다 — 예전엔 어디에도 없었다', async () => {
        const id = await createPromo('USEDINF', { visibility: 'assigned_only' });
        await grantOne(id, `usedinf_${seq}`, null);
        await consumeAll(id);

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect(res.data.used_promotions.map((p: any) => p.code)).toContain('USEDINF');
      });

      it('🔴 만료가 «미래» 인 장을 써도 뜬다 — 이게 정상 사용 경로다', async () => {
        // 고객은 보통 만료 전에 쓴다. 만료 바구니는 `endsAt < now` 라 이 장을 절대 안 담았고,
        // 「사용 가능」에서는 소모돼 빠졌다 — 가장 흔한 경로가 곧 「쿠폰이 증발한다」였다.
        const id = await createPromo('USEDFUT', { visibility: 'assigned_only' });
        const inTenDays = new Date(Date.now() + 10 * 24 * 3600 * 1000);
        await grantOne(id, `usedfut_${seq}`, inTenDays);
        await consumeAll(id);

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect(res.data.used_promotions.map((p: any) => p.code)).toContain('USEDFUT');
      });

      it('바구니는 배타적이다 — 사용완료는 「사용 가능」에도 「만료」에도 없다', async () => {
        const id = await createPromo('USEDEXCL', { visibility: 'assigned_only' });
        // 이미 지난 만료일 + 사용됨. 옛 동작이면 「만료」에 떠서 «쓴 건데 만료됐다» 고 나온다.
        const fiveDaysAgo = new Date(Date.now() - 5 * 24 * 3600 * 1000);
        await grantOne(id, `usedexcl_${seq}`, fiveDaysAgo);
        await consumeAll(id, new Date(Date.now() - 6 * 24 * 3600 * 1000));

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect(res.data.used_promotions.map((p: any) => p.code)).toContain('USEDEXCL');
        expect(res.data.promotions.map((p: any) => p.code)).not.toContain('USEDEXCL');
        expect(res.data.expired_promotions.map((p: any) => p.code)).not.toContain('USEDEXCL');
      });

      it('아직 쓸 수 있는 장이 남아 있으면 「사용 가능」이 이긴다 — 사용완료엔 안 뜬다', async () => {
        const id = await createPromo('USEDLEFT', { visibility: 'assigned_only' });
        await grantOne(id, `usedleft_a_${seq}`, null);
        await grantOne(id, `usedleft_b_${seq}`, null);
        // 두 장 중 한 장만 소모한다.
        const grants = (await metaSvc().listGrantsForCustomer(customerId))
          .filter((g: any) => g.promotion_id === id);
        await metaSvc().consumeGrantIfUnused(grants[0].id, `order_left_${seq}`, new Date());

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect(res.data.promotions.map((p: any) => p.code)).toContain('USEDLEFT');
        expect(res.data.used_promotions.map((p: any) => p.code)).not.toContain('USEDLEFT');
      });

      it('A2: 장을 다 쓴 public 쿠폰은 「사용 가능」에 남는다 — 카트와 같은 판정이어야 한다', async () => {
        // 🔴 A1(사용완료 바구니)과 A2(게이트)가 «결합될 때» 생기던 어긋남이다. 게이트는
        // public 이면 장을 무시하도록 고쳤는데 이 라우트가 안 고쳐져 있으면, 그 쿠폰이
        // 마이페이지엔 「사용완료」로 뜨는데 카트엔 그대로 붙는다 — 고객은 못 쓰는 줄 알고
        // 넘어가고, 코드를 직접 입력한 사람만 쓴다. 표시와 판정이 갈리는 그 실패다.
        const id = await createPromo('PUBUSED', { visibility: 'public' });
        await grantOne(id, `pubused_${seq}`, null);
        await consumeAll(id);

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect(res.data.promotions.map((p: any) => p.code)).toContain('PUBUSED');
        expect(res.data.used_promotions.map((p: any) => p.code)).not.toContain('PUBUSED');
      });

      it('30일보다 오래된 사용은 빠진다 — 만료 바구니와 같은 컷오프', async () => {
        const id = await createPromo('USEDOLD', { visibility: 'assigned_only' });
        await grantOne(id, `usedold_${seq}`, null);
        await consumeAll(id, new Date(Date.now() - 40 * 24 * 3600 * 1000));

        const res = await api.get('/store/customers/me/promotions', storeHeaders);

        expect(res.data.used_promotions.map((p: any) => p.code)).not.toContain('USEDOLD');
      });
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
      await fillClaims(id, 1); // 소진
      await expect(claim(id)).rejects.toMatchObject({ response: { status: 400 } });
    });

    // 🔴 2026-09-02 전체 리뷰: 소진 fast-check 가 「이미 받았는가」보다 **앞**에 서면서,
    // 마지막 한 장을 자기가 받은 고객이 받기를 다시 누르면 '발급 수량이 모두 소진되었습니다'
    // 가 됐다. 장 모델로 옮기기 전에는 `alreadyClaimed` 조기 반환이 이 검사보다 앞에 있어
    // 200 이 나갔다 — 설계 §5.1 이 「200 계약은 유지된다」고 약속한 그 동작이다.
    // 위 'exhausted' 테스트는 **다른 사람이** 소진시킨 경우라 이 결함을 못 잡는다.
    it('claim of a sold-out coupon I already hold is still 200 (§5.1 멱등 계약)', async () => {
      const id = await createPromo('CLAIMMINE', { visibility: 'claimable', max_claims: 1 });

      const first = await claim(id);
      expect(first.status).toEqual(200);
      // 이제 max_claims=1 이 내 발급으로 소진됐다 — 상한의 정본은 카운터가 아니라
      // `coupon_grant` COUNT 다 (결정 1).
      const meta = getContainer().resolve(PROMOTION_META_MODULE) as any;
      expect(await meta.countIssuedGrants(id)).toBe(1);

      const again = await claim(id);
      expect(again.status).toEqual(200);
      // 🔴 200 이 「한 장 더 줬다」는 뜻이면 안 된다 — 장수도 COUNT 도 그대로여야 한다.
      const mine = (await meta.listGrantsForCustomer(customerId)).filter(
        (g: any) => g.promotion_id === id,
      );
      expect(mine).toHaveLength(1);
      expect(await meta.countIssuedGrants(id)).toBe(1);
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
