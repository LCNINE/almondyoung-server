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
    let anonHeaders: { headers: Record<string, string> };
    let customerId: string;
    let seq = 0;

    // 활성 프로모션 생성 (기본: 정률 10%, 주문 대상). overrides 로 campaign/rules 주입 가능.
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

    const createEvent = async (body: Record<string, unknown>) => {
      const res = await api.post('/admin/coupon-events', body, adminHeaders);
      return res.data.event;
    };

    const getEventStore = (slug: string, headers = storeHeaders) =>
      api.get(`/store/events/${slug}`, headers);

    const stateOf = (coupons: any[], code: string) =>
      coupons.find((c: any) => c.code === code)?.state;

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

    beforeEach(async () => {
      seq++;
      const container = getContainer();
      const config = container.resolve(ContainerRegistrationKeys.CONFIG_MODULE) as any;
      const secret = config.projectConfig.http.jwtSecret;

      const userModule = container.resolve(Modules.USER);
      const [user] = await userModule.createUsers([{ email: `admin${seq}@ev.test` }]);
      adminHeaders = {
        headers: {
          authorization: `Bearer ${jwt.sign(
            { actor_id: user.id, actor_type: 'user', auth_identity_id: 'a', app_metadata: { user_id: user.id } },
            secret,
          )}`,
        },
      };

      const pk = await api.post('/admin/api-keys', { title: `pk${seq}`, type: 'publishable' }, adminHeaders);
      const pkToken = pk.data.api_key.token;

      const customerModule = container.resolve(Modules.CUSTOMER);
      const [cust] = await customerModule.createCustomers([{ email: `buyer${seq}@ev.test` }]);
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
      anonHeaders = { headers: { 'x-publishable-api-key': pkToken } };
    });

    /*───────────────── 관리자 이벤트 CRUD ─────────────────*/

    it('admin: create event with coupons, list, detail returns items in order', async () => {
      const c1 = await createPromo('EV_A', { visibility: 'claimable' });
      const c2 = await createPromo('EV_B', { visibility: 'claimable' });
      const event = await createEvent({ title: '여름 쿠폰팩', status: 'active', promotion_ids: [c1, c2] });

      expect(event.slug).toBeTruthy();
      expect(event.status).toBe('active');

      const list = await api.get('/admin/coupon-events', adminHeaders);
      const found = list.data.events.find((e: any) => e.id === event.id);
      expect(found).toBeTruthy();
      expect(found.item_count).toBe(2);

      const detail = await api.get(`/admin/coupon-events/${event.id}`, adminHeaders);
      expect(detail.data.items.map((i: any) => i.promotion_id)).toEqual([c1, c2]);
      expect(detail.data.items[0].promotion.code).toBe('EV_A');
    });

    it('admin: update replaces items and edits fields', async () => {
      const c1 = await createPromo('EV_U1', { visibility: 'claimable' });
      const c2 = await createPromo('EV_U2', { visibility: 'claimable' });
      const event = await createEvent({ title: 't', status: 'draft', promotion_ids: [c1] });

      await api.post(
        `/admin/coupon-events/${event.id}`,
        { title: '수정됨', status: 'active', promotion_ids: [c2, c1] },
        adminHeaders,
      );

      const detail = await api.get(`/admin/coupon-events/${event.id}`, adminHeaders);
      expect(detail.data.event.title).toBe('수정됨');
      expect(detail.data.event.status).toBe('active');
      expect(detail.data.items.map((i: any) => i.promotion_id)).toEqual([c2, c1]);
    });

    it('admin: delete removes event and its items', async () => {
      const c1 = await createPromo('EV_D', { visibility: 'claimable' });
      const event = await createEvent({ title: 'del', status: 'active', promotion_ids: [c1] });

      await api.delete(`/admin/coupon-events/${event.id}`, adminHeaders);

      const err = await getEventStore(event.slug).catch((e: any) => e.response);
      expect(err.status).toBe(404);
    });

    /*───────────────── 스토어 이벤트 상태 ─────────────────*/

    it('store: draft event is hidden (404)', async () => {
      const c1 = await createPromo('EV_DR', { visibility: 'claimable' });
      const event = await createEvent({ title: 'draft', status: 'draft', promotion_ids: [c1] });
      const err = await getEventStore(event.slug).catch((e: any) => e.response);
      expect(err.status).toBe(404);
    });

    it('store: coupon states — claimable / claimed / usable / not_assigned', async () => {
      const claimable = await createPromo('S_CLAIM', { visibility: 'claimable' });
      const assigned = await createPromo('S_ASSIGN', { visibility: 'claimable' });
      const pub = await createPromo('S_PUB', { visibility: 'public' });
      const assignedOnly = await createPromo('S_AO', { visibility: 'assigned_only' });
      // «claimed» 는 링크가 아니라 «사용 가능한 장»이 판정한다(#488 Task 8 결정 3). Task 7 이후
      // 이벤트 라우트는 링크를 아예 읽지 않으므로(그 라우트는 groups.id 만 확장한다) 링크를
      // 심는 셋업은 죽은 코드였다 — 장만 심는다.
      const metaService = getContainer().resolve(PROMOTION_META_MODULE) as any;
      await metaService.issueGrantWithSlot({
        promotion_id: assigned, customer_id: customerId, issue_key: `s_assign_${seq}`,
        issued_via: 'admin_manual', expires_at: null, now: new Date(),
        max_claims: null, enforce_cap: false,
      });

      const event = await createEvent({
        title: 'states',
        status: 'active',
        promotion_ids: [claimable, assigned, pub, assignedOnly],
      });

      const res = await getEventStore(event.slug);
      expect(res.status).toBe(200);
      const c = res.data.coupons;
      expect(stateOf(c, 'S_CLAIM').kind).toBe('claimable');
      expect(stateOf(c, 'S_ASSIGN').kind).toBe('claimed');
      expect(stateOf(c, 'S_PUB').kind).toBe('usable');
      expect(stateOf(c, 'S_AO')).toEqual({ kind: 'blocked', reason: 'not_assigned' });
    });

    it('store: exhausted claimable → blocked/exhausted', async () => {
      const id = await createPromo('S_FULL', { visibility: 'claimable', max_claims: 1 });
      await fillClaims(id, 1); // 소진
      const event = await createEvent({ title: 'x', status: 'active', promotion_ids: [id] });

      const res = await getEventStore(event.slug);
      expect(stateOf(res.data.coupons, 'S_FULL')).toEqual({ kind: 'blocked', reason: 'exhausted' });
    });

    it('store: expired campaign → blocked/expired; future campaign → blocked/not_started', async () => {
      const past = new Date(Date.now() - 3 * 24 * 3600 * 1000).toISOString();
      const past2 = new Date(Date.now() - 1 * 24 * 3600 * 1000).toISOString();
      const future = new Date(Date.now() + 3 * 24 * 3600 * 1000).toISOString();
      const future2 = new Date(Date.now() + 6 * 24 * 3600 * 1000).toISOString();

      const expired = await createPromo('S_EXP', { visibility: 'claimable', starts_at: past, ends_at: past2 });
      const notStarted = await createPromo('S_NS', { visibility: 'claimable', starts_at: future, ends_at: future2 });
      const event = await createEvent({ title: 'time', status: 'active', promotion_ids: [expired, notStarted] });

      const res = await getEventStore(event.slug);
      expect(stateOf(res.data.coupons, 'S_EXP')).toEqual({ kind: 'blocked', reason: 'expired' });
      expect(stateOf(res.data.coupons, 'S_NS')).toEqual({ kind: 'blocked', reason: 'not_started' });
    });

    it('store: group-restricted claimable → blocked/group_restricted for non-member', async () => {
      const [g] = await getContainer().resolve(Modules.CUSTOMER).createCustomerGroups([{ name: `grp${seq}` }]);
      const id = await createPromo('S_GRP', { visibility: 'claimable' }, {
        rules: [{ attribute: 'customer.groups.id', operator: 'in', values: [g.id] }],
      });
      const event = await createEvent({ title: 'grp', status: 'active', promotion_ids: [id] });

      const res = await getEventStore(event.slug);
      expect(stateOf(res.data.coupons, 'S_GRP')).toEqual({ kind: 'blocked', reason: 'group_restricted' });
    });

    it('store: unauthenticated sees claimable as claimable (login handled on claim)', async () => {
      const id = await createPromo('S_ANON', { visibility: 'claimable' });
      const event = await createEvent({ title: 'anon', status: 'active', promotion_ids: [id] });

      const res = await getEventStore(event.slug, anonHeaders);
      expect(res.status).toBe(200);
      expect(stateOf(res.data.coupons, 'S_ANON').kind).toBe('claimable');
    });
  },
});
