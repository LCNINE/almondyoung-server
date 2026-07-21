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
      const remoteLink = getContainer().resolve(ContainerRegistrationKeys.REMOTE_LINK) as any;
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

    it('me/promotions excludes a coupon whose per-customer usage limit is used up (P2 used-coupon)', async () => {
      const id = await createPromoRaw('USEDUP', { visibility: 'public' }, {
        campaign: {
          name: 'u',
          campaign_identifier: `U_${seq}`,
          budget: { type: 'use_by_attribute', attribute: 'customer_id', limit: 1 },
        },
      });
      await linkCustomer(id);

      // 사용 전: 목록에 노출
      const before = await api.get('/store/customers/me/promotions', storeHeaders);
      expect(before.data.promotions.map((p: any) => p.code)).toContain('USEDUP');

      // 이 고객의 사용 1회 등록 → 1인당 한도(1) 소진
      const query = getContainer().resolve(ContainerRegistrationKeys.QUERY) as any;
      const { data: promos } = await query.graph({
        entity: 'promotion',
        fields: ['id', 'campaign.budget.id'],
        filters: { id },
      });
      const budgetId = promos[0].campaign.budget.id as string;
      const promotionModule = getContainer().resolve(Modules.PROMOTION) as any;
      await promotionModule.createCampaignBudgetUsages([
        { attribute_value: customerId, used: 1, budget_id: budgetId },
      ]);

      // 사용 후: 목록에서 제외
      const after = await api.get('/store/customers/me/promotions', storeHeaders);
      expect(after.data.promotions.map((p: any) => p.code)).not.toContain('USEDUP');
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
      await createPromoRaw('EXPIREDC', { visibility: 'public' }, {
        campaign: { name: 'e', campaign_identifier: `E_${seq}`, ends_at: '2000-01-01T00:00:00Z' },
      });
      await createPromoRaw('GROUPRES', { visibility: 'public' }, await otherGroupRule());

      const a = await preview('ASSIGNONLY');
      expect(a.data.reason).toEqual('COUPON_NOT_ASSIGNED');
      const e = await preview('EXPIREDC');
      expect(e.data.reason).toEqual('COUPON_EXPIRED');
      const g = await preview('GROUPRES');
      expect(g.data.reason).toEqual('COUPON_GROUP_RESTRICTED');
    });

    it('preview of an assigned assigned_only coupon is valid', async () => {
      const id = await createPromo('ASSIGNED_OK', { visibility: 'assigned_only' });
      await linkCustomer(id);
      const res = await preview('ASSIGNED_OK');
      expect(res.data.valid).toBe(true);
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
